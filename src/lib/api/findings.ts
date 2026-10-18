import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type postgres from "postgres";
import { db, type Sql } from "../db";
import { normalizeObservedEntityPe } from "../peru";
import { riskLevelFromScore } from "../types";
import { ApiError, notFound } from "./http";

const metadata = z.record(z.string(), z.unknown());
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const forbidden = new Set(["transcript", "transcription", "transcripcion", "transcripción", "segments", "segment_id", "audio", "audio_base64", "network_origin", "findings_batch", "findings_source"]);
function hasForbidden(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbidden);
  return value !== null && typeof value === "object" && Object.entries(value).some(([key, item]) => forbidden.has(key.toLowerCase()) || hasForbidden(item));
}

/** Entrega completa de hallazgos ya extraídos; nunca conversación ni audio. */
export const findingsInput = z.object({
  schema_version: z.literal("pe-v1"),
  run_id: z.uuid(),
  revision: z.number().int().min(1).max(1_000_000),
  session_id: z.string().trim().min(1).max(200),
  simulated: z.boolean(),
  ended_at: z.iso.datetime({ offset: true }),
  analysis: z.object({
    risk_score: z.number().int().min(0).max(100).nullable(),
    verdict: z.enum(["none", "safe", "suspicious", "scam"]),
    risk_reasons: z.array(z.string().trim().min(1).max(500)).max(30),
    summary: nullableText(4000), recommendation: nullableText(2000),
    scam_type: nullableText(200), impersonating: nullableText(200),
    model_id: z.string().trim().min(1).max(200),
  }).strict(),
  signals: z.array(z.object({
    type: z.string().trim().min(1).max(64), explanation: z.string().trim().min(1).max(4000),
    confidence: z.number().min(0).max(1), source: z.string().trim().min(1).max(40),
    analysis_meta: metadata.default({}),
  }).strict()).max(50),
  entities: z.array(z.object({
    kind: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(400),
    provenance: z.enum(["mencionado", "mostrado", "reportado_usuario", "proveedor"]),
    analysis_meta: metadata.default({}),
  }).strict()).max(100),
}).strict().refine(value => !hasForbidden(value), "No se admiten transcripciones, audio ni metadatos reservados.");

// Ordenar claves evita conflictos por el orden de propiedades de un JSON equivalente.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function commitFindings(org: string, id: string, value: unknown, actor: string, connection?: Sql) {
  const input = findingsInput.parse(value);
  const digest = hash(stable(input));
  const sql = connection ?? await db();
  return sql.begin(async tx => {
    const [incident] = await tx`select id, org_id, agent_session_id, simulated, sharing_revoked_at, started_at, analysis_meta
      from incidents where id=${id} and org_id=${org} for update`;
    if (!incident) throw notFound("Incidente");
    if (incident.sharing_revoked_at) throw new ApiError(403, "sharing_revoked", "La compartición fue revocada.");
    if (incident.agent_session_id !== input.session_id || incident.simulated !== input.simulated) {
      throw new ApiError(409, "source_conflict", "La sesión y el origen deben coincidir con el incidente existente.");
    }
    if (new Date(input.ended_at).getTime() < new Date(incident.started_at).getTime()) {
      throw new ApiError(422, "invalid_call_dates", "La finalización no puede preceder al inicio registrado.");
    }
    const [receipt] = await tx`select payload from actions where incident_id=${id} and kind='findings_committed'
      and payload->>'run_id'=${input.run_id} limit 1`;
    if (receipt) {
      if (receipt.payload.sha256 !== digest) throw new ApiError(409, "idempotency_conflict", "run_id ya corresponde a otros hallazgos.");
      return { incident_id: id, run_id: input.run_id, revision: input.revision, duplicate: true };
    }
    const previous = incident.analysis_meta?.findings_batch;
    if (previous && input.revision <= previous.revision) throw new ApiError(409, "stale_findings", "La revisión ya fue reemplazada o utiliza otro run_id.");

    // Solo reemplaza hallazgos de esta entrega; conserva otros aportes y los originales de audio.
    await tx`delete from signals where incident_id=${id} and analysis_meta->>'findings_source'='finalized_batch'`;
    await tx`delete from entities where incident_id=${id} and analysis_meta->>'findings_source'='finalized_batch'`;
    for (const [index, item] of input.signals.entries()) {
      const itemMeta = { ...item.analysis_meta, findings_source: "finalized_batch", run_id: input.run_id };
      await tx`insert into signals(id,incident_id,type,evidence,explanation,confidence,source,analysis_meta)
        values (${`sig_${hash(`${id}:${input.run_id}:${index}`).slice(0, 48)}`},${id},${item.type},'',${item.explanation},${item.confidence},${item.source},${tx.json(itemMeta as postgres.JSONValue)})`;
    }
    for (const [index, item] of input.entities.entries()) {
      const itemMeta = { ...item.analysis_meta, findings_source: "finalized_batch", run_id: input.run_id };
      await tx`insert into entities(id,incident_id,kind,value,normalized,provenance,analysis_meta)
        values (${`ent_${hash(`${id}:${input.run_id}:${index}`).slice(0, 48)}`},${id},${item.kind},${item.value},
          ${normalizeObservedEntityPe(item.kind, item.value, item.analysis_meta)},${item.provenance},${tx.json(itemMeta as postgres.JSONValue)})
        on conflict (incident_id,kind,normalized) do nothing`;
    }
    const { analysis } = input;
    const marker = { schema_version: input.schema_version, run_id: input.run_id, revision: input.revision, ready: true,
      sha256: digest, risk_available: analysis.risk_score !== null, model_id: analysis.model_id };
    await tx`update incidents set status='finalizado', ended_at=${input.ended_at}, analysis_status='completed',
      risk_score=coalesce(${analysis.risk_score},risk_score),
      risk_level=case when ${analysis.risk_score}::int is null then risk_level else ${riskLevelFromScore(analysis.risk_score ?? 0)} end,
      verdict=${analysis.verdict}, risk_reasons=${tx.json(analysis.risk_reasons)}, summary=${analysis.summary},
      recommendation=${analysis.recommendation}, scam_type=${analysis.scam_type}, impersonating=${analysis.impersonating},
      analysis_meta=coalesce(analysis_meta,'{}'::jsonb) || ${tx.json({ findings_batch: marker })}, updated_at=now() where id=${id}`;
    // Conserva la entrega original, incluida la versión anterior de sus hallazgos.
    await tx`insert into actions(id,incident_id,kind,detail,actor_kind,result,payload)
      values (${`fnd_${hash(`${id}:${input.run_id}`).slice(0, 48)}`},${id},'findings_committed',
        'Hallazgos completos recibidos; generación del informe pendiente.','service','applied',
        ${tx.json({ run_id: input.run_id, revision: input.revision, sha256: digest, actor_key_id: actor, input } as postgres.JSONValue)})`;
    return { incident_id: id, run_id: input.run_id, revision: input.revision, duplicate: false };
  });
}
