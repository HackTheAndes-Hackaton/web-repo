import "server-only";
import type postgres from "postgres";
import { z } from "zod";
import { db, newId, type Sql } from "../db";
import { emit } from "../events";
import { refreshLinksFor } from "../links";
import { detectSignals, extractEntities, normalizeEntity, scoreFromSignalTypes } from "../heuristics";
import { riskLevelFromScore, type Incident, type SignalType } from "../types";
import { ApiError, notFound } from "./http";

/**
 * Conversación de cada llamada que atiende la app: quién habló y qué dijo
 * (el asistente con quien llama y, si entra, el titular). La app la envía al
 * terminar la llamada; el panel y la app la recuperan después.
 *
 * Se identifica por el client_call_id que genera Android. Reenviar la misma
 * llamada reemplaza la transcripción: nunca se duplica.
 */

const datetime = z.iso.datetime({ offset: true });
const callId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/, "Solo letras, números y _ . : -");

export const SPEAKERS = ["agent", "caller", "user"] as const;
export type Speaker = (typeof SPEAKERS)[number];

export const transcriptLineInput = z
  .object({
    id: z.string().min(1).max(200),
    speaker: z.enum(SPEAKERS),
    text: z.string().trim().min(1).max(4000),
    flagged: z.boolean().default(false),
    t_offset: z.number().min(0).nullable().default(null),
  })
  .strict();

export const callInput = z
  .object({
    caller_number_raw: z.string().max(100).nullable().default(null),
    caller_e164: z.string().regex(/^\+[1-9]\d{1,14}$/).nullable().default(null),
    caller_name: z.string().trim().min(1).max(200).nullable().default(null),
    direction: z.enum(["incoming", "outgoing"]).default("incoming"),
    call_status: z.enum(["ringing", "active", "ended", "rejected", "missed"]).default("ended"),
    started_at: datetime,
    answered_at: datetime.nullable().default(null),
    ended_at: datetime.nullable().default(null),
    talk_duration_s: z.number().min(0).nullable().default(null),
    simulated: z.boolean().default(false),
    blocked: z.boolean().default(false),
    /** El asistente atendió antes que el titular. */
    screened: z.boolean().default(false),
    verdict: z.enum(["none", "safe", "suspicious", "scam"]).default("none"),
    risk_score: z.number().int().min(0).max(100).default(0),
    risk_reasons: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
    scam_type: z.string().trim().min(1).max(200).nullable().default(null),
    impersonating: z.string().trim().min(1).max(200).nullable().default(null),
    summary: z.string().max(4000).nullable().default(null),
    transcript: z.array(transcriptLineInput).max(1000).default([]),
  })
  .strict();

export type CallInput = z.infer<typeof callInput>;

export interface TranscriptLine {
  id: string;
  idx: number;
  speaker: Speaker | null;
  text: string;
  flagged: boolean;
  t_offset: number;
  external_segment_id: string | null;
}

export interface CallSummary {
  incident_id: string;
  client_call_id: string;
  title: string;
  caller_e164: string | null;
  caller_number_raw: string | null;
  caller_name: string | null;
  direction: string | null;
  call_status: string | null;
  started_at: string;
  ended_at: string | null;
  verdict: string;
  risk_score: number;
  risk_level: string;
  summary: string | null;
  transcript_lines: number;
}

export function parseCallId(value: string) {
  const parsed = callId.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "invalid_call_id", "El identificador de la llamada no es válido.");
  return parsed.data;
}

/** Marca de lo que el panel deriva por reglas de la conversación (no lo escribe el servicio de IA). */
const RULES_SOURCE = "reglas_transcripcion";

/**
 * Evidencia para el caso a partir de lo que dijo quien llama: señales de riesgo y datos
 * (cuentas, números Yape, montos, entidades). El número que llamó se registra como mostrado.
 */
