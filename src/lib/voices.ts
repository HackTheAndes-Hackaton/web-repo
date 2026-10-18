import "server-only";
import { db, newId, nowIso } from "./db";
import type { Session } from "./types";

/**
 * Voces de estafadores: huellas de voz del llamante en llamadas que la IA marcó
 * como estafa. Las llamadas cuyas voces se parecen se agrupan como una misma voz.
 * Es una pista para revisar, no una identificación de la persona.
 */

/** Parecido mínimo (coseno) para tratar dos llamadas como la misma voz. */
export const SAME_VOICE = 0.75;

export type VoiceStatus = "pendiente" | "confirmada" | "descartada";

/** Fragmento WAV guardado por el servidor de voz para la misma sesión de la llamada. */
export interface VoiceAudio {
  id: string;
  duration_s: number;
}

export interface VoiceCall {
  id: string;
  title: string;
  seen_at: string;
  number: string | null;
  scam_type: string | null;
  impersonating: string | null;
  samples: number;
  audio: VoiceAudio[];
}

export interface ScamVoice {
  key: string;
  status: VoiceStatus;
  calls: VoiceCall[];
  numbers: string[];
  scam_types: string[];
  impersonating: string[];
  first_seen: string;
  last_seen: string;
  /** Parecido más alto entre dos llamadas de la voz (null si es una sola llamada). */
  similarity: number | null;
  samples: number;
  pending: number;
}

interface SampleRow {
  incident_id: string;
  review_status: "pendiente" | "aprobada" | "rechazada";
  title: string;
  seen_at: string;
  number: string | null;
  scam_type: string | null;
  impersonating: string | null;
}

export async function listScamVoices(orgId: string): Promise<ScamVoice[]> {
  const sql = await db();
  // Solo huellas comparables: del llamante, utilizables, con modelo y con permiso para guardarlas.
  const [samples, pairs] = await Promise.all([
    sql<SampleRow[]>`
      select v.incident_id, v.review_status, i.title, coalesce(i.started_at, i.created_at) as seen_at,
             coalesce(i.caller_e164, i.caller_number_raw, i.analysis_meta->>'caller_number') as number,
             i.scam_type, i.impersonating
      from voice_samples v join incidents i on i.id = v.incident_id
      where i.org_id = ${orgId} and i.verdict = 'scam' and i.sharing_revoked_at is null
        and i.consent_snapshot->'voice_storage' = 'true'::jsonb
        and v.speaker = 'caller' and v.quality_status = 'usable' and v.model_id is not null`,
    sql<{ a: string; b: string; sim: number }[]>`
      with s as (
        select v.incident_id, v.embedding, v.model_id, v.model_version, v.embedding_dims, i.simulated
        from voice_samples v join incidents i on i.id = v.incident_id
        where i.org_id = ${orgId} and i.verdict = 'scam' and i.sharing_revoked_at is null
          and i.consent_snapshot->'voice_storage' = 'true'::jsonb
          and v.speaker = 'caller' and v.quality_status = 'usable' and v.model_id is not null
          and v.review_status <> 'rechazada'
      )
      select a.incident_id as a, b.incident_id as b,
             max(1 - (a.embedding operator(extensions.<=>) b.embedding))::float8 as sim
      from s a join s b on a.incident_id < b.incident_id
        and a.model_id = b.model_id and a.model_version = b.model_version
        and a.embedding_dims = b.embedding_dims and a.simulated is not distinct from b.simulated
      group by 1, 2
      having max(1 - (a.embedding operator(extensions.<=>) b.embedding)) >= ${SAME_VOICE}`,
  ]);

  // Audio de cada llamada: el servidor de voz lo guarda en otro incidente de la misma sesión.
  const callIds = [...new Set(samples.map((s) => s.incident_id))];
  const audios = callIds.length
    ? await sql<{ call_id: string; id: string; duration_s: number }[]>`
        select c.id as call_id, f.id, f.duration_s from incidents c
        join incidents a on a.org_id = c.org_id and a.consent_snapshot->>'voice_storage' = 'true'
          and (a.id = c.id or (c.agent_session_id is not null and a.agent_session_id = c.agent_session_id))
        join audio_fragments f on f.incident_id = a.id
        where c.org_id = ${orgId} and c.id in ${sql(callIds)}
        order by f.created_at`
    : [];

  // Una llamada por fila, con sus huellas.
  const calls = new Map<string, VoiceCall & { statuses: SampleRow["review_status"][] }>();
  for (const s of samples) {
    const c = calls.get(s.incident_id) ?? {
      id: s.incident_id, title: s.title, seen_at: s.seen_at, number: s.number,
      scam_type: s.scam_type, impersonating: s.impersonating, samples: 0, statuses: [],
      audio: audios.filter((a) => a.call_id === s.incident_id).map((a) => ({ id: a.id, duration_s: a.duration_s })),
    };
    c.samples++;
    c.statuses.push(s.review_status);
    calls.set(s.incident_id, c);
  }

  // Llamadas con voces parecidas = la misma voz (componentes conectados).
  const parent = new Map([...calls.keys()].map((id) => [id, id]));
  const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
  const best = new Map<string, number>();
  for (const p of pairs) {
    if (!calls.has(p.a) || !calls.has(p.b)) continue;
    const [ra, rb] = [find(p.a), find(p.b)];
    if (ra !== rb) parent.set(rb, ra);
  }
  for (const p of pairs) {
    if (!calls.has(p.a)) continue;
    const root = find(p.a);
    best.set(root, Math.max(best.get(root) ?? 0, p.sim));
  }

  const groups = new Map<string, (VoiceCall & { statuses: SampleRow["review_status"][] })[]>();
  for (const c of calls.values()) {
    const root = find(c.id);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  }

  const voices = [...groups.entries()].map(([root, members]): ScamVoice => {
    const sorted = members.sort((x, y) => y.seen_at.localeCompare(x.seen_at));
    const statuses = sorted.flatMap((c) => c.statuses);
    const status: VoiceStatus = statuses.some((s) => s === "aprobada")
      ? "confirmada"
      : statuses.every((s) => s === "rechazada") ? "descartada" : "pendiente";
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
    return {
      key: root,
      status,
      calls: sorted.map((c) => ({ id: c.id, title: c.title, seen_at: c.seen_at, number: c.number, scam_type: c.scam_type, impersonating: c.impersonating, samples: c.samples, audio: c.audio })),
      numbers: uniq(sorted.map((c) => c.number)),
      scam_types: uniq(sorted.map((c) => c.scam_type)),
      impersonating: uniq(sorted.map((c) => c.impersonating)),
      first_seen: sorted[sorted.length - 1].seen_at,
      last_seen: sorted[0].seen_at,
      similarity: sorted.length > 1 ? (best.get(root) ?? null) : null,
      samples: statuses.length,
      pending: statuses.filter((s) => s === "pendiente").length,
    };
  });
  const order: Record<VoiceStatus, number> = { pendiente: 0, confirmada: 1, descartada: 2 };
  return voices.sort((a, b) => order[a.status] - order[b.status] || b.calls.length - a.calls.length || b.last_seen.localeCompare(a.last_seen));
}

