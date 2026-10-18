import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, type Sql } from "../db";
import { normalizePhonePe } from "../peru";
import { ApiError } from "./http";
import { requireOrg } from "./audio";

/**
 * Huellas de voz de estafas confirmadas, compartidas entre todos los usuarios.
 * La búsqueda devuelve solo totales (similitud, cantidad de casos, tipo de estafa):
 * nunca conversaciones, organizaciones ni personas. Una coincidencia es una pista
 * revisable, no una identificación. Una muestra rechazada en el panel deja de usarse.
 */

const vector = z.array(z.number().finite().min(-100).max(100)).min(64).max(1024);
const model = { model_id: z.string().min(1).max(120), model_version: z.string().min(1).max(200) };

export const searchInput = z.object({
  embedding: vector,
  ...model,
  min_similarity: z.number().min(0.5).max(0.99).default(0.7),
  simulated: z.boolean().default(false),
}).strict();

export const enrollInput = z.object({
  request_id: z.uuid(),
  session_id: z.uuid(),
  embeddings: z.array(vector).min(1).max(3),
  ...model,
  active_s: z.number().min(3).max(120),
  risk_score: z.number().int().min(0).max(100),
  voice_match_similarity: z.number().min(-1).max(1).nullable().default(null),
  caller_number: z.string().max(20).nullable().default(null),
  simulated: z.boolean().default(false),
}).strict();

export interface VoiceSearchResult {
  best_similarity: number | null;
  cases: number;
  reviewed_cases: number;
  last_seen_at: string | null;
  scam_type: string | null;
  impersonating: string | null;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const literal = (v: number[]) => `[${v.map((x) => Number(x).toFixed(7)).join(",")}]`;
const mode = (values: (string | null)[]) => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

export async function searchVoices(value: unknown, connection?: Sql): Promise<VoiceSearchResult> {
  const input = searchInput.parse(value);
  const sql = connection ?? (await db());
  const target = literal(input.embedding);
  const rows = await sql<{ incident_id: string; review_status: string; seen: Date | string; scam_type: string | null; impersonating: string | null; sim: number }[]>`
    select v.incident_id, v.review_status, coalesce(i.started_at, i.created_at) as seen, i.scam_type, i.impersonating,
      (1 - (v.embedding operator(extensions.<=>) ${target}::extensions.vector))::float8 as sim
    from voice_samples v join incidents i on i.id = v.incident_id
    where v.speaker = 'caller' and v.quality_status = 'usable' and v.review_status <> 'rechazada'
      and v.model_id = ${input.model_id} and v.model_version = ${input.model_version}
      and v.embedding_dims = ${input.embedding.length}
      and i.verdict = 'scam' and i.simulated = ${input.simulated} and i.sharing_revoked_at is null
      and i.consent_snapshot->'voice_storage' = 'true'::jsonb
    order by v.embedding operator(extensions.<=>) ${target}::extensions.vector
    limit 50`;
  const matches = rows.filter((r) => Number.isFinite(r.sim) && r.sim >= input.min_similarity);
  const cases = new Set(matches.map((r) => r.incident_id));
  const reviewed = new Set(matches.filter((r) => r.review_status === "aprobada").map((r) => r.incident_id));
  const seen = matches.map((r) => new Date(r.seen).getTime()).filter(Number.isFinite);
  return {
    best_similarity: rows.length && Number.isFinite(rows[0].sim) ? Math.round(rows[0].sim * 1000) / 1000 : null,
    cases: cases.size,
    reviewed_cases: reviewed.size,
    last_seen_at: seen.length ? new Date(Math.max(...seen)).toISOString() : null,
    scam_type: mode(matches.map((r) => r.scam_type)),
    impersonating: mode(matches.map((r) => r.impersonating)),
  };
}

/**
 * Guarda la voz de una llamada que el servidor de voz ya confirmó como estafa.
 * Queda en revisión pendiente: se usa para avisar, y el panel puede rechazarla.
 * El número va en los metadatos, no en caller_e164: así no se cuenta dos veces
 * en la reputación del número (la app ya sube la misma llamada por su lado).
 */
export async function enrollVoice(org: string, value: unknown, connection?: Sql) {
  const input = enrollInput.parse(value);
  const dims = input.embeddings[0].length;
  if (input.embeddings.some((e) => e.length !== dims)) throw new ApiError(422, "invalid_embedding", "Las huellas deben tener la misma dimensión.");
  const sql = connection ?? (await db());
  await requireOrg(org, sql);
  const incident = `vp_${digest(`${org}:${input.session_id}`).slice(0, 48)}`;
  const caller = input.caller_number ? normalizePhonePe(input.caller_number) : null;
  const level = input.risk_score >= 70 ? "alto" : input.risk_score >= 40 ? "medio" : "bajo";
  const meta = { provisional: true, identity_verified: false, voiceprint: "auto_confirmed_scam", caller_number: caller,
    voice_match_similarity: input.voice_match_similarity, active_s: input.active_s };
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${incident},0))`;
    await tx`insert into incidents (id,org_id,agent_session_id,title,channel,simulated,risk_score,risk_level,verdict,consent_snapshot,analysis_meta)
      values (${incident},${org},${input.session_id},'Voz de estafa confirmada · revisión pendiente','llamada',${input.simulated},
        ${input.risk_score},${level},'scam','{"voice_storage":true,"voice_reference":true}'::jsonb,${tx.json(meta)})
      on conflict (id) do nothing`;
    const [parent] = await tx`select org_id, simulated, consent_snapshot from incidents where id=${incident} for update`;
    if (parent?.org_id !== org || parent.consent_snapshot?.voice_storage !== true) throw new ApiError(403, "storage_revoked", "La conservación del incidente no está autorizada.");
    if (parent.simulated !== input.simulated) throw new ApiError(409, "source_conflict", "No se mezclan pruebas con llamadas reales.");
    const [{ n }] = await tx`select count(*)::int n from voice_samples where incident_id=${incident}`;
    if (n >= 9) throw new ApiError(429, "sample_limit", "Máximo nueve huellas por llamada.");
    let created = 0;
    for (const [index, embedding] of input.embeddings.entries()) {
      const id = `vs_${digest(`${incident}:${input.request_id}:${index}`).slice(0, 48)}`;
      const rows = await tx`insert into voice_samples (id,incident_id,embedding,duration_s,model_id,model_version,speaker,quality_status,review_status,reference_enabled,source_session_ref)
        values (${id},${incident},${literal(embedding)}::extensions.vector,${input.active_s},${input.model_id},${input.model_version},
          'caller','usable','pendiente',false,${input.session_id})
        on conflict (id) do nothing returning id`;
      created += rows.length;
    }
    return { incident_id: incident, samples: created };
  });
}
