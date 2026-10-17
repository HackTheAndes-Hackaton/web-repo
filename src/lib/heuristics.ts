import type { EntityKind, SignalType } from "./types";

/**
 * Análisis por reglas. Se usa cuando no hay credenciales de Claude o si la API
 * falla, para que la demo funcione sin conexión. Es deliberadamente simple.
 */

interface Rule {
  type: SignalType;
  patterns: RegExp[];
  explanation: string;
}

const RULES: Rule[] = [
  {
    type: "urgencia",
    patterns: [
      /\b(ahora mismo|ya mismo|de inmediato|inmediatamente|urgente|r[aá]pido|no hay tiempo|hoy mismo|cuanto antes)\b/i,
      /\ben (los pr[oó]ximos |menos de )?\d+ minutos\b/i,
      /\bantes de que\b/i,
    ],
    explanation:
      "Se pide actuar con prisa. La urgencia reduce el tiempo para verificar; conviene pausar y confirmar por otro medio.",
  },
  {
    type: "dinero",
    patterns: [
      /\b(deposit|transfier|transferencia|env[ií]a(me|le)?|manda(me|le)?)\w*\b.*\b(dinero|pesos|d[oó]lares|lana|feria)\b/i,
      /\b(dinero|pesos|d[oó]lares|rescate|fianza|multa|pago|pagar|transferencia|tarjeta de regalo|oxxo|retiro sin tarjeta)\b/i,
      /\$\s?\d/,
    ],
    explanation:
      "Hay una solicitud de dinero o pago. Por sí sola no demuestra un engaño, pero justifica verificar quién lo pide.",
  },
  {
    type: "datos_sensibles",
    patterns: [
      /\b(contrase[nñ]a|nip|cvv|c[oó]digo de (verificaci[oó]n|seguridad)|c[oó]digo que te (lleg[oó]|enviamos)|token|clave de acceso)\b/i,
      /\b(n[uú]mero|datos) de (tu |su )?(tarjeta|cuenta)\b/i,
      /\bfecha de vencimiento\b/i,
    ],
    explanation:
      "Se solicitan datos que normalmente nadie legítimo pide por teléfono (códigos, NIP, datos de tarjeta).",
  },
  {
    type: "secreto",
    patterns: [
      /\bno (le |les |se lo )?(digas?|cuentes?|avises?|comentes?)\b/i,
      /\bnadie (puede|debe|tiene que) (saber|enterarse)\b/i,
      /\b(es un secreto|entre nosotros|no llames a la polic[ií]a)\b/i,
    ],
    explanation:
      "Se pide mantener la conversación en secreto, lo que impide que otras personas ayuden a verificar.",
  },
  {
    type: "amenaza",
    patterns: [
      /\b((lo|la|los|las) (tenemos|vamos a lastimar|vamos a matar)|tenemos a tu)\b/i,
      /\b(secuestr|detenid|detuvieron|levantad)\w*\b/i,
      /\bsi no (pagas|depositas|haces|cooperas)\b/i,
      /\b(sabemos d[oó]nde vives|te va a pasar algo|le va a ir mal|vamos por ti)\b/i,
    ],
    explanation:
      "Hay amenazas o intimidación. Si hay riesgo inmediato, contacta a emergencias; no negocies a solas.",
  },
  {
    type: "suplantacion",
    patterns: [
      /\b(soy|habla|le hablamos|te hablamos) (de|del) (banco|departamento de fraudes|sat|ministerio p[uú]blico|fiscal[ií]a|polic[ií]a)\b/i,
      /\bsoy tu (hijo|hija|nieto|nieta|sobrino|sobrina|primo|prima)\b/i,
      /\b(no me reconoces|adivina qui[eé]n (soy|habla)|cambi[eé] de n[uú]mero)\b/i,
      /\b(licenciado|agente|oficial|comandante)\b/i,
    ],
    explanation:
      "El interlocutor se presenta como alguien de confianza o una autoridad. El nombre o número mostrado pueden ser falsos.",
  },
  {
    type: "aislamiento",
    patterns: [
      /\bno (cuelgues?|cortes?|salgas?|contestes?)\b/i,
      /\b(qu[eé]date en la l[ií]nea|ap[aá]ga(lo|r)? (tu|el) (otro )?(tel[eé]fono|celular)|enci[eé]rrate)\b/i,
    ],
    explanation:
      "Se intenta mantenerte en la llamada o aislarte, lo que impide comunicarte con tus contactos.",
  },
];

const WEIGHTS: Record<SignalType, number> = {
  amenaza: 32,
  datos_sensibles: 26,
  dinero: 20,
  secreto: 20,
  suplantacion: 18,
  aislamiento: 18,
  urgencia: 14,
};

