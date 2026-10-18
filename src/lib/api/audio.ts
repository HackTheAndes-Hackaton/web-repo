import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, type Sql } from "../db";
import { ApiError, notFound } from "./http";
import { emit } from "../events";

export const audioInput = z.object({
  session_id: z.uuid(),
  request_id: z.uuid(),
  consentimiento_conservacion: z.literal(true),
  audio_base64: z.string().min(42728).max(640060),
  source: z.enum(["webrtc_microphone", "provider_mixed"]),
  risk_percent: z.number().int().min(0).max(100).nullable(),
  simulated: z.boolean().default(false),
}).strict();

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const incidentId = (org: string, session: string) => `aud_${digest(`${org}:${session}`).slice(0, 48)}`;

/** Solo WAV canónico PCM16 mono 16 kHz, entre 1 y 15 segundos. Sin URL externas. */
export function decodeAudio(encoded: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new ApiError(422, "invalid_audio", "Audio base64 inválido.");
  const data = Buffer.from(encoded, "base64");
  if (data.toString("base64") !== encoded || data.length < 32044 || data.length > 480044 ||
      data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 16) !== "WAVEfmt " ||
      data.readUInt32LE(4) !== data.length - 8 || data.readUInt32LE(16) !== 16 ||
      data.readUInt16LE(20) !== 1 || data.readUInt16LE(22) !== 1 || data.readUInt32LE(24) !== 16000 ||
      data.readUInt32LE(28) !== 32000 || data.readUInt16LE(32) !== 2 || data.readUInt16LE(34) !== 16 ||
      data.toString("ascii", 36, 40) !== "data" || data.readUInt32LE(40) !== data.length - 44 || (data.length - 44) % 2) {
    throw new ApiError(422, "invalid_audio", "Se requiere WAV PCM16 mono 16 kHz de 1 a 15 segundos.");
  }
  return data;
}

export async function requireOrg(org: string, sql: Sql) {
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(org) || !(await sql`select id from organizations where id=${org}`).length) throw notFound("Organización");
}

export async function saveAudio(org: string, value: unknown, connection?: Sql) {
  const input = audioInput.parse(value);
  const audio = decodeAudio(input.audio_base64);
  const sql = connection ?? await db();
  await requireOrg(org, sql);
  const incident = incidentId(org, input.session_id);
  const hash = digest(audio);
  const id = `clip_${digest(`${incident}:${input.request_id}`).slice(0, 48)}`;
  const result = await sql.begin(async (tx) => {
    // Serializa las cargas de una misma sesión: reintentos y cuota son atómicos.
    await tx`select pg_advisory_xact_lock(hashtextextended(${incident},0))`;
    const [existing] = await tx`select id,incident_id,sha256,duration_s,source,speaker,review_status,created_at from audio_fragments where id=${id}`;
    if (existing) {
      const [parent] = await tx`select consent_snapshot,simulated from incidents where id=${incident} and org_id=${org}`;
      if (parent?.consent_snapshot?.voice_storage !== true) throw new ApiError(403,"storage_revoked","La conservación del incidente no está autorizada.");
      if (parent.simulated !== input.simulated) throw new ApiError(409,"source_conflict","No se mezclan pruebas con llamadas reales.");
      if (existing.sha256 !== hash || existing.source !== input.source) throw new ApiError(409,"idempotency_conflict","El identificador ya corresponde a otro fragmento.");
      return existing;
    }
    const [{ n }] = await tx`select count(*)::int n from audio_fragments where incident_id=${incident}`;
    if (n >= 6) throw new ApiError(429,"clip_limit","Máximo seis fragmentos por sesión.");
    await tx`insert into incidents (id,org_id,agent_session_id,title,channel,simulated,risk_score,risk_level,verdict,consent_snapshot,analysis_meta)
      values (${incident},${org},${input.session_id},'Audio autorizado · revisión pendiente','webrtc',${input.simulated},${input.risk_percent ?? 0},
      ${input.risk_percent === null ? 'bajo' : input.risk_percent >= 70 ? 'alto' : input.risk_percent >= 40 ? 'medio' : 'bajo'},
      ${input.risk_percent === null ? 'none' : 'suspicious'},
      '{"voice_storage":true,"voice_reference":false}'::jsonb,
      '{"provisional":true,"identity_verified":false,"audio_speaker":"unknown"}'::jsonb) on conflict (id) do nothing`;
    const [parent] = await tx`select org_id,consent_snapshot,simulated from incidents where id=${incident} for update`;
    if (parent?.org_id !== org || parent.consent_snapshot?.voice_storage !== true) throw new ApiError(403,"storage_revoked","La conservación del incidente no está autorizada.");
    if (parent.simulated !== input.simulated) throw new ApiError(409,"source_conflict","No se mezclan pruebas con llamadas reales.");
    if (input.risk_percent !== null) {
      await tx`update incidents set risk_score=greatest(risk_score,${input.risk_percent}),
        risk_level=case when greatest(risk_score,${input.risk_percent})>=70 then 'alto' when greatest(risk_score,${input.risk_percent})>=40 then 'medio' else 'bajo' end,
        verdict=case when verdict='none' then 'suspicious' else verdict end, updated_at=now() where id=${incident}`;
      const signalId=`sig_${digest(incident).slice(0,48)}`;
      await tx`insert into signals(id,incident_id,type,evidence,explanation,confidence,source,analysis_meta)
        values (${signalId},${incident},'alerta_provisional','','Estimación de necesidad de revisar el fragmento; no confirma delito ni identidad.',${input.risk_percent/100},'ia',
        '{"score_kind":"probabilidad_de_alerta_no_calibrada","provisional":true}'::jsonb) on conflict (id) do nothing`;
    }
    const [row] = await tx`insert into audio_fragments(id,incident_id,request_id,audio,sha256,duration_s,source)
      values (${id},${incident},${input.request_id},${audio},${hash},${(audio.length-44)/32000},${input.source})
      returning id,incident_id,sha256,duration_s,source,speaker,review_status,created_at`;
    return row;
  });
  emit({ type:"incident", orgId:org, incidentId:incident });
  return result;
}

export async function listAudio(org: string, session: string, connection?: Sql) {
  z.uuid().parse(session);
  const sql = connection ?? await db();
  return [...await sql`select f.id,f.incident_id,f.duration_s,f.source,f.speaker,f.review_status,f.created_at
    from audio_fragments f join incidents i on i.id=f.incident_id
    where i.org_id=${org} and i.agent_session_id=${session} and i.consent_snapshot->>'voice_storage'='true'
    order by f.created_at desc limit 6`];
}

export async function loadAudio(org: string, session: string, id: string, connection?: Sql) {
  z.uuid().parse(session); z.string().regex(/^clip_[a-f0-9]{48}$/).parse(id);
  const sql = connection ?? await db();
  const [row] = await sql`select f.audio from audio_fragments f join incidents i on i.id=f.incident_id
    where f.id=${id} and i.org_id=${org} and i.agent_session_id=${session} and i.consent_snapshot->>'voice_storage'='true'`;
  if (!row) throw notFound("Fragmento autorizado");
  return Buffer.from(row.audio);
}
