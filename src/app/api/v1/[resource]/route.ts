import { createRows, listRows } from "@/lib/api/crud";
import { notFound, ok, okList, readJson, withApi } from "@/lib/api/http";
import { getResource } from "@/lib/api/resources";

type Ctx = RouteContext<"/api/v1/[resource]">;

async function resource(ctx: Ctx) {
  const def = getResource((await ctx.params).resource);
  if (!def) throw notFound("Recurso");
  return def;
}

/** GET /api/v1/{recurso}?campo=valor&since=&until=&limit=&offset= */
export const GET = withApi(async (request, ctx: Ctx) => {
  const def = await resource(ctx);
  const { rows, pagination } = await listRows(def, new URL(request.url));
  return okList(rows, pagination);
});

/** POST /api/v1/{recurso} — un objeto o un arreglo de hasta 500. */
export const POST = withApi(async (request, ctx: Ctx) => {
  const def = await resource(ctx);
  const { data, status } = await createRows(def, await readJson(request));
  return ok(data, status);
});
