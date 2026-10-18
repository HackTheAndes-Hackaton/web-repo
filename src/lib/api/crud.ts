import "server-only";
import { after } from "next/server";
import type postgres from "postgres";
import { db, type Db } from "../db";
import { emit } from "../events";
import { refreshLinksFor } from "../links";
import { ApiError, notFound, pagination } from "./http";
import type { ResourceDef } from "./resources";

type Row = Record<string, unknown>;
type Fragment = postgres.PendingQuery<postgres.Row[]>;

const MAX_BATCH = 500;

function and(sql: Db, conds: Fragment[]): Fragment {
  return conds.length ? conds.reduce((acc, c) => sql`${acc} and ${c}`) : sql`true`;
}

/** Condiciones a partir de la query string (?campo=valor, since, until, incident_id). */
function buildWhere(sql: Db, def: ResourceDef, url: URL, fixed: Row = {}) {
  const conds: Fragment[] = [];
  const params = url.searchParams;
  for (const [col, value] of Object.entries(fixed)) conds.push(sql`${sql(col)} = ${value as string}`);
  for (const col of def.filters) {
    const value = params.get(col);
    if (value === null || col in fixed) continue;
    conds.push(value === "null" ? sql`${sql(col)} is null` : sql`${sql(col)} = ${value}`);
  }
  // Vínculos: los de un incidente, esté en cualquiera de los dos extremos.
  if (def.name === "links" && params.get("incident_id")) {
    const incidentId = params.get("incident_id")!;
    conds.push(sql`(incident_a = ${incidentId} or incident_b = ${incidentId})`);
  }
  const since = params.get("since");
  const until = params.get("until");
  if (since) conds.push(sql`${sql(def.dateColumn)} >= ${since}`);
  if (until) conds.push(sql`${sql(def.dateColumn)} < ${until}`);
  return and(sql, conds);
}

export async function listRows(def: ResourceDef, url: URL, fixed: Row = {}) {
  const sql = await db();
  const { limit, offset } = pagination(url);
  const where = buildWhere(sql, def, url, fixed);
  const dir = def.order.dir === "desc" ? sql`desc` : sql`asc`;
  const [rows, [{ total }]] = await Promise.all([
    sql<Row[]>`select ${sql(def.columns)} from ${sql(def.table)} where ${where}
               order by ${sql(def.order.column)} ${dir}, id limit ${limit} offset ${offset}`,
    sql<{ total: number }[]>`select count(*)::int as total from ${sql(def.table)} where ${where}`,
  ]);
  return { rows: [...rows], pagination: { limit, offset, total } };
}

export async function getRow(def: ResourceDef, id: string) {
  const sql = await db();
  const [row] = await sql<Row[]>`select ${sql(def.columns)} from ${sql(def.table)} where id = ${id}`;
  if (!row) throw notFound(def.title);
  return row;
}

/** Crea uno o varios registros. `fixed` fuerza campos (p. ej. incident_id de la URL). */
export async function createRows(def: ResourceDef, body: unknown, fixed: Row = {}) {
  const batch = Array.isArray(body);
  const items = (batch ? body : [body]) as unknown[];
  if (!items.length) throw new ApiError(400, "empty_batch", "El arreglo está vacío.");
  if (items.length > MAX_BATCH) throw new ApiError(413, "batch_too_large", `Máximo ${MAX_BATCH} elementos por solicitud.`);

  const parsed = items.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ApiError(422, "validation_error", `El elemento ${i} debe ser un objeto.`);
    }
    const result = def.create.safeParse({ ...item, ...fixed });
    if (!result.success) {
      throw new ApiError(
        422,
        "validation_error",
        batch ? `El elemento ${i} no es válido.` : "El cuerpo de la solicitud no es válido.",
        result.error.issues.map((iss) => ({ path: [batch ? i : null, ...iss.path].filter((p) => p !== null).join("."), message: iss.message })),
      );
    }
    return result.data as Row;
  });

  const sql = await db();
  const rows = def.prepare ? await def.prepare(parsed, sql) : parsed;
  const storedRows = rows.map((row) => jsonValues(sql, def, row));
  const cols = Object.keys(storedRows[0]);
  const conflict = def.ignoreDuplicatesOn ? sql`on conflict (${sql(def.ignoreDuplicatesOn)}) do nothing` : sql``;
  const created = await sql<Row[]>`
    insert into ${sql(def.table)} ${sql(storedRows as never, cols)} ${conflict}
    returning ${sql(def.columns)}`;

  sideEffects(def, rows);
  if (!batch && !created.length && def.ignoreDuplicatesOn) {
    // Ya existía: se devuelve el registro existente con 200 en lugar de 201.
    const row = rows[0];
    const match = and(sql, def.ignoreDuplicatesOn.map((c) => sql`${sql(c)} = ${row[c] as string}`));
    const [existing] = await sql<Row[]>`select ${sql(def.columns)} from ${sql(def.table)} where ${match}`;
    return { data: existing ?? null, status: 200 };
  }
  return { data: batch ? [...created] : created[0], status: 201 };
}

