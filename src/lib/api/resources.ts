import "server-only";
import { z } from "zod";
import { newId, nowIso, toVector, type Db } from "../db";
import { normalizeEntity } from "../heuristics";
import { ANALYST_STATUSES, LINK_STATUSES, NOTE_KINDS, RISK_LEVELS, riskLevelFromScore } from "../types";

/**
 * Definición de cada entidad expuesta por la API. Los handlers genéricos de
 * crud.ts y la especificación OpenAPI se construyen a partir de esta lista.
 */

type Row = Record<string, unknown>;

export interface ResourceDef {
  /** Segmento de la URL: /api/v1/<name> */
  name: string;
  table: string;
  title: string;
  description: string;
  idPrefix: string;
  /** Columnas que devuelve la API (los embeddings de voz nunca se devuelven). */
  columns: string[];
  create: z.ZodObject;
  update: z.ZodObject;
  /** Filtros por igualdad aceptados en la query string. */
  filters: string[];
  /** Columna para los filtros since/until. */
  dateColumn: string;
  order: { column: string; dir: "asc" | "desc" };
  /** Tiene incident_id: también se expone en /incidents/{id}/<name>. */
  childOfIncident: boolean;
  /** Completa campos derivados antes de insertar. */
  prepare?: (rows: Row[], sql: Db) => Promise<Row[]>;
  /** Ajusta los cambios antes de actualizar. */
  preparePatch?: (patch: Row) => Row;
  /** Columnas de un índice único: los duplicados se ignoran en lugar de fallar. */
  ignoreDuplicatesOn?: string[];
  /** Columnas JSONB: se serializan explícitamente al escribir. */
  jsonColumns?: string[];
}

// ---------- Campos reutilizables ----------
const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Solo letras, números y _ . : -");
const ref = id;
const text = (max = 2000) => z.string().trim().min(1).max(max);
const datetime = z.iso.datetime({ offset: true });
const nullable = <T extends z.ZodType>(s: T) => s.nullable().default(null);
const metadata = z.record(z.string(), z.unknown());
const incidentMetadata = metadata.refine((value) => !["network_origin","findings_batch","report_request","report_generation","report_authorization"].some(key=>Object.hasOwn(value,key)), {
  message: "La procedencia y el estado del reporte se registran mediante sus endpoints específicos, no desde el CRUD.",
});
function withDefaults(shape: Record<string, z.ZodType>, values: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, schema.default(key in values ? values[key] : null)]));
}

/** Esquema de actualización: todos los campos opcionales, sin valores por omisión. */
function patchOf(shape: Record<string, z.ZodType>) {
  return z.object(Object.fromEntries(Object.entries(shape).map(([k, s]) => [k, s.optional()]))).strict();
}

const withIdAndTimes = (prefix: string, rows: Row[]): Row[] =>
  rows.map((r) => ({ ...r, id: r.id ?? newId(prefix), created_at: r.created_at ?? nowIso() }));

// ---------- Organizaciones ----------
const orgFields = { name: text(200) };
const organizations: ResourceDef = {
  name: "organizations",
  table: "organizations",
  title: "Organizaciones",
  description: "Organizaciones que reciben casos en el panel.",
  idPrefix: "org",
  columns: ["id", "name", "created_at"],
  create: z.object({ id: id.optional(), ...orgFields }).strict(),
  update: patchOf(orgFields),
  filters: [],
  dateColumn: "created_at",
  order: { column: "name", dir: "asc" },
  childOfIncident: false,
  prepare: async (rows) => withIdAndTimes("org", rows),
};

// ---------- Personas ----------
const userFields = {
  name: text(200),
  role: z.enum(["usuario", "analista"]),
  org_id: ref.nullable(),
  settings: metadata,
};
const users: ResourceDef = {
  name: "users",
  table: "users",
  title: "Personas",
  description: "Personas que tuvieron la conversación (rol «usuario») y analistas del panel.",
  idPrefix: "usr",
  columns: ["id", "name", "role", "org_id", "settings", "created_at"],
  jsonColumns: ["settings"],
  create: z
    .object({ id: id.optional(), name: userFields.name, role: userFields.role.default("usuario"), org_id: nullable(ref), settings: metadata.default({}) })
    .strict(),
  update: patchOf(userFields),
  filters: ["role", "org_id"],
  dateColumn: "created_at",
  order: { column: "created_at", dir: "desc" },
  childOfIncident: false,
  prepare: async (rows) => withIdAndTimes("usr", rows),
};