function evidenceFrom(input: CallInput, segments: { id: string; incident_id: string; speaker: Speaker; text: string }[]) {
  const signals: Record<string, unknown>[] = [];
  const entities: Record<string, unknown>[] = [];
  const meta = { source: RULES_SOURCE } as postgres.JSONValue;
  const seenSignal = new Set<string>();
  const seenEntity = new Set<string>();
  const addEntity = (incident: string, segment: string | null, kind: string, value: string, provenance: string) => {
    const normalized = normalizeEntity(kind, value);
    if (!normalized || seenEntity.has(`${kind}:${normalized}`)) return;
    seenEntity.add(`${kind}:${normalized}`);
    entities.push({ id: newId("ent"), incident_id: incident, segment_id: segment, kind, value, normalized, provenance, analysis_meta: meta });
  };
  for (const segment of segments) {
    // Las señales salen de lo que dice quien llama; el asistente y el titular no son sospechosos.
    if (segment.speaker !== "caller") continue;
    for (const signal of detectSignals(segment.text)) {
      if (seenSignal.has(signal.type)) continue;
      seenSignal.add(signal.type);
      signals.push({
        id: newId("sig"), incident_id: segment.incident_id, segment_id: segment.id, type: signal.type,
        evidence: signal.evidence, explanation: signal.explanation, confidence: signal.confidence,
        source: RULES_SOURCE, analysis_meta: meta,
      });
    }
    for (const entity of extractEntities(segment.text)) {
      addEntity(segment.incident_id, segment.id, entity.kind, entity.value, "mencionado");
    }
  }
  const shown = input.caller_e164 ?? input.caller_number_raw;
  const incident = segments[0]?.incident_id;
  if (shown && incident) addEntity(incident, null, "telefono", shown, "mostrado");
  return { signals, entities };
}

function titleFor(input: CallInput) {
  const who = input.caller_name ?? input.caller_e164 ?? input.caller_number_raw;
  if (!who) return input.direction === "outgoing" ? "Llamada saliente" : "Llamada entrante";
  return input.direction === "outgoing" ? `Llamada a ${who}` : `Llamada de ${who}`;
}

/** Guarda (o reemplaza) la llamada y su conversación en la organización indicada. */
export async function saveCall(org: string, clientCallId: string, value: unknown, connection?: Sql) {
  const input = callInput.parse(value);
  const sql = connection ?? (await db());
  const lines = input.transcript;
  const result = await sql.begin(async (tx) => {
    // Dos envíos simultáneos de la misma llamada no crean dos incidentes.
    await tx`select pg_advisory_xact_lock(hashtextextended(${`call:${org}:${clientCallId}`}, 0))`;
    const [existing] = await tx<Incident[]>`
      select * from incidents where org_id = ${org} and client_call_id = ${clientCallId} for update`;
    if (existing?.sharing_revoked_at) {
      throw new ApiError(403, "sharing_revoked", "La persona revocó la compartición de esta llamada.");
    }
    const fields = {
      title: titleFor(input),
      status: input.ended_at ? "finalizado" : "en_curso",
      started_at: input.started_at,
      ended_at: input.ended_at,
      risk_score: input.risk_score,
      risk_level: riskLevelFromScore(input.risk_score),
      caller_number_raw: input.caller_number_raw,
      caller_e164: input.caller_e164,
      caller_name: input.caller_name,
      direction: input.direction,
      call_status: input.call_status,
      answered_at: input.answered_at,
      talk_duration_s: input.talk_duration_s,
      simulated: input.simulated,
      blocked: input.blocked,
      verdict: input.verdict,
      analysis_status: input.verdict === "none" ? "pending" : "completed",
      risk_reasons: tx.json(input.risk_reasons),
      scam_type: input.scam_type,
      impersonating: input.impersonating,
      // Un resumen vacío de la app no borra el que haya escrito el servicio de IA.
      ...(input.summary ? { summary: input.summary } : {}),
    };
    const meta = { transcript_source: "android", screened_by_assistant: input.screened } as postgres.JSONValue;
    let id: string;
    if (existing) {
      id = existing.id;
      await tx`update incidents set ${tx(fields)},
        analysis_meta = coalesce(analysis_meta, '{}'::jsonb) || ${tx.json(meta)},
        consent_snapshot = coalesce(consent_snapshot, '{}'::jsonb) || '{"transcript_storage":true}'::jsonb,
        updated_at = now()
        where id = ${id}`;
    } else {
      id = newId("inc");
      await tx`insert into incidents ${tx({
        ...fields,
        id,
        org_id: org,
        channel: "llamada",
        client_call_id: clientCallId,
        analysis_meta: tx.json(meta),
        consent_snapshot: tx.json({ transcript_storage: true }),
      })}`;
    }
    // La app envía la conversación completa: se reemplaza para que reintentos no dupliquen líneas.
    // Lo derivado por reglas también se recalcula; lo que escribió el servicio de IA se conserva.
    await tx`delete from signals where incident_id = ${id} and source = ${RULES_SOURCE}`;
    await tx`delete from entities where incident_id = ${id} and analysis_meta->>'source' = ${RULES_SOURCE}`;
    await tx`delete from segments where incident_id = ${id}`;
    const segments = lines.map((line, idx) => ({
      id: newId("seg"),
      incident_id: id,
      idx,
      t_offset: line.t_offset ?? idx,
      speaker: line.speaker,
      text: line.text,
      flagged: line.flagged,
      is_final: true,
      source: "android",
      external_segment_id: line.id,
    }));
    if (segments.length > 0) await tx`insert into segments ${tx(segments)}`;
    const evidence = evidenceFrom(input, segments);
    if (evidence.signals.length > 0) await tx`insert into signals ${tx(evidence.signals)}`;
    if (evidence.entities.length > 0) await tx`insert into entities ${tx(evidence.entities)}`;
    // Sin veredicto del servicio de IA, el riesgo del caso sale de las señales observadas.
    if (input.verdict === "none" && input.risk_score === 0 && evidence.signals.length > 0) {
      const score = scoreFromSignalTypes(evidence.signals.map((s) => s.type as SignalType));
      await tx`update incidents set risk_score = ${score}, risk_level = ${riskLevelFromScore(score)} where id = ${id}`;
    }
    return {
      incident_id: id, client_call_id: clientCallId, transcript_lines: lines.length, created: !existing,
      signals: evidence.signals.length, entities: evidence.entities.length,
    };
  });
  // Cuentas o números repetidos entre llamadas proponen vínculos entre casos (revisión del analista).
  await refreshLinksFor(result.incident_id, sql);
  emit({ type: "incident", orgId: org, incidentId: result.incident_id });
  emit({ type: "links", orgId: org });
  return result;
}

