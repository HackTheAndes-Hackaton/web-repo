import { db } from "@/lib/db";
import { deleteRow, getRow, recomputeLinks, updateRow } from "@/lib/api/crud";
import { ApiError, notFound, ok, readJson, withApi } from "@/lib/api/http";
import { getResource, RESOURCES } from "@/lib/api/resources";

type Ctx = RouteContext<"/api/v1/[resource]/[id]">;

async function target(ctx: Ctx) {
  const { resource, id } = await ctx.params;
  const def = getResource(resource);
  if (!def) throw notFound("Recurso");
  return { def, id };
}

const INCLUDABLE = RESOURCES.filter((r) => r.childOfIncident).map((r) => r.name);

/**
 * GET /api/v1/{recurso}/{id}
 * En incidentes acepta ?include=segments,signals,entities,actions,notes,voice-samples,links
 */
export const GET = withApi(async (request, ctx: Ctx) => {
  const { def, id } = await target(ctx);
  const row = await getRow(def, id);
  if (def.name !== "incidents") return ok(row);

  const include = (new URL(request.url).searchParams.get("include") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = include.filter((i) => i !== "links" && !INCLUDABLE.includes(i));
  if (unknown.length) {
    throw new ApiError(400, "invalid_include", `No se puede incluir: ${unknown.join(", ")}.`, { allowed: [...INCLUDABLE, "links"] });
  }
  const sql = await db();
  const extra: Record<string, unknown> = {};
  for (const name of include) {
    const child = getResource(name)!;
    extra[name] =
      name === "links"
        ? [...(await sql`select ${sql(child.columns)} from links where incident_a = ${id} or incident_b = ${id} order by score desc`)]
        : [
            ...(await sql`select ${sql(child.columns)} from ${sql(child.table)} where incident_id = ${id}
                          order by ${sql(child.order.column)}, id`),
          ];
  }
  return ok({ ...row, ...extra });
});

/** PATCH /api/v1/{recurso}/{id} — solo los campos enviados. */
export const PATCH = withApi(async (request, ctx: Ctx) => {
  const { def, id } = await target(ctx);
  return ok(await updateRow(def, id, await readJson(request)));
});

/** DELETE /api/v1/{recurso}/{id} */
export const DELETE = withApi(async (_request, ctx: Ctx) => {
  const { def, id } = await target(ctx);
  return ok(await deleteRow(def, id));
});

/**
 * POST /api/v1/links/recompute — recalcula los vínculos propuestos.
 * Cuerpo: { "incident_id": "..." } o { "org_id": "..." }.
 */
export const POST = withApi(async (request, ctx: Ctx) => {
  const { def, id } = await target(ctx);
  if (def.name !== "links" || id !== "recompute") {
    throw new ApiError(405, "method_not_allowed", "Usa PATCH para actualizar o POST sobre la colección para crear.");
  }
  const body = (await readJson(request)) as { incident_id?: unknown; org_id?: unknown };
  const incident_id = typeof body.incident_id === "string" ? body.incident_id : undefined;
  const org_id = typeof body.org_id === "string" ? body.org_id : undefined;
  if (!incident_id && !org_id) throw new ApiError(422, "validation_error", "Envía incident_id u org_id.");
  return ok(await recomputeLinks({ incident_id, org_id }));
});
