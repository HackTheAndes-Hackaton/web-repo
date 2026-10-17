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
};
const users: ResourceDef = {
  name: "users",
  table: "users",
  title: "Personas",
  description: "Personas que tuvieron la conversación (rol «usuario») y analistas del panel.",
  idPrefix: "usr",
  columns: ["id", "name", "role", "org_id", "created_at"],
  create: z
    .object({ id: id.optional(), name: userFields.name, role: userFields.role.default("usuario"), org_id: nullable(ref) })
    .strict(),
  update: patchOf(userFields),
  filters: ["role", "org_id"],
  dateColumn: "created_at",
  order: { column: "created_at", dir: "desc" },
  childOfIncident: false,
  prepare: async (rows) => withIdAndTimes("usr", rows),
};

// ---------- Incidentes ----------
const incidentFields = {
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
  ],
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
    })
    .strict(),
  update: patchOf(incidentFields),
  filters: ["org_id", "user_id", "status", "risk_level", "analyst_status", "channel", "external_id"],
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

// ---------- Fragmentos de transcripción ----------
const segmentFields = {
  idx: z.number().int().min(0),
  t_offset: z.number().min(0),
  speaker: z.string().trim().max(60).nullable(),
  text: text(10000),
};
const segments: ResourceDef = {
  name: "segments",
  table: "segments",
  title: "Transcripción",
  description:
    "Fragmentos de la transcripción, en orden. Si no se envía idx, se asigna el siguiente. t_offset = segundos desde el inicio.",
  idPrefix: "seg",
  columns: ["id", "incident_id", "idx", "t_offset", "speaker", "text", "created_at"],
  create: z
    .object({
      id: id.optional(),
      incident_id: ref,
      idx: segmentFields.idx.optional(),
      t_offset: segmentFields.t_offset.default(0),
      speaker: nullable(segmentFields.speaker.unwrap()),
      text: segmentFields.text,
      created_at: datetime.optional(),
    })
    .strict(),
  update: patchOf(segmentFields),
  filters: ["incident_id", "speaker"],
  dateColumn: "created_at",
  order: { column: "idx", dir: "asc" },
  childOfIncident: true,
  prepare: async (rows, sql) => {
    // Siguiente idx por incidente, respetando el orden del lote.
    const next = new Map<string, number>();
    for (const incidentId of new Set(rows.filter((r) => r.idx === undefined).map((r) => r.incident_id as string))) {
      const [{ n }] = await sql<{ n: number }[]>`
        select coalesce(max(idx) + 1, 0)::int as n from segments where incident_id = ${incidentId}`;
      next.set(incidentId, n);
    }
    return withIdAndTimes("seg", rows).map((r) => {
      if (r.idx !== undefined) return r;
      const n = next.get(r.incident_id as string)!;
      next.set(r.incident_id as string, n + 1);
      return { ...r, idx: n };
    });
  },
};

// ---------- Señales ----------
const signalFields = {
  segment_id: ref.nullable(),
  type: z.string().trim().min(1).max(64),
  evidence: text(4000),
  explanation: text(4000),
  confidence: z.number().min(0).max(1),
  source: z.string().trim().min(1).max(40),
};
const signals: ResourceDef = {
  name: "signals",
  table: "signals",
  title: "Señales de riesgo",
  description:
    "Señales inferidas por la IA. Tipos conocidos: urgencia, dinero, datos_sensibles, secreto, amenaza, suplantacion, aislamiento (se aceptan otros).",
  idPrefix: "sig",
  columns: ["id", "incident_id", "segment_id", "type", "evidence", "explanation", "confidence", "source", "created_at"],
  create: z
    .object({
      id: id.optional(),
      incident_id: ref,
      segment_id: nullable(ref),
      type: signalFields.type,
      evidence: signalFields.evidence,
      explanation: signalFields.explanation,
      confidence: signalFields.confidence.default(0.5),
      source: signalFields.source.default("ia"),
      created_at: datetime.optional(),
    })
    .strict(),
  update: patchOf(signalFields),
  filters: ["incident_id", "segment_id", "type", "source"],
  dateColumn: "created_at",
  order: { column: "created_at", dir: "asc" },
  childOfIncident: true,
  prepare: async (rows) => withIdAndTimes("sig", rows),
};

// ---------- Datos observados ----------
const entityFields = {
  segment_id: ref.nullable(),
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
    "Teléfonos, cuentas, montos, nombres, organizaciones o lugares. normalized se calcula si no se envía; un dato repetido en el mismo incidente se ignora. provenance: mencionado | mostrado | reportado_usuario.",
  idPrefix: "ent",
  columns: ["id", "incident_id", "segment_id", "kind", "value", "normalized", "provenance", "created_at"],
  create: z
    .object({
      id: id.optional(),
      incident_id: ref,
      segment_id: nullable(ref),
      kind: entityFields.kind,
      value: entityFields.value,
      normalized: entityFields.normalized.optional(),
      provenance: entityFields.provenance.default("mencionado"),
      created_at: datetime.optional(),
    })
    .strict(),
  update: patchOf(entityFields),
  filters: ["incident_id", "segment_id", "kind", "normalized", "provenance"],
  dateColumn: "created_at",
  order: { column: "created_at", dir: "asc" },
  childOfIncident: true,
  ignoreDuplicatesOn: ["incident_id", "kind", "normalized"],
  prepare: async (rows) =>
    withIdAndTimes("ent", rows).map((r) => ({
      ...r,
      normalized: r.normalized ?? (normalizeEntity(r.kind as string, r.value as string) || (r.value as string)),
    })),
};

// ---------- Muestras de voz ----------
const voiceSamples: ResourceDef = {
  name: "voice-samples",
  table: "voice_samples",
  title: "Muestras de voz",
  description:
    "Embeddings de voz (dato biométrico sensible). Se usan para proponer vínculos por similitud; la API nunca los devuelve.",
  idPrefix: "voz",
  columns: ["id", "incident_id", "duration_s", "created_at"],
  create: z
    .object({
      id: id.optional(),
      incident_id: ref,
      embedding: z.array(z.number()).min(16).max(4096),
      duration_s: nullable(z.number().min(0)),
      created_at: datetime.optional(),
    })
    .strict(),
  update: patchOf({ duration_s: z.number().min(0).nullable() }),
  filters: ["incident_id"],
  dateColumn: "created_at",
  order: { column: "created_at", dir: "asc" },
  childOfIncident: true,
  prepare: async (rows) =>
    withIdAndTimes("voz", rows).map((r) => ({ ...r, embedding: toVector(r.embedding as number[]) })),
};

// ---------- Bitácora ----------
const actionFields = { kind: z.string().trim().min(1).max(60), detail: text(2000) };
const actions: ResourceDef = {
  name: "actions",
  table: "actions",
  title: "Acciones y permisos",
  description: "Bitácora del incidente: captura iniciada, alerta mostrada, permiso otorgado, etc.",
  idPrefix: "act",
  columns: ["id", "incident_id", "kind", "detail", "created_at"],
  create: z.object({ id: id.optional(), incident_id: ref, ...actionFields, created_at: datetime.optional() }).strict(),
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
    "Posibles relaciones entre dos incidentes. El panel también los calcula solo (voz, datos repetidos y guion). Filtra por incident_id para ver los de un caso.",
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
  ],
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
  segments,
  signals,
  entities,
  voiceSamples,
  actions,
  notes,
  links,
];

export function getResource(name: string) {
  return RESOURCES.find((r) => r.name === name);
}
