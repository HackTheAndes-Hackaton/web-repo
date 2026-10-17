import "server-only";
import { db, newId, nowIso, toVector } from "./db";
import { analyzeSegment, rulesRiskScore } from "./analysis";
import { emit } from "./events";
import { refreshLinksFor } from "./links";
import { getIncident, logAction } from "./repo";
import {
  CHANNEL_LABELS,
  SIGNAL_LABELS,
  riskLevelFromScore,
  type Channel,
  type Provenance,
  type SignalType,
} from "./types";

export async function startIncident(userId: string, channel: Channel) {
  const sql = await db();
  const id = newId("inc");
  await sql.begin(async (tx) => {
    await tx`insert into incidents (id, user_id, title, channel, status, started_at, risk_score, risk_level)
             values (${id}, ${userId}, 'Conversación en curso', ${channel}, 'en_curso', ${nowIso()}, 5, 'bajo')`;
    await logAction(id, "captura_iniciada", `Captura y análisis autorizados por el usuario (${CHANNEL_LABELS[channel]}).`, tx);
  });
  emit({ type: "incident", userId, orgId: null, incidentId: id });
  return id;
}

function titleFor(types: SignalType[]) {
  const t = new Set(types);
  if (t.has("amenaza") && t.has("dinero")) return "Posible extorsión con exigencia de pago";
  if (t.has("suplantacion") && t.has("datos_sensibles")) return "Posible suplantación para obtener datos";
  if (t.has("suplantacion") && t.has("dinero")) return "Posible suplantación con solicitud de dinero";
  if (t.has("dinero") && t.has("urgencia")) return "Solicitud urgente de dinero";
  if (t.has("datos_sensibles")) return "Solicitud de datos sensibles";
  if (t.size) return SIGNAL_LABELS[[...t][0]];
  return "Conversación sin señales relevantes";
}

async function signalTypes(incidentId: string) {
  const sql = await db();
  return (await sql<{ type: SignalType }[]>`select distinct type from signals where incident_id = ${incidentId}`).map(
    (r) => r.type,
  );
}

export async function endIncident(incidentId: string) {
  const inc = await getIncident(incidentId);
  if (!inc || inc.status === "finalizado") return;
  const types = await signalTypes(incidentId);
  const sql = await db();
  await sql.begin(async (tx) => {
    await tx`update incidents set status = 'finalizado', ended_at = ${nowIso()},
             title = ${inc.title === "Conversación en curso" ? titleFor(types) : inc.title}
             where id = ${incidentId}`;
    await logAction(incidentId, "captura_detenida", "El usuario detuvo la captura. Reporte listo para revisión.", tx);
    if (inc.shared_org_id) await refreshLinksFor(incidentId, tx);
  });
  emit({ type: "incident", userId: inc.user_id, orgId: inc.shared_org_id, incidentId });
}

export interface SegmentInput {
  text: string;
  tOffset?: number;
  provenance?: Provenance;
}