// ---------- Incidentes ----------
const callData = {
  client_call_id: text(200).nullable(),
  provider_call_id: text(200).nullable(),
  agent_session_id: text(200).nullable(),
  caller_number_raw: z.string().max(100).nullable(),
  caller_e164: z.string().regex(/^\+[1-9]\d{1,14}$/).nullable(),
  caller_name: text(200).nullable(),
  direction: z.enum(["incoming", "outgoing"]).nullable(),
  call_status: z.enum(["ringing", "active", "ended", "rejected", "missed"]).nullable(),
  answered_at: datetime.nullable(),
  talk_duration_s: z.number().min(0).nullable(),
  agent_status: text(40).nullable(),
  ready_to_answer: z.boolean(),
  simulated: z.boolean().nullable(),
  blocked: z.boolean(),
  analysis_status: z.enum(["pending", "running", "completed", "failed"]),
  verdict: z.enum(["none", "safe", "suspicious", "scam"]),
  risk_reasons: z.array(text(500)).max(30),
  scam_type: text(200).nullable(),
  impersonating: text(200).nullable(),
  user_feedback: z.enum(["safe", "scam", "unsure"]).nullable(),
  user_feedback_at: datetime.nullable(),
  consent_snapshot: metadata,
  analysis_meta: incidentMetadata,
  shared_at: datetime.nullable(),
  sharing_revoked_at: datetime.nullable(),
};
const incidentFields = {
  ...callData,
  external_id: z.string().trim().min(1).max(200).nullable(),
  user_id: ref.nullable(),
  org_id: ref.nullable(),
  title: text(300),
  channel: z.string().trim().min(1).max(40),
  status: z.enum(["en_curso", "finalizado"]),
  started_at: datetime,
  ended_at: datetime.nullable(),
  risk_score: z.number().int().min(0).max(100),
  risk_level: z.enum(RISK_LEVELS),
  summary: z.string().max(4000).nullable(),
  recommendation: z.string().max(2000).nullable(),
  analyst_status: z.enum(ANALYST_STATUSES),
};
const incidents: ResourceDef = {
  name: "incidents",
  table: "incidents",
  title: "Incidentes",
  description:
    "Conversaciones analizadas. Solo aparecen en el panel de la organización indicada en org_id (null = no compartido).",
  idPrefix: "inc",
  columns: [
    "id",
    "external_id",
    "user_id",
    "org_id",
    "title",
    "channel",
    "status",
    "started_at",
    "ended_at",
    "risk_score",
    "risk_level",
    "summary",
    "recommendation",
    "analyst_status",
    "created_at",
    "updated_at",
    "suspect_id",
    ...Object.keys(callData),
  ],
  jsonColumns: ["risk_reasons", "consent_snapshot", "analysis_meta"],
  create: z
    .object({
      id: id.optional(),
      external_id: nullable(incidentFields.external_id.unwrap()),
      user_id: nullable(ref),
      org_id: nullable(ref),
      title: incidentFields.title.default("Conversación"),
      channel: incidentFields.channel.default("llamada"),
      status: incidentFields.status.default("en_curso"),
      started_at: datetime.optional(),
      ended_at: nullable(datetime),
      risk_score: incidentFields.risk_score.default(0),
      risk_level: incidentFields.risk_level.optional(),
      summary: nullable(incidentFields.summary.unwrap()),
      recommendation: nullable(incidentFields.recommendation.unwrap()),
      analyst_status: incidentFields.analyst_status.default("nuevo"),
      ...withDefaults(callData, { ready_to_answer: false, simulated: false, blocked: false, analysis_status: "pending", verdict: "none", risk_reasons: [], consent_snapshot: {}, analysis_meta: {} }),
    })
    .strict(),
  // suspect_id asocia el caso a un presunto responsable de su misma organización (la base lo comprueba).
  update: patchOf({ ...incidentFields, suspect_id: ref.nullable() }),
  filters: ["org_id", "user_id", "status", "risk_level", "analyst_status", "channel", "external_id", "client_call_id", "agent_session_id", "simulated", "verdict", "suspect_id"],
  dateColumn: "started_at",
  order: { column: "started_at", dir: "desc" },
  childOfIncident: false,
  prepare: async (rows) =>
    rows.map((r) => {
      const now = nowIso();
      return {
        ...r,
        id: r.id ?? newId("inc"),
        started_at: r.started_at ?? now,
        // Si no mandan el nivel, se deriva del puntaje.
        risk_level: r.risk_level ?? riskLevelFromScore(r.risk_score as number),
        created_at: now,
        updated_at: now,
      };
    }),
  preparePatch: (patch) => ({
    ...patch,
    ...(patch.risk_score !== undefined && patch.risk_level === undefined
      ? { risk_level: riskLevelFromScore(patch.risk_score as number) }
      : {}),
    updated_at: nowIso(),
  }),
};

