import "server-only";
import { newId, toVector, type Db } from "./db";
import { detectSignals, extractEntities, scoreFromSignalTypes } from "./heuristics";
import { refreshLinksFor } from "./links";
import { riskLevelFromScore, type EntityKind, type SignalType } from "./types";

/**
 * Datos ficticios para la demo. Las conversaciones están inventadas y las
 * "voces" son vectores sintéticos: no corresponden a personas reales.
 */

function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
}

const DIM = 192;
const rand = prng(20261017);
const speakers = Array.from({ length: 5 }, () => Array.from({ length: DIM }, () => gaussian(rand)));
function voiceOf(speaker: number) {
  return speakers[speaker].map((x) => x + 0.45 * gaussian(rand));
}

interface SeedIncident {
  user: string;
  daysAgo: number;
  hour: number;
  minutes: number;
  title: string;
  channel: string;
  /** Clasificación de la IA y número que llamó (ficticio). */
  scamType: string | null;
  impersonating: string | null;
  caller: string;
  /** Frases ficticias: solo sirven para derivar señales y datos; no se guardan. */
  lines: string[];
  shown?: { kind: EntityKind; value: string; normalized: string }[];
  summary: string;
  recommendation: string;
  shared: boolean;
  speaker: number;
  analystStatus?: "nuevo" | "en_revision" | "cerrado";
}

