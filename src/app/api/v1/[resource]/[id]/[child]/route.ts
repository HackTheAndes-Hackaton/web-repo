import { createRows, getRow, listRows } from "@/lib/api/crud";
import { notFound, ok, okList, readJson, withApi } from "@/lib/api/http";
import { getResource } from "@/lib/api/resources";

type Ctx = RouteContext<"/api/v1/[resource]/[id]/[child]">;

/** Solo los incidentes tienen subcolecciones: /api/v1/incidents/{id}/{segments|signals|...}. */
async function target(ctx: Ctx) {
  const { resource, id, child } = await ctx.params;
  const parent = getResource(resource);
  const def = getResource(child);
  if (parent?.name !== "incidents" || !def?.childOfIncident) throw notFound("Recurso");
  await getRow(parent, id); // 404 si el incidente no existe
  return { def, fixed: { incident_id: id } };
}

export const GET = withApi(async (request, ctx: Ctx) => {
  const { def, fixed } = await target(ctx);
  const { rows, pagination } = await listRows(def, new URL(request.url), fixed);
  return okList(rows, pagination);
});

/** Crea uno o varios registros del incidente; incident_id se toma de la URL. */
export const POST = withApi(async (request, ctx: Ctx) => {
  const { def, fixed } = await target(ctx);
  const { data, status } = await createRows(def, await readJson(request), fixed);
  return ok(data, status);
});