// ---------- Señales ----------
const signalFields = {
  analysis_meta: metadata,
  type: z.string().trim().min(1).max(64),
  explanation: text(4000),
  confidence: z.number().min(0).max(1),
  source: z.string().trim().min(1).max(40),
};
const signals: ResourceDef = {
  name: "signals",
  table: "signals",
  title: "Señales de riesgo",
  description:
    "Señales inferidas por la IA, con su explicación (sin citas de la conversación: el panel no guarda transcripciones). Tipos conocidos: urgencia, dinero, datos_sensibles, secreto, amenaza, suplantacion, aislamiento (se aceptan otros).",
  idPrefix: "sig",
  columns: ["id", "incident_id", "type", "explanation", "confidence", "source", "analysis_meta", "created_at"],
  jsonColumns: ["analysis_meta"],
  create: z
    .object({
      id: id.optional(),
      incident_id: ref,
      type: signalFields.type,
      explanation: signalFields.explanation,
      confidence: signalFields.confidence.default(0.5),
      source: signalFields.source.default("ia"),
      analysis_meta: metadata.default({}),
      created_at: datetime.optional(),
    })
    .strict(),
  update: patchOf(signalFields),
  filters: ["incident_id", "type", "source"],
  dateColumn: "created_at",
  order: { column: "created_at", dir: "asc" },
  childOfIncident: true,
  // La columna evidence (cita textual) queda en la base sin usarse.
  prepare: async (rows) => withIdAndTimes("sig", rows).map((r) => ({ ...r, evidence: "" })),
};

// ---------- Datos observados ----------
const entityFields = {
  analysis_meta: metadata,
  kind: z.string().trim().min(1).max(40),
  value: text(500),
  normalized: z.string().trim().min(1).max(500),
  provenance: z.string().trim().min(1).max(40),
};
const entities: ResourceDef = {
  name: "entities",
  table: "entities",
  title: "Datos observados",
  description:
    "Datos puntuales para Perú: telefono, cuenta, cci, billetera, monto y otros. normalized se recalcula en el servidor; cuentas requieren analysis_meta.bank para comparar y billeteras analysis_meta.wallet. Un dato repetido en el mismo incidente se ignora. Se conserva el original y su procedencia.",
  idPrefix: "ent",
  columns: ["id", "incident_id", "kind", "value", "normalized", "provenance", "analysis_meta", "created_at"],
  jsonColumns: ["analysis_meta"],
  create: z
    .object({
      id: id.optional(),
      incident_id: ref,
      kind: entityFields.kind,
      value: entityFields.value,
      normalized: entityFields.normalized.optional(),
      provenance: entityFields.provenance.default("mencionado"),
      analysis_meta: metadata.default({}),
      created_at: datetime.optional(),
    })
    .strict(),
  update: patchOf(entityFields),
  filters: ["incident_id", "kind", "normalized", "provenance"],
  dateColumn: "created_at",
  order: { column: "created_at", dir: "asc" },
  childOfIncident: true,
  ignoreDuplicatesOn: ["incident_id", "kind", "normalized"],
  prepare: async (rows) =>
    withIdAndTimes("ent", rows).map((r) => ({
      ...r,
      normalized: normalizeEntity(r.kind as string, r.value as string, r.analysis_meta as Record<string, unknown>) || (r.value as string),
    })),
};