export interface DetectedSignal {
  type: SignalType;
  evidence: string;
  explanation: string;
  confidence: number;
}

export interface DetectedEntity {
  kind: EntityKind;
  value: string;
  normalized: string;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?¿¡])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detectSignals(text: string): DetectedSignal[] {
  const found: DetectedSignal[] = [];
  const parts = sentences(text);
  for (const rule of RULES) {
    for (const sentence of parts) {
      if (rule.patterns.some((p) => p.test(sentence))) {
        found.push({
          type: rule.type,
          evidence: sentence,
          explanation: rule.explanation,
          confidence: 0.6,
        });
        break; // una evidencia por tipo y fragmento
      }
    }
  }
  return found;
}

/** Riesgo estimado a partir de los tipos distintos de señales observadas en toda la conversación. */
export function scoreFromSignalTypes(types: Iterable<SignalType>): number {
  const distinct = new Set(types);
  if (distinct.size === 0) return 5;
  let score = 0;
  for (const t of distinct) score += WEIGHTS[t];
  // Una señal aislada no confirma una estafa: se limita el riesgo.
  if (distinct.size === 1) score = Math.min(score, 30);
  // Combinaciones típicas de engaño.
  if (distinct.has("dinero") && distinct.has("urgencia") && distinct.has("secreto")) score += 10;
  if (distinct.has("amenaza") && distinct.has("dinero")) score += 10;
  return Math.max(5, Math.min(97, score));
}

const ORGS = [
  "BBVA",
  "Banorte",
  "Santander",
  "Banamex",
  "HSBC",
  "Scotiabank",
  "Banco Azteca",
  "SAT",
  "IMSS",
  "Fiscalía",
  "Policía",
  "Ministerio Público",
  "Guardia Nacional",
  "CONDUSEF",
];

export function normalizeText(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function extractEntities(text: string): DetectedEntity[] {
  const out: DetectedEntity[] = [];
  const push = (kind: EntityKind, value: string, normalized: string) => {
    if (!out.some((e) => e.kind === kind && e.normalized === normalized)) {
      out.push({ kind, value: value.trim(), normalized });
    }
  };

  // Cuentas, tarjetas o CLABE (16 a 18 dígitos, con o sin espacios).
  for (const m of text.matchAll(/\b(?:\d[\s-]?){16,18}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 16 && digits.length <= 18) push("cuenta", m[0], digits);
  }

  // Teléfonos de 10 dígitos (México), con prefijo opcional.
  for (const m of text.matchAll(/(?:\+?52[\s-]?)?\(?\d{2,3}\)?[\s-]?\d{3,4}[\s-]?\d{4}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    const last10 = digits.slice(-10);
    if (last10.length === 10 && !out.some((e) => e.kind === "cuenta" && e.normalized.includes(digits))) {
      push("telefono", m[0], last10);
    }
  }

  // Montos.
  for (const m of text.matchAll(/\$\s?\d[\d,.]*(?:\s?mil)?|\b\d[\d,.]*\s?(?:mil\s)?(?:pesos|d[oó]lares)\b/gi)) {
    const raw = m[0];
    let n = Number(raw.replace(/[^\d.]/g, "").replace(/\.(?=\d{3}\b)/g, ""));
    if (/mil/i.test(raw)) n *= 1000;
    if (n > 0) push("monto", raw, String(Math.round(n)));
  }

  // Organizaciones mencionadas.
  for (const org of ORGS) {
    const re = new RegExp(`\\b${normalizeText(org)}\\b`, "i");
    if (re.test(normalizeText(text))) push("organizacion", org, normalizeText(org));
  }

  // Nombres con los que alguien se presenta.
  for (const m of text.matchAll(
    /\b(?:soy|me llamo|habla|le habla)\s+(?:el |la )?(?:licenciad[oa] |lic\. |agente |oficial |comandante )?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/g,
  )) {
    const name = m[1];
    if (!ORGS.some((o) => normalizeText(o) === normalizeText(name))) push("nombre", name, normalizeText(name));
  }

  // Cargos con los que se suele presentar un supuesto intermediario ("el licenciado Ramírez").
  for (const m of text.matchAll(/\b(?:licenciad[oa]|lic\.|agente|oficial|comandante)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g)) {
    push("nombre", m[1], normalizeText(m[1]));
  }

  return out;
}

/** Valor normalizado de un dato para compararlo entre casos. */
export function normalizeEntity(kind: string, value: string): string {
  if (kind === "telefono") return value.replace(/\D/g, "").slice(-10);
  if (kind === "cuenta" || kind === "monto") return value.replace(/\D/g, "");
  return normalizeText(value);
}
