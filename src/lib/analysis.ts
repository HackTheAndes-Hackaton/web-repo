import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ENTITY_KINDS, SIGNAL_TYPES, type SignalType } from "./types";
import {
  detectSignals,
  extractEntities,
  normalizeText,
  scoreFromSignalTypes,
  type DetectedEntity,
  type DetectedSignal,
} from "./heuristics";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

const AnalysisSchema = z.object({
  risk_score: z
    .number()
    .describe("Riesgo estimado de 0 a 100 para toda la conversación hasta ahora."),
  summary: z.string().describe("Resumen neutral de una o dos frases de lo que ocurre."),
  recommendation: z
    .string()
    .describe("Una acción concreta y breve para el usuario, en segunda persona."),
  signals: z.array(
    z.object({
      type: z.enum(SIGNAL_TYPES),
      evidence: z.string().describe("Cita textual del FRAGMENTO NUEVO que sustenta la señal."),
      explanation: z.string().describe("Por qué es una señal de riesgo, en lenguaje sencillo."),
      confidence: z.number().describe("De 0 a 1."),
    }),
  ),
  entities: z.array(
    z.object({
      kind: z.enum(ENTITY_KINDS),
      value: z.string().describe("Tal como aparece en el fragmento nuevo."),
    }),
  ),
});

const SYSTEM_PROMPT = `Eres el motor de análisis de un asistente que ayuda a personas a reconocer posibles estafas o extorsiones durante una conversación (llamada en altavoz o conversación presencial). Recibes la transcripción automática, que puede contener errores, por fragmentos.

Tu trabajo es señalar señales de riesgo observables, no juzgar a nadie:
- Tipos de señal: urgencia (presión para actuar ya), dinero (solicitud de dinero o pagos), datos_sensibles (NIP, contraseñas, códigos, datos de tarjeta), secreto (pedir que no se cuente a nadie), amenaza (intimidación, supuestos secuestros o detenciones), suplantacion (se presenta como familiar, banco o autoridad sin forma de verificarlo), aislamiento (no colgar, no hablar con otros).
- Reporta solo señales del FRAGMENTO NUEVO; usa el contexto previo para interpretarlas. La evidencia debe ser una cita textual de ese fragmento.
- Una señal aislada no confirma un engaño: una petición urgente de dinero de un familiar justifica verificar, no acusar. Ajusta el riesgo según la combinación de señales y el contexto, y bájalo si la conversación muestra que es legítima.
- Nunca afirmes que alguien es un estafador. Habla de "posible" y de "señales observadas".
- La recomendación debe ser práctica: por ejemplo, colgar y llamar al familiar al número que ya tienes guardado, no compartir códigos, o contactar al banco por su número oficial.
- Extrae entidades mencionadas: teléfonos, cuentas o tarjetas, montos, nombres, organizaciones y lugares. Si no hay, devuelve una lista vacía.
Responde en español.`;

export interface AnalysisResult {
  source: "ia" | "reglas";
  riskScore: number | null; // null = que lo calcule el llamador con las reglas
  summary: string | null;
  recommendation: string | null;
  signals: DetectedSignal[];
  entities: DetectedEntity[];
  error?: string;
}

function claudeConfigured() {
  if (process.env.ANALYSIS_MODE === "reglas") return false;
  // "claude" fuerza el uso de Claude aunque las credenciales vengan de un perfil de `ant auth login`.
  if (process.env.ANALYSIS_MODE === "claude") return true;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic();
  return client;
}

function mergeEntities(a: DetectedEntity[], b: DetectedEntity[]) {
  const out = [...a];
  for (const e of b) {
    if (!out.some((x) => x.kind === e.kind && x.normalized === e.normalized)) out.push(e);
  }
  return out;
}

function normalizeEntity(kind: DetectedEntity["kind"], value: string): string {
  if (kind === "telefono") return value.replace(/\D/g, "").slice(-10);
  if (kind === "cuenta" || kind === "monto") return value.replace(/\D/g, "");
  return normalizeText(value);
}

export async function analyzeSegment(previous: string[], text: string): Promise<AnalysisResult> {
  const ruleEntities = extractEntities(text);
  const rules = (): AnalysisResult => ({
    source: "reglas",
    riskScore: null,
    summary: null,
    recommendation: null,
    signals: detectSignals(text),
    entities: ruleEntities,
  });

  if (!claudeConfigured()) return rules();

  const context = previous.length
    ? previous.map((t, i) => `[${i + 1}] ${t}`).join("\n")
    : "(sin fragmentos previos)";

  try {
    const response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(AnalysisSchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `CONTEXTO PREVIO:\n${context}\n\nFRAGMENTO NUEVO:\n${text}`,
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return { ...rules(), error: `Claude no devolvió un análisis (${response.stop_reason}).` };
    }

    const out = response.parsed_output;
    const lowered = normalizeText(text);
    const signals: DetectedSignal[] = out.signals
      .filter((s) => (SIGNAL_TYPES as readonly string[]).includes(s.type))
      .map((s) => ({
        type: s.type as SignalType,
        evidence: s.evidence,
        explanation: s.explanation,
        // Si la cita no aparece en el fragmento, se baja la confianza.
        confidence: Math.max(0, Math.min(1, s.confidence)) * (lowered.includes(normalizeText(s.evidence)) ? 1 : 0.6),
      }));
    const aiEntities = out.entities.map((e) => ({
      kind: e.kind,
      value: e.value,
      normalized: normalizeEntity(e.kind, e.value),
    }));

    return {
      source: "ia",
      riskScore: Math.round(Math.max(0, Math.min(100, out.risk_score))),
      summary: out.summary,
      recommendation: out.recommendation,
      signals,
      entities: mergeEntities(ruleEntities, aiEntities.filter((e) => e.normalized)),
    };
  } catch (err) {
    const message =
      err instanceof Anthropic.AuthenticationError
        ? "Credenciales de Claude inválidas"
        : err instanceof Anthropic.RateLimitError
          ? "Límite de uso de Claude alcanzado"
          : err instanceof Anthropic.APIError
            ? `Error de la API de Claude (${err.status})`
            : "No se pudo contactar a Claude";
    console.error("[analysis]", message, err);
    return { ...rules(), error: `${message}; se usó el análisis por reglas.` };
  }
}

export function rulesRiskScore(types: SignalType[]) {
  return scoreFromSignalTypes(types);
}

export function analysisEngine() {
  return claudeConfigured() ? `Claude (${MODEL})` : "Reglas locales";
}
