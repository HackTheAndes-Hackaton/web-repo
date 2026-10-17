import "server-only";
import type postgres from "postgres";
import { db, newId, nowIso, type Db } from "./db";
import { normalizeText } from "./heuristics";
import { ENTITY_LABELS, type EntityKind, type LinkReason, type SignalType } from "./types";

/**
 * Propone vínculos entre incidentes compartidos con la misma organización.
 * Combina similitud de voz, datos repetidos y parecido del contenido. Los
 * vínculos quedan "pendientes" hasta que un analista los confirma o descarta.
 */

const STOPWORDS = new Set(
  "a al algo ante como con de del el ella ellos en entonces es esa ese eso esta este esto estoy hay la las le les lo los me mi mas muy no nos o para pero por que se si sin su sus te tu tus un una uno y ya yo ok bueno pues oye eh ah".split(
    " ",
  ),
);

function tokens(text: string) {
  return normalizeText(text)
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function termVector(text: string) {
  const v = new Map<string, number>();
  for (const t of tokens(text)) v.set(t, (v.get(t) ?? 0) + 1);
  return v;
}

function cosineMap(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    const y = b.get(k);
    if (y) dot += x * y;
  }
  for (const y of b.values()) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

interface Profile {
  id: string;
  text: Map<string, number>;
  signalTypes: Set<SignalType>;
  entities: { kind: EntityKind; normalized: string; value: string }[];
}

/** Carga en lote el texto, las señales y los datos de varios incidentes. */
async function loadProfiles(sql: Db, ids: string[]) {
  const [texts, types, entities] = await Promise.all([
    sql<{ incident_id: string; text: string }[]>`
      select incident_id, string_agg(text, ' ' order by idx) as text
      from segments where incident_id in ${sql(ids)} and speaker = 'caller' and is_final group by incident_id`,
    sql<{ incident_id: string; type: SignalType }[]>`
      select distinct incident_id, type from signals where incident_id in ${sql(ids)}`,
    sql<{ incident_id: string; kind: EntityKind; normalized: string; value: string }[]>`
      select incident_id, kind, normalized, value from entities where incident_id in ${sql(ids)}`,
  ]);
  const profiles = new Map<string, Profile>(
    ids.map((id) => [id, { id, text: new Map(), signalTypes: new Set(), entities: [] }]),
  );
  for (const t of texts) profiles.get(t.incident_id)!.text = termVector(t.text);
  for (const t of types) profiles.get(t.incident_id)!.signalTypes.add(t.type);
  for (const e of entities) profiles.get(e.incident_id)!.entities.push(e);
  return profiles;
}

/**
 * Similitud de voz máxima entre las muestras del incidente y las de cada otro
 * caso, calculada en Postgres con pgvector (distancia coseno).
 */
async function voiceSimilarity(sql: Db, id: string, others: string[]) {
  const rows = await sql<{ incident_id: string; sim: number; sample_a: string; sample_b: string; model_id: string; model_version: string }[]>`
    with eligible as (
      select v.*, i.consent_snapshot, p.status as profile_status from voice_samples v
      join incidents i on i.id=v.incident_id left join voice_profiles p on p.id=v.profile_id
      where (v.incident_id=${id} or v.incident_id in ${sql(others)})
        and v.speaker='caller' and v.quality_status='usable' and v.review_status<>'rechazada'
        and v.model_id is not null and v.model_version is not null
        and (v.profile_id is null or (p.org_id=i.org_id and p.simulated=i.simulated))
        and i.consent_snapshot->'voice_storage' = 'true'::jsonb
    ), pairs as (
      select b.incident_id, a.id as sample_a, b.id as sample_b, a.model_id, a.model_version,
        case when a.model_id=b.model_id and a.model_version=b.model_version and a.embedding_dims=b.embedding_dims
          then (1 - (a.embedding operator(extensions.<=>) b.embedding))::float8 end as sim
      from eligible a join eligible b on b.incident_id in ${sql(others)}
      where a.incident_id=${id} and (
        (a.reference_enabled and a.review_status='aprobada' and coalesce(a.profile_status<>'descartado',true)
          and a.consent_snapshot->'voice_reference'='true'::jsonb)
        or (b.reference_enabled and b.review_status='aprobada' and coalesce(b.profile_status<>'descartado',true)
          and b.consent_snapshot->'voice_reference'='true'::jsonb)
      )
    ) select distinct on (incident_id) * from pairs where sim is not null and sim between -1 and 1
      order by incident_id, sim desc, sample_a, sample_b`;
  return new Map(rows.map((r) => [r.incident_id, r]));
}

const STRONG_KINDS: EntityKind[] = ["telefono", "cuenta"];
const WEAK_KINDS: EntityKind[] = ["nombre"];

function compare(a: Profile, b: Profile, voiceSim: number | null) {
  const reasons: LinkReason[] = [];

  if (voiceSim !== null && voiceSim >= 0.65) {
    reasons.push({
      kind: "voz",
      detail: `Similitud de voz ${(voiceSim * 100).toFixed(0)}% (${voiceSim >= 0.8 ? "alta" : "moderada"}). Es una pista, no una identificación.`,
    });
  }

  let entityScore = 0;
  for (const ea of a.entities) {
    const match = b.entities.find((eb) => eb.kind === ea.kind && eb.normalized === ea.normalized);
    if (!match) continue;
    if (STRONG_KINDS.includes(ea.kind)) {
      entityScore = 1;
      reasons.push({ kind: "dato_compartido", detail: `${ENTITY_LABELS[ea.kind]} repetido: ${ea.value}` });
    } else if (WEAK_KINDS.includes(ea.kind)) {
      entityScore = Math.max(entityScore, 0.5);
      reasons.push({ kind: "dato_compartido", detail: `${ENTITY_LABELS[ea.kind]} repetido: ${ea.value}` });
    }
  }

  const textSim = cosineMap(a.text, b.text);
  const union = new Set([...a.signalTypes, ...b.signalTypes]);
  const inter = [...a.signalTypes].filter((t) => b.signalTypes.has(t));
  const signalSim = union.size ? inter.length / union.size : 0;
  const contentSim = 0.5 * textSim + 0.5 * signalSim;
  if (contentSim >= 0.35) {
    reasons.push({
      kind: "contenido",
      detail: `Guion parecido: ${(contentSim * 100).toFixed(0)}% de coincidencia en palabras y tipos de señal.`,
    });
  }

  const score =
    voiceSim === null
      ? 0.6 * entityScore + 0.4 * contentSim
      : 0.45 * Math.max(0, voiceSim) + 0.35 * entityScore + 0.2 * contentSim;

  const propose = score >= 0.4 || entityScore === 1 || (voiceSim ?? 0) >= 0.8;
  return { propose, score, voiceSim, contentSim, reasons };
}

/** Recalcula vínculos del incidente contra los demás casos compartidos con su organización. */
export async function refreshLinksFor(incidentId: string, tx?: Db) {
  const sql = tx ?? (await db());
  const [inc] = await sql<{ id: string; org_id: string | null; simulated: boolean | null }[]>`
    select id, org_id, simulated from incidents where id = ${incidentId}`;
  if (!inc) return;
  if (!inc.org_id) {
    // Si deja de compartirse, se quitan los vínculos que aún no revisó nadie.
    await sql`delete from links where (incident_a = ${incidentId} or incident_b = ${incidentId}) and status = 'pendiente'`;
    return;
  }
  if (inc.simulated === null) return; // El origen histórico debe clasificarse antes de mezclar datos.

  const others = (
    await sql<{ id: string }[]>`select id from incidents where org_id = ${inc.org_id} and simulated=${inc.simulated} and id != ${incidentId}`
  ).map((r) => r.id);
  if (!others.length) return;

  const [profiles, voices, existing] = await Promise.all([
    loadProfiles(sql, [incidentId, ...others]),
    voiceSimilarity(sql, incidentId, others),
    sql<{ id: string; incident_a: string; incident_b: string; status: string }[]>`
      select id, incident_a, incident_b, status from links where incident_a = ${incidentId} or incident_b = ${incidentId}`,
  ]);
  const me = profiles.get(incidentId)!;

  for (const id of others) {
    const [a, b] = incidentId < id ? [incidentId, id] : [id, incidentId];
    const voice = voices.get(id);
    const result = compare(me, profiles.get(id)!, voice?.sim ?? null);
    const prev = existing.find((l) => l.incident_a === a && l.incident_b === b);
    // La decisión humana conserva exactamente las puntuaciones y razones que revisó.
    if (prev && prev.status !== "pendiente") continue;

    if (!result.propose) {
      if (prev?.status === "pendiente") await sql`delete from links where id = ${prev.id} and status='pendiente'`;
      continue;
    }
    const reasons = sql.json(result.reasons as unknown as postgres.JSONValue);
    const evidence = sql.json({
      algorithm: "links-v2", metric: "cosine", voice_threshold: 0.8,
      sample_a: voice ? (a === incidentId ? voice.sample_a : voice.sample_b) : null,
      sample_b: voice ? (a === incidentId ? voice.sample_b : voice.sample_a) : null,
      model_id: voice?.model_id ?? null, model_version: voice?.model_version ?? null,
      weights: voice ? { voice: 0.45, entities: 0.35, content: 0.2 } : { entities: 0.6, content: 0.4 },
    });
    await sql`insert into links (id,incident_a,incident_b,score,voice_sim,content_sim,reasons,evidence_snapshot,status,created_at)
      values (${newId("lnk")},${a},${b},${result.score},${result.voiceSim},${result.contentSim},${reasons},${evidence},'pendiente',${nowIso()})
      on conflict (incident_a,incident_b) do update set score=excluded.score, voice_sim=excluded.voice_sim,
        content_sim=excluded.content_sim, reasons=excluded.reasons, evidence_snapshot=excluded.evidence_snapshot
      where links.status='pendiente'`;
  }
}
