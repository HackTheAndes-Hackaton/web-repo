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
      from segments where incident_id in ${sql(ids)} group by incident_id`,
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
  const rows = await sql<{ incident_id: string; sim: number }[]>`
    select b.incident_id, max(1 - (a.embedding operator(extensions.<=>) b.embedding))::float8 as sim
    from voice_samples a
    join voice_samples b on b.incident_id in ${sql(others)}
    where a.incident_id = ${id}
    group by b.incident_id`;
  return new Map(rows.map((r) => [r.incident_id, r.sim]));
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
  const [inc] = await sql<{ id: string; org_id: string | null }[]>`
    select id, org_id from incidents where id = ${incidentId}`;
  if (!inc) return;
  if (!inc.org_id) {
    // Si deja de compartirse, se quitan los vínculos que aún no revisó nadie.
    await sql`delete from links where (incident_a = ${incidentId} or incident_b = ${incidentId}) and status = 'pendiente'`;
    return;
  }

  const others = (
    await sql<{ id: string }[]>`select id from incidents where org_id = ${inc.org_id} and id != ${incidentId}`
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
    const result = compare(me, profiles.get(id)!, voices.get(id) ?? null);
    const prev = existing.find((l) => l.incident_a === a && l.incident_b === b);

    if (!result.propose) {
      if (prev?.status === "pendiente") await sql`delete from links where id = ${prev.id}`;
      continue;
    }
    const reasons = sql.json(result.reasons as unknown as postgres.JSONValue);
    if (prev) {
      await sql`update links set score = ${result.score}, voice_sim = ${result.voiceSim},
                content_sim = ${result.contentSim}, reasons = ${reasons} where id = ${prev.id}`;
    } else {
      await sql`insert into links (id, incident_a, incident_b, score, voice_sim, content_sim, reasons, status, created_at)
                values (${newId("lnk")}, ${a}, ${b}, ${result.score}, ${result.voiceSim}, ${result.contentSim},
                        ${reasons}, 'pendiente', ${nowIso()})`;
    }
  }
}
