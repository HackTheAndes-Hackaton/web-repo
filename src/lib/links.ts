import "server-only";
import type postgres from "postgres";
import { db, newId, nowIso, type Db } from "./db";
import { ENTITY_LABELS, type EntityKind, type LinkReason, type SignalType } from "./types";
import { entityMatchKeyPe, normalizePhonePe } from "./peru";

/**
 * Propone vínculos entre incidentes compartidos con la misma organización.
 * Combina similitud de voz, el número de origen, datos repetidos y coincidencia
 * de tipos de señal (la transcripción no se compara). Los
 * vínculos quedan "pendientes" hasta que un analista los confirma o descarta.
 */

interface Profile {
  id: string;
  signalTypes: Set<SignalType>;
  entities: { kind: EntityKind; normalized: string; value: string; analysis_meta: Record<string, unknown> }[];
  /** Número desde el que llamaron (identificador de llamada), con la misma clave que entityMatchKeyPe. */
  caller: { key: string; value: string } | null;
}

/** Carga en lote las señales y los datos de varios incidentes. */
async function loadProfiles(sql: Db, ids: string[]) {
  const [types, entities, callers] = await Promise.all([
    sql<{ incident_id: string; type: SignalType }[]>`
      select distinct incident_id, type from signals where incident_id in ${sql(ids)}`,
    sql<{ incident_id: string; kind: EntityKind; normalized: string; value: string; analysis_meta: Record<string, unknown> }[]>`
      select incident_id, kind, normalized, value, analysis_meta from entities where incident_id in ${sql(ids)}`,
    sql<{ id: string; caller: string | null }[]>`
      select id, coalesce(caller_e164, caller_number_raw) as caller from incidents where id in ${sql(ids)}`,
  ]);
  const profiles = new Map<string, Profile>(
    ids.map((id) => [id, { id, signalTypes: new Set(), entities: [], caller: null }]),
  );
  for (const t of types) profiles.get(t.incident_id)!.signalTypes.add(t.type);
  for (const e of entities) profiles.get(e.incident_id)!.entities.push(e);
  for (const c of callers) {
    const key = c.caller ? callerKey(c.caller) : null;
    if (key) profiles.get(c.id)!.caller = { key, value: c.caller! };
  }
  return profiles;
}

/**
 * Clave del número de origen. Un número peruano usa la misma clave que los
 * teléfonos observados (entityMatchKeyPe); otro número solo se compara en E.164
 * exacto. Los números ocultos o incompletos no se comparan.
 */
function callerKey(raw: string) {
  const pe = normalizePhonePe(raw);
  if (pe) return `telefono:${pe}`;
  const e164 = raw.replace(/[\s().-]/g, "");
  return /^\+\d{8,15}$/.test(e164) ? `telefono:${e164}` : null;
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

const STRONG_KINDS: EntityKind[] = ["telefono", "cuenta", "cci", "billetera"];
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
  const phones = new Set<string>();
  // El número de origen se compara con el de la otra llamada y con los teléfonos que se mencionaron en ella.
  if (a.caller && b.caller && a.caller.key === b.caller.key) {
    entityScore = 1;
    phones.add(a.caller.key);
    reasons.push({
      kind: "dato_compartido",
      detail: `Mismo número de origen: ${a.caller.value}. El identificador de llamada puede falsificarse.`,
    });
  }
  for (const [x, y] of [[a, b], [b, a]] as const) {
    if (!x.caller || phones.has(x.caller.key)) continue;
    if (y.entities.some((e) => e.kind === "telefono" && entityMatchKeyPe(e) === x.caller!.key)) {
      entityScore = 1;
      phones.add(x.caller.key);
      reasons.push({ kind: "dato_compartido", detail: `Teléfono repetido: ${x.caller.value} llamó en un caso y se mencionó en el otro.` });
    }
  }
  for (const ea of a.entities) {
    const key = entityMatchKeyPe(ea);
    const match = b.entities.find((eb) => STRONG_KINDS.includes(ea.kind)
      ? key !== null && entityMatchKeyPe(eb) === key
      : eb.kind === ea.kind && eb.normalized === ea.normalized);
    if (!match) continue;
    if (ea.kind === "telefono" && key !== null && phones.has(key)) continue;
    if (STRONG_KINDS.includes(ea.kind)) {
      entityScore = 1;
      reasons.push({ kind: "dato_compartido", detail: `${ENTITY_LABELS[ea.kind]} repetido: ${ea.value}` });
    } else if (WEAK_KINDS.includes(ea.kind)) {
      entityScore = Math.max(entityScore, 0.5);
      reasons.push({ kind: "dato_compartido", detail: `${ENTITY_LABELS[ea.kind]} repetido: ${ea.value}` });
    }
  }

  // Coincidencia de tipos de señal (Jaccard): mismo patrón de engaño.
  const union = new Set([...a.signalTypes, ...b.signalTypes]);
  const inter = [...a.signalTypes].filter((t) => b.signalTypes.has(t));
  const contentSim = union.size ? inter.length / union.size : 0;
  if (contentSim >= 0.5) {
    reasons.push({
      kind: "contenido",
      detail: `Patrón de señales parecido: ${(contentSim * 100).toFixed(0)}% de coincidencia en los tipos de señal.`,
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
  const [inc] = await sql<{ id: string; org_id: string | null; simulated: boolean | null; sharing_revoked_at:string|null }[]>`
    select id, org_id, simulated, sharing_revoked_at from incidents where id = ${incidentId}`;
  if (!inc) return;
  if (!inc.org_id || inc.sharing_revoked_at) {
    // Si deja de compartirse, se quitan los vínculos que aún no revisó nadie.
    await sql`delete from links where (incident_a = ${incidentId} or incident_b = ${incidentId}) and status = 'pendiente'`;
    return;
  }
  if (inc.simulated === null) return; // El origen histórico debe clasificarse antes de mezclar datos.

  const others = (
    await sql<{ id: string }[]>`select id from incidents where org_id = ${inc.org_id} and simulated=${inc.simulated}
      and sharing_revoked_at is null and id != ${incidentId}`
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
      algorithm: "links-v5-pe", entity_normalization: "pe-v1", caller_comparison: true, metric: "cosine", voice_threshold: 0.8,
      sample_a: voice ? (a === incidentId ? voice.sample_a : voice.sample_b) : null,
      sample_b: voice ? (a === incidentId ? voice.sample_b : voice.sample_a) : null,
      model_id: voice?.model_id ?? null, model_version: voice?.model_version ?? null,
      weights: voice ? { voice: 0.45, entities: 0.35, content: 0.2 } : { entities: 0.6, content: 0.4 },
    });
    await sql`insert into links (id,incident_a,incident_b,score,voice_sim,content_sim,reasons,evidence_snapshot,status,created_at)
      values (${newId("lnk")},${a},${b},${result.score},${result.voiceSim},${result.contentSim},${reasons},${evidence},'pendiente',${nowIso()})
      on conflict (incident_a,incident_b) do update set score=excluded.score, voice_sim=excluded.voice_sim,
        content_sim=excluded.content_sim, reasons=excluded.reasons, evidence_snapshot=excluded.evidence_snapshot
      where links.status='pendiente' and
        (links.score,links.voice_sim,links.content_sim,links.reasons,links.evidence_snapshot - 'ai_explanation')
        is distinct from
        (excluded.score,excluded.voice_sim,excluded.content_sim,excluded.reasons,excluded.evidence_snapshot)`;
  }
}