export async function processSegment(incidentId: string, input: SegmentInput) {
  const sql = await db();
  const inc = await getIncident(incidentId);
  if (!inc) throw new Error("Incidente no encontrado");
  const text = input.text.trim();

  const [prevRows, [{ n: idx }]] = await Promise.all([
    sql<{ text: string }[]>`select text from segments where incident_id = ${incidentId} order by idx desc limit 12`,
    sql<{ n: number }[]>`select count(*)::int as n from segments where incident_id = ${incidentId}`,
  ]);
  const previous = prevRows.map((r) => r.text).reverse();
  const tOffset = input.tOffset ?? (Date.now() - Date.parse(inc.started_at)) / 1000;
  const segmentId = newId("seg");

  // Se guarda el fragmento antes de analizar para que aparezca de inmediato.
  await sql`insert into segments (id, incident_id, idx, t_offset, text, created_at)
            values (${segmentId}, ${incidentId}, ${idx}, ${tOffset}, ${text || "(sin transcripción)"}, ${nowIso()})`;
  emit({ type: "segment", userId: inc.user_id, incidentId });

  if (!text) return { segmentId, analysis: null };

  const analysis = await analyzeSegment(previous, text);

  await sql.begin(async (tx) => {
    const now = nowIso();
    for (const s of analysis.signals) {
      await tx`insert into signals (id, incident_id, segment_id, type, evidence, explanation, confidence, source, created_at)
               values (${newId("sig")}, ${incidentId}, ${segmentId}, ${s.type}, ${s.evidence}, ${s.explanation},
                       ${s.confidence}, ${analysis.source}, ${now})`;
    }
    for (const e of analysis.entities) {
      await tx`insert into entities (id, incident_id, segment_id, kind, value, normalized, provenance)
               select ${newId("ent")}, ${incidentId}, ${segmentId}, ${e.kind}, ${e.value}, ${e.normalized},
                      ${input.provenance ?? "mencionado"}
               where not exists (select 1 from entities where incident_id = ${incidentId}
                                 and kind = ${e.kind} and normalized = ${e.normalized})`;
    }

    const allTypes = (
      await tx<{ type: SignalType }[]>`select distinct type from signals where incident_id = ${incidentId}`
    ).map((r) => r.type);
    const score = analysis.riskScore ?? rulesRiskScore(allTypes);
    const summary =
      analysis.summary ??
      (allTypes.length
        ? `Señales observadas: ${allTypes.map((t) => SIGNAL_LABELS[t].toLowerCase()).join(", ")}.`
        : "Sin señales de riesgo por ahora.");
    const recommendation =
      analysis.recommendation ??
      (score >= 65
        ? "Pausa la conversación. No envíes dinero ni datos; verifica llamando tú a la persona o institución a un número que ya tengas."
        : score >= 35
          ? "Verifica la identidad por otro medio antes de hacer lo que te piden."
          : null);

    await tx`update incidents set risk_score = ${score}, risk_level = ${riskLevelFromScore(score)},
             summary = ${summary}, recommendation = coalesce(${recommendation}, recommendation)
             where id = ${incidentId}`;

    if (analysis.error) await logAction(incidentId, "analisis_respaldo", analysis.error, tx);
    if (riskLevelFromScore(score) === "alto" && inc.risk_level !== "alto") {
      await logAction(incidentId, "alerta_mostrada", `Alerta de riesgo alto mostrada al usuario (riesgo estimado ${score}).`, tx);
    }
  });

  emit({ type: "segment", userId: inc.user_id, incidentId });
  if (inc.shared_org_id) emit({ type: "incident", userId: inc.user_id, orgId: inc.shared_org_id, incidentId });
  return { segmentId, analysis };
}

export async function addVoiceSample(incidentId: string, embedding: number[], durationS: number | null) {
  const sql = await db();
  await sql`insert into voice_samples (id, incident_id, embedding, duration_s, created_at)
            values (${newId("voz")}, ${incidentId}, ${toVector(embedding)}::extensions.vector, ${durationS}, ${nowIso()})`;
}

export async function setSharing(incidentId: string, orgId: string | null) {
  const inc = await getIncident(incidentId);
  if (!inc) return;
  const sql = await db();
  await sql.begin(async (tx) => {
    await tx`update incidents set shared_org_id = ${orgId}, shared_at = ${orgId ? nowIso() : null} where id = ${incidentId}`;
    await logAction(
      incidentId,
      orgId ? "compartido" : "compartir_revocado",
      orgId
        ? "El usuario autorizó compartir este incidente con la organización."
        : "El usuario retiró el permiso para compartir este incidente.",
      tx,
    );
    await refreshLinksFor(incidentId, tx);
  });
  emit({ type: "incident", userId: inc.user_id, orgId: orgId ?? inc.shared_org_id, incidentId });
  const org = orgId ?? inc.shared_org_id;
  if (org) emit({ type: "links", orgId: org });
}