export async function getTranscript(incidentId: string, connection?: Sql) {
  const sql = connection ?? (await db());
  const rows = await sql<TranscriptLine[]>`
    select id, idx, speaker, text, flagged, t_offset, external_segment_id
    from segments where incident_id = ${incidentId} order by idx, created_at`;
  return [...rows];
}

/** Una llamada con su conversación, por el identificador de Android. */
export async function getCall(org: string, clientCallId: string, connection?: Sql) {
  const sql = connection ?? (await db());
  const [incident] = await sql<Incident[]>`
    select * from incidents where org_id = ${org} and client_call_id = ${clientCallId} and sharing_revoked_at is null`;
  if (!incident) throw notFound("Llamada");
  return { incident, transcript: await getTranscript(incident.id, sql) };
}

/** Conversación de cualquier incidente de la organización. */
export async function getIncidentTranscript(org: string, incidentId: string, connection?: Sql) {
  const sql = connection ?? (await db());
  const [incident] = await sql<{ id: string }[]>`
    select id from incidents where id = ${incidentId} and org_id = ${org} and sharing_revoked_at is null`;
  if (!incident) throw notFound("Incidente");
  return getTranscript(incidentId, sql);
}

/** Llamadas recientes de la organización con cuántas líneas de conversación tienen. */
export async function listCalls(org: string, { limit, offset }: { limit: number; offset: number }, connection?: Sql) {
  const sql = connection ?? (await db());
  const [rows, [{ total }]] = await Promise.all([
    sql<CallSummary[]>`
      select i.id as incident_id, i.client_call_id, i.title, i.caller_e164, i.caller_number_raw, i.caller_name,
             i.direction, i.call_status, i.started_at, i.ended_at, i.verdict, i.risk_score, i.risk_level, i.summary,
             (select count(*)::int from segments s where s.incident_id = i.id) as transcript_lines
      from incidents i
      where i.org_id = ${org} and i.client_call_id is not null and i.sharing_revoked_at is null
      order by i.started_at desc
      limit ${limit} offset ${offset}`,
    sql<{ total: number }[]>`
      select count(*)::int as total from incidents
      where org_id = ${org} and client_call_id is not null and sharing_revoked_at is null`,
  ]);
  return { data: [...rows], pagination: { limit, offset, total } };
}