// ---------- Muestras de voz ----------
const voiceFields = {
  duration_s: z.number().min(0).nullable(),
  profile_id: ref.nullable(),
  model_id: text(200).nullable(),
  model_version: text(100).nullable(),
  speaker: z.enum(["caller", "agent", "user", "unknown"]),
  quality_status: z.enum(["pending", "usable", "rejected"]),
  review_status: z.enum(["pendiente", "aprobada", "rechazada"]),
  reference_enabled: z.boolean(),
  source_session_ref: text(200).nullable(),
};
const voiceSamples: ResourceDef = {
  name: "voice-samples",
  table: "voice_samples",
  title: "Muestras de voz",
  description:
    "Embeddings de voz (dato biométrico sensible). Se usan para proponer vínculos por similitud; la API nunca los devuelve.",
  idPrefix: "voz",
  columns: ["id", "incident_id", ...Object.keys(voiceFields), "embedding_dims", "created_at"],
  create: z
    .object({
      id: id.optional(),
      incident_id: ref,
      embedding: z.array(z.number()).min(16).max(4096).refine((v) => v.some((x) => x !== 0), "El embedding no puede ser un vector cero."),
      ...withDefaults(voiceFields, { speaker: "unknown", quality_status: "pending", review_status: "pendiente", reference_enabled: false }),
      created_at: datetime.optional(),
    })
    .strict(),
  update: patchOf(voiceFields),
  filters: ["incident_id", "profile_id", "model_id", "review_status", "reference_enabled"],
  dateColumn: "created_at",
  order: { column: "created_at", dir: "asc" },
  childOfIncident: true,
  prepare: async (rows) =>
    withIdAndTimes("voz", rows).map((r) => ({ ...r, embedding: toVector(r.embedding as number[]) })),
};

const voiceProfiles: ResourceDef = {
  name: "voice-profiles", table: "voice_profiles", title: "Perfiles vocales",
  description: "Agrupaciones vocales revisables con código estable; no acreditan identidad personal.",
  idPrefix: "vp", columns: ["id", "org_id", "public_code", "status", "simulated", "created_at"],
  create: z.object({ id: id.optional(), org_id: ref, public_code: text(80), status: z.enum(["provisional", "revisado", "descartado"]).default("provisional"), simulated: z.boolean().default(false) }).strict(),
  update: patchOf({ public_code: text(80), status: z.enum(["provisional", "revisado", "descartado"]) }),
  filters: ["org_id", "status", "simulated"], dateColumn: "created_at", order: { column: "created_at", dir: "desc" },
  childOfIncident: false, prepare: async (rows) => withIdAndTimes("vp", rows),
};

// ---------- Presuntos responsables ----------
const suspectFields = {
  alias: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(2000),
  status: z.enum(["en_investigacion", "descartado"]),
};
const suspects: ResourceDef = {
  name: "suspects", table: "suspects", title: "Presuntos responsables",
  description:
    "Alias que un analista da a casos que cree obra del mismo estafador. Sirve para llevar registro: no identifica a una persona. Los casos se asocian con PATCH /incidents/{id} { suspect_id }.",
  idPrefix: "sus",
  columns: ["id", "org_id", "alias", "notes", "status", "created_by", "created_by_id", "created_at", "updated_at"],
  create: z.object({
    id: id.optional(), org_id: ref, alias: suspectFields.alias, notes: suspectFields.notes.default(""),
    status: suspectFields.status.default("en_investigacion"), created_by: text(200).nullable().default(null),
  }).strict(),
  update: patchOf(suspectFields),
  filters: ["org_id", "status"], dateColumn: "created_at", order: { column: "created_at", dir: "desc" },
  childOfIncident: false,
  prepare: async (rows) => withIdAndTimes("sus", rows).map((r) => ({ ...r, updated_at: r.created_at })),
  preparePatch: (patch) => ({ ...patch, updated_at: nowIso() }),
};

// ---------- Bitácora ----------
const actionData = {
  actor_id: ref.nullable(), actor_kind: z.enum(["user", "analyst", "service", "system"]),
  result: z.enum(["requested", "applied", "failed"]), request_id: text(200).nullable(),
  link_id: ref.nullable(), payload: metadata,
};
const actionFields = { kind: z.string().trim().min(1).max(60), detail: text(2000), ...actionData };
const actions: ResourceDef = {
  name: "actions",
  table: "actions",
  title: "Acciones y permisos",
  description: "Bitácora del incidente: captura iniciada, alerta mostrada, permiso otorgado, etc.",
  idPrefix: "act",
  columns: ["id", "incident_id", "kind", "detail", ...Object.keys(actionData), "created_at"],
  jsonColumns: ["payload"],
  create: z.object({ id: id.optional(), incident_id: ref, kind: actionFields.kind, detail: actionFields.detail, ...withDefaults(actionData, { actor_kind: "system", result: "applied", payload: {} }), created_at: datetime.optional() }).strict(),
  update: patchOf(actionFields),
  filters: ["incident_id", "kind"],
  dateColumn: "created_at",
  order: { column: "created_at", dir: "asc" },
  childOfIncident: true,
  prepare: async (rows) => withIdAndTimes("act", rows),
};