const INCIDENTS: SeedIncident[] = [
  {
    user: "usr_luis",
    daysAgo: 9,
    hour: 11,
    minutes: 6,
    title: "Falso familiar detenido pide depósito",
    scamType: "familiar_falso",
    impersonating: "Sobrino detenido",
    caller: "+525528417730",
    channel: "llamada",
    lines: [
      "Bueno, ¿tía? Soy tu sobrino, cambié de número. Tuve un problema, me detuvieron en la carretera.",
      "El licenciado Ramírez dice que si no pagas la multa ahora mismo me pasan al Ministerio Público.",
      "Necesito que deposites 15 mil pesos a la cuenta 4152 3138 0011 2233. No le digas a mi mamá, por favor.",
      "No cuelgues, el licenciado te va a dar las instrucciones.",
    ],
    shown: [{ kind: "telefono", value: "55 2841 7730", normalized: "5528417730" }],
    summary:
      "Alguien que dice ser el sobrino pide un depósito urgente para evitar una supuesta detención y pide no avisar a la familia.",
    recommendation: "Cuelga y llama a tu sobrino o a su mamá al número que ya tienes guardado antes de depositar.",
    shared: true,
    speaker: 0,
    analystStatus: "en_revision",
  },
  {
    user: "usr_marta",
    daysAgo: 6,
    hour: 18,
    minutes: 4,
    title: "Supuesto secuestro con exigencia de pago",
    scamType: "secuestro_virtual",
    impersonating: "Supuestos captores",
    caller: "+523319074521",
    channel: "llamada",
    lines: [
      "Escúchame bien, tenemos a tu hijo. Si no pagas le va a ir mal.",
      "Quiero 30 mil pesos en la cuenta 4152 3138 0011 2233, en menos de 30 minutos.",
      "No llames a la policía y no cuelgues, sabemos dónde vives.",
    ],
    shown: [{ kind: "telefono", value: "33 1907 4521", normalized: "3319074521" }],
    summary: "El interlocutor afirma tener retenido a un familiar, amenaza y exige un depósito inmediato.",
    recommendation:
      "Sin colgar esta llamada, intenta comunicarte con tu hijo desde otro teléfono. Si hay riesgo, llama al 911 o al 089.",
    shared: true,
    speaker: 0,
    analystStatus: "en_revision",
  },
  {
    user: "usr_ana",
    daysAgo: 8,
    hour: 13,
    minutes: 3,
    title: "Posible suplantación bancaria para obtener NIP",
    scamType: "suplantacion_bancaria",
    impersonating: "Banorte",
    caller: "+525590123344",
    channel: "llamada",
    lines: [
      "Buenas tardes, le hablamos del banco Banorte, su tarjeta fue clonada.",
      "Necesito su NIP y el número de su tarjeta para bloquearla, rápido, antes de que le roben más.",
    ],
    shown: [{ kind: "telefono", value: "55 9012 3344", normalized: "5590123344" }],
    summary: "Una persona que dice ser del banco pide el NIP y el número de tarjeta para un supuesto bloqueo.",
    recommendation: "Ningún banco pide tu NIP. Cuelga y llama al número que aparece detrás de tu tarjeta.",
    shared: true,
    speaker: 1,
  },
  {
    user: "usr_jorge",
    daysAgo: 4,
    hour: 10,
    minutes: 5,
    title: "Falso departamento de fraudes pide código",
    scamType: "suplantacion_bancaria",
    impersonating: "BBVA (fraudes)",
    caller: "+525590123344",
    channel: "llamada",
    lines: [
      "Le habla del departamento de fraudes de BBVA, detectamos un cargo no reconocido en su tarjeta.",
      "Para cancelarlo necesito el código de verificación que le llegó por mensaje y la fecha de vencimiento.",
      "Es urgente, en 5 minutos se procesa el cargo.",
    ],
    shown: [{ kind: "telefono", value: "55 9012 3344", normalized: "5590123344" }],
    summary: "Supuesto ejecutivo de fraudes pide el código de verificación y datos de la tarjeta con prisa.",
    recommendation: "No compartas códigos. Cuelga y llama a tu banco por su número oficial.",
    shared: true,
    speaker: 1,
    analystStatus: "nuevo",
  },
  {
    user: "usr_sofia",
    daysAgo: 3,
    hour: 20,
    minutes: 3,
    title: "Préstamo entre hermanas (conversación legítima)",
    scamType: null,
    impersonating: null,
    caller: "+525547781290",
    channel: "llamada",
    lines: [
      "Hola, soy yo, Carla. Oye, ¿me prestas 2 mil pesos para la colegiatura? Te los pago el viernes.",
      "Si quieres lo platicamos en la comida del domingo con mamá, no te preocupes.",
    ],
    summary: "Una familiar pide un préstamo sin presión y propone hablarlo en persona.",
    recommendation: "Hay una solicitud de dinero sin otras señales. Si tienes dudas, confírmalo en persona.",
    shared: true,
    speaker: 2,
    analystStatus: "cerrado",
  },
  {
    user: "usr_marta",
    daysAgo: 2,
    hour: 12,
    minutes: 4,
    title: "Supuesto premio con pago de envío",
    scamType: "premio_falso",
    impersonating: "Lic. Ramírez (sorteo)",
    caller: "+528112345678",
    channel: "llamada",
    lines: [
      "Felicidades, habla el licenciado Ramírez, usted ganó una camioneta en el sorteo.",
      "Solo tiene que pagar el envío, 4 mil 500 pesos en OXXO, hoy mismo, y no le diga a nadie hasta recibirla.",
    ],
    summary: "Se anuncia un premio no solicitado y se pide un pago inmediato y en secreto para recibirlo.",
    recommendation: "No pagues para recibir un premio. Verifica el sorteo por canales oficiales.",
    shared: true,
    speaker: 0,
    analystStatus: "nuevo",
  },
  {
    user: "usr_pedro",
    daysAgo: 0,
    hour: 9,
    minutes: 4,
    title: "Supuesto adeudo con el SAT",
    scamType: "autoridad_falsa",
    impersonating: "SAT",
    caller: "+525588001122",
    channel: "llamada",
    lines: [
      "Le hablamos del SAT, tiene un adeudo y una orden de embargo para hoy.",
      "Para detenerla debe pagar 8 mil pesos de inmediato a la cuenta 0121 8000 4455 6677 88.",
    ],
    summary: "Supuesta autoridad fiscal exige un pago inmediato para evitar un embargo.",
    recommendation: "El SAT no cobra por teléfono. Consulta tu situación en el portal oficial.",
    shared: true,
    speaker: 3,
    analystStatus: "nuevo",
  },
  {
    user: "usr_ana",
    daysAgo: 1,
    hour: 17,
    minutes: 2,
    title: "Mensaje de 'cambié de número' con transferencia",
    scamType: "familiar_falso",
    impersonating: "Hijo o hija",
    caller: "+525561239876",
    channel: "llamada",
    lines: [
      "Hola mamá, cambié de número, guárdalo. ¿Me puedes hacer una transferencia urgente? Luego te explico.",
    ],
    summary: "Alguien dice ser un familiar con número nuevo y pide una transferencia urgente.",
    recommendation: "Llama al número anterior de tu familiar para confirmar antes de transferir.",
    shared: false,
    speaker: 4,
  },
];