export class VoiceReviewError extends Error {}

/**
 * Confirmar: las huellas quedan aprobadas y, si la persona lo permitió, sirven de
 * referencia para relacionar llamadas por voz. Descartar: dejan de usarse.
 */
export async function reviewVoice(session: Session, incidentIds: string[], decision: "confirmar" | "descartar") {
  const orgId = session.orgId!;
  const ids = [...new Set(incidentIds.filter(Boolean))];
  if (!ids.length) throw new VoiceReviewError("No hay llamadas para revisar.");
  const sql = await db();
  return sql.begin(async (tx) => {
    const own = await tx<{ id: string }[]>`select id from incidents where org_id = ${orgId} and id in ${tx(ids)}`;
    if (own.length !== ids.length) throw new VoiceReviewError("Alguna llamada no pertenece a tu organización.");
    const updated = decision === "confirmar"
      ? await tx`update voice_samples v set review_status = 'aprobada',
            reference_enabled = coalesce((select i.consent_snapshot->'voice_reference' = 'true'::jsonb from incidents i where i.id = v.incident_id), false)
          where v.incident_id in ${tx(ids)} and v.speaker = 'caller' and v.quality_status = 'usable' and v.model_id is not null
          returning v.id`
      : await tx`update voice_samples v set review_status = 'rechazada', reference_enabled = false
          where v.incident_id in ${tx(ids)} and v.speaker = 'caller' and v.quality_status = 'usable' and v.model_id is not null
          returning v.id`;
    const detail = decision === "confirmar"
      ? `Voz confirmada como de estafa por ${session.name}.`
      : `Voz descartada por ${session.name}: sus huellas dejan de usarse.`;
    await tx`insert into actions ${tx(ids.map((incident_id) => ({
      id: newId("act"), incident_id, kind: "voice_review", detail, actor_id: session.userId, actor_kind: "analyst",
      result: "applied", payload: tx.json({ decision, samples: updated.length } as never), created_at: nowIso(),
    })))}`;
    return updated.length;
  });
}

/** WAV de un fragmento de voz, solo de la organización y con permiso para conservar la voz. */
export async function loadVoiceAudio(orgId: string, fragmentId: string): Promise<Buffer | null> {
  if (!/^clip_[a-f0-9]{48}$/.test(fragmentId)) return null;
  const sql = await db();
  const [row] = await sql<{ audio: Uint8Array }[]>`
    select f.audio from audio_fragments f join incidents i on i.id = f.incident_id
    where f.id = ${fragmentId} and i.org_id = ${orgId} and i.consent_snapshot->>'voice_storage' = 'true'`;
  return row ? Buffer.from(row.audio) : null;
}