// ---------- Notas ----------
const noteFields = {
  author_id: ref.nullable(),
  author_name: text(200),
  author_role: z.string().trim().min(1).max(40),
  kind: z.enum(NOTE_KINDS),
  text: text(4000),
};
const notes: ResourceDef = {
  name: "notes",
  table: "notes",
  title: "Notas",
  description: "Correcciones, observaciones y conclusiones revisadas del incidente.",
  idPrefix: "not",
  columns: ["id", "incident_id", "author_id", "author_name", "author_role", "kind", "text", "created_at"],
  create: z
    .object({
      id: id.optional(),
      incident_id: ref,
      author_id: nullable(ref),
      author_name: noteFields.author_name.default("Servicio externo"),
      author_role: noteFields.author_role.default("sistema"),
      kind: noteFields.kind.default("observacion"),
      text: noteFields.text,
      created_at: datetime.optional(),
    })
    .strict(),
  update: patchOf(noteFields),
  filters: ["incident_id", "kind", "author_role"],
  dateColumn: "created_at",
  order: { column: "created_at", dir: "asc" },
  childOfIncident: true,
  prepare: async (rows) => withIdAndTimes("not", rows),
};

// ---------- Vínculos ----------
const reason = z.object({ kind: z.string().min(1).max(40), detail: text(500) }).strict();
const linkFields = {
  reviewed_by_id: ref.nullable(),
  evidence_snapshot: metadata,
  score: z.number().min(0).max(1),
  voice_sim: z.number().min(-1).max(1).nullable(),
  content_sim: z.number().min(0).max(1),
  reasons: z.array(reason).max(20),
  status: z.enum(LINK_STATUSES),
  reviewed_by: z.string().trim().max(200).nullable(),
  note: z.string().max(2000).nullable(),
};
const links: ResourceDef = {
  name: "links",
  table: "links",
  title: "Vínculos",
  description:
    "Posibles relaciones entre dos incidentes. El panel también los calcula solo (voz, datos repetidos y patrón de señales). Filtra por incident_id para ver los de un caso.",
  idPrefix: "lnk",
  columns: [
    "id",
    "incident_a",
    "incident_b",
    "score",
    "voice_sim",
    "content_sim",
    "reasons",
    "status",
    "reviewed_by",
    "reviewed_at",
    "note",
    "created_at",
    "reviewed_by_id", "evidence_snapshot", "evidence_version", "reviewed_evidence_version", "reviewed_evidence",
  ],
  jsonColumns: ["reasons", "evidence_snapshot"],
  create: z
    .object({
      id: id.optional(),
      incident_a: ref,
      incident_b: ref,
      score: linkFields.score,
      voice_sim: nullable(linkFields.voice_sim.unwrap()),
      content_sim: linkFields.content_sim.default(0),
      reasons: linkFields.reasons.default([]),
      status: linkFields.status.default("pendiente"),
      reviewed_by: nullable(linkFields.reviewed_by.unwrap()),
      reviewed_by_id: nullable(ref),
      evidence_snapshot: metadata.default({}),
      note: nullable(linkFields.note.unwrap()),
    })
    .strict()
    .refine((l) => l.incident_a !== l.incident_b, "Un vínculo une dos incidentes distintos."),
  update: patchOf(linkFields),
  filters: ["status"],
  dateColumn: "created_at",
  order: { column: "score", dir: "desc" },
  childOfIncident: false,
  prepare: async (rows) =>
    withIdAndTimes("lnk", rows).map((r) => {
      const [a, b] = [r.incident_a as string, r.incident_b as string].sort();
      return {
        ...r,
        incident_a: a,
        incident_b: b,
        reviewed_at: r.status !== "pendiente" ? nowIso() : null,
      };
    }),
  preparePatch: (patch) =>
    patch.status === undefined
      ? patch
      : { ...patch, reviewed_at: patch.status === "pendiente" ? null : nowIso() },
};

export const RESOURCES: ResourceDef[] = [
  organizations,
  users,
  incidents,
  signals,
  entities,
  voiceSamples,
  voiceProfiles,
  suspects,
  actions,
  notes,
  links,
];

export function getResource(name: string) {
  return RESOURCES.find((r) => r.name === name);
}