export async function seedDemoData(sql: Db) {
  await sql`insert into organizations ${sql([
    { id: "org_uav", name: "Unidad de Atención a Víctimas (demo)" },
  ])}`;
  await sql`insert into users ${sql([
    { id: "usr_ana", name: "Ana (usuaria demo)", role: "usuario", org_id: null },
    { id: "usr_luis", name: "Luis (voluntario)", role: "usuario", org_id: null },
    { id: "usr_marta", name: "Marta (voluntaria)", role: "usuario", org_id: null },
    { id: "usr_jorge", name: "Jorge (voluntario)", role: "usuario", org_id: null },
    { id: "usr_sofia", name: "Sofía (voluntaria)", role: "usuario", org_id: null },
    { id: "usr_pedro", name: "Pedro (voluntario)", role: "usuario", org_id: null },
    { id: "usr_analista", name: "Analista demo", role: "analista", org_id: "org_uav" },
  ])}`;

  const incidents: Record<string, unknown>[] = [];
  const signals: Record<string, unknown>[] = [];
  const entities: Record<string, unknown>[] = [];
  const actions: Record<string, unknown>[] = [];
  const voices: Record<string, unknown>[] = [];
  const action = (incident_id: string, kind: string, detail: string, created_at: string) =>
    actions.push({ id: newId("act"), incident_id, kind, detail, created_at });

  const ids: string[] = [];
  for (const s of INCIDENTS) {
    const id = newId("inc");
    ids.push(id);
    const start = new Date();
    start.setDate(start.getDate() - s.daysAgo);
    start.setHours(s.hour, 0, 0, 0);
    // Si el caso de hoy quedaría en el futuro, se mueve una hora atrás.
    if (start.getTime() > Date.now()) start.setTime(Date.now() - 3600_000);
    const end = new Date(start.getTime() + s.minutes * 60_000);
    const at = (sec: number) => new Date(start.getTime() + sec * 1000).toISOString();

    const lineRows = s.lines.map((text, i) => ({ text, t: i * 20 + 4 }));
    const types = new Set<SignalType>();
    for (const line of lineRows) for (const sig of detectSignals(line.text)) types.add(sig.type);
    const score = scoreFromSignalTypes(types);

    incidents.push({
      id,
      external_id: `llamada-${1000 + ids.length}`,
      user_id: s.user,
      title: s.title,
      channel: s.channel,
      status: "finalizado",
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      risk_score: score,
      risk_level: riskLevelFromScore(score),
      summary: s.summary,
      recommendation: s.recommendation,
      org_id: s.shared ? "org_uav" : null,
      analyst_status: s.analystStatus ?? "nuevo",
      simulated: true,
      verdict: score >= 65 ? "scam" : score >= 35 ? "suspicious" : "safe",
      scam_type: s.scamType,
      impersonating: s.impersonating,
      caller_e164: s.caller,
      direction: "incoming",
      analysis_status: "completed",
      consent_snapshot: sql.json({ voice_storage: true, voice_reference: true }),
    });
    action(id, "captura_iniciada", "Captura y análisis autorizados por el usuario.", at(0));

    const seen = new Set<string>();
    for (const line of lineRows) {
      for (const sig of detectSignals(line.text)) {
        signals.push({
          id: newId("sig"),
          incident_id: id,
          type: sig.type,
          evidence: "",
          explanation: sig.explanation,
          confidence: sig.confidence,
          source: "reglas",
          created_at: at(line.t + 2),
        });
      }
      for (const e of extractEntities(line.text)) {
        const key = `${e.kind}:${e.normalized}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entities.push({
          id: newId("ent"),
          incident_id: id,
          kind: e.kind,
          value: e.value,
          normalized: e.normalized,
          provenance: "mencionado",
        });
      }
    }
    for (const e of s.shown ?? []) {
      entities.push({ id: newId("ent"), incident_id: id, ...e, provenance: "mostrado" });
    }
    voices.push({
      id: newId("voz"),
      incident_id: id,
      embedding: toVector(voiceOf(s.speaker)),
      duration_s: 18 + s.lines.length * 6,
      created_at: at(30),
    });

    if (score >= 65) action(id, "alerta_mostrada", `Alerta de riesgo alto mostrada al usuario (riesgo estimado ${score}).`, at(30));
    action(id, "captura_detenida", "El usuario detuvo la captura. Reporte listo para revisión.", end.toISOString());
    if (s.shared) {
      action(
        id,
        "compartido",
        "El usuario autorizó compartir este incidente con la organización.",
        new Date(end.getTime() + 60_000).toISOString(),
      );
    }
  }

  await sql`insert into incidents ${sql(incidents)}`;
  await sql`insert into signals ${sql(signals)}`;
  await sql`insert into entities ${sql(entities)}`;
  await sql`insert into actions ${sql(actions)}`;
  for (const v of voices) {
    await sql`insert into voice_samples (id, incident_id, embedding, duration_s, created_at,model_id,model_version,speaker,quality_status,review_status,reference_enabled)
              values (${v.id as string}, ${v.incident_id as string}, ${v.embedding as string}::extensions.vector,
                      ${v.duration_s as number}, ${v.created_at as string},'demo-synthetic','1','caller','usable','aprobada',true)`;
  }

  for (const id of ids) await refreshLinksFor(id, sql);

  // Un vínculo ya revisado, para que el panel muestre los tres estados.
  const [luis, marta] = ids;
  const [a, b] = luis < marta ? [luis, marta] : [marta, luis];
  await sql`update links set status = 'confirmado', reviewed_by = 'Analista demo', reviewed_by_id='usr_analista',
            reviewed_at = ${new Date(Date.now() - 2 * 86400000).toISOString()},
            note = ${"Misma cuenta destino y voz muy parecida. Se documenta como posible campaña; falta corroboración independiente."}
            where incident_a = ${a} and incident_b = ${b}`;
}