export async function updateRow(def: ResourceDef, id: string, body: unknown) {
  if (def.name === "actions" && ["link_review", "network_origin_binding", "network_origin_check"].includes(String((await getRow(def, id)).kind))) {
    throw new ApiError(409, "immutable_review", "El registro de revisión o procedencia se conserva. Registra una nueva decisión o consulta.");
  }
  const patch = def.update.parse(body) as Row;
  const values = def.preparePatch ? def.preparePatch(patch) : patch;
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  if (!keys.length) throw new ApiError(400, "empty_patch", "No hay campos para actualizar.");
  const sql = await db();
  const storedValues = jsonValues(sql, def, values);
  if (def.name === "incidents" && values.analysis_meta !== undefined) {
    // Un nuevo análisis no puede borrar la procedencia recogida por el servidor.
    storedValues.analysis_meta = sql`coalesce(analysis_meta, '{}'::jsonb) || ${sql.json(values.analysis_meta as postgres.JSONValue)}`;
  }
  const correlation = def.name === "incidents" && values.client_call_id !== undefined
    ? sql`(analysis_meta #>> '{network_origin,binding,client_call_id}' is null or analysis_meta #>> '{network_origin,binding,client_call_id}'=${values.client_call_id as string | null})`
    : sql`true`;
  const [row] = await sql<Row[]>`
    update ${sql(def.table)} set ${sql(storedValues as never, keys)} where id = ${id} and ${correlation} returning ${sql(def.columns)}`;
  if (!row && def.name === "incidents" && values.client_call_id !== undefined) {
    await getRow(def, id);
    throw new ApiError(409, "binding_conflict", "El identificador Android ya está vinculado a una conferencia y no puede reemplazarse automáticamente.");
  }
  if (!row) throw notFound(def.title);
  sideEffects(def, [row]);
  return row;
}

export async function deleteRow(def: ResourceDef, id: string) {
  const sql = await db();
  const before = await getRow(def, id);
  if (def.name === "actions" && ["link_review", "network_origin_binding", "network_origin_check"].includes(String(before.kind))) {
    throw new ApiError(409, "immutable_review", "Las revisiones y consultas de procedencia se conservan en el historial.");
  }
  await sql`delete from ${sql(def.table)} where id = ${id}`;
  sideEffects(def, [before], true);
  return { id, deleted: true };
}

function jsonValues(sql: Db, def: ResourceDef, row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    def.jsonColumns?.includes(key) && value !== null ? sql.json(value as postgres.JSONValue) : value,
  ]));
}

/** Incidentes afectados por un cambio en este recurso. */
function touchedIncidents(def: ResourceDef, rows: Row[]) {
  if (def.name === "incidents") return rows.map((r) => r.id as string);
  if (def.childOfIncident) return rows.map((r) => r.incident_id as string);
  if (def.name === "links") return rows.flatMap((r) => [r.incident_a as string, r.incident_b as string]);
  return [];
}

/**
 * Después de responder: avisa al panel en vivo y recalcula los vínculos de los
 * incidentes cuyo contenido cambió.
 */
function sideEffects(def: ResourceDef, rows: Row[], deleted = false) {
  const ids = [...new Set(touchedIncidents(def, rows))];
  if (!ids.length) return;
  const recompute = def.name !== "links" && def.name !== "notes" && def.name !== "actions" && !(deleted && def.name === "incidents");
  after(async () => {
    const sql = await db();
    const incidents = await sql<{ id: string; org_id: string | null }[]>`
      select id, org_id from incidents where id in ${sql(ids)}`;
    for (const inc of incidents) {
      if (def.childOfIncident) await sql`update incidents set updated_at = now() where id = ${inc.id}`;
      if (recompute && inc.org_id) await refreshLinksFor(inc.id);
      emit({ type: "incident", orgId: inc.org_id, incidentId: inc.id });
      if (inc.org_id) emit({ type: "links", orgId: inc.org_id });
    }
    // Un incidente borrado ya no está en la tabla: avisa con la organización que tenía.
    if (deleted && def.name === "incidents") {
      for (const r of rows) if (r.org_id) emit({ type: "links", orgId: r.org_id as string });
    }
  });
}

/** Recalcula los vínculos de un incidente o de todos los de una organización. */
export async function recomputeLinks(target: { incident_id?: string; org_id?: string }) {
  const sql = await db();
  const ids = target.incident_id
    ? [target.incident_id]
    : (await sql<{ id: string }[]>`select id from incidents where org_id = ${target.org_id!}`).map((r) => r.id);
  for (const id of ids) await refreshLinksFor(id);
  const orgs = await sql<{ org_id: string }[]>`
    select distinct org_id from incidents where id in ${sql(ids.length ? ids : [""])} and org_id is not null`;
  for (const o of orgs) emit({ type: "links", orgId: o.org_id });
  return { incidents: ids.length };
}
