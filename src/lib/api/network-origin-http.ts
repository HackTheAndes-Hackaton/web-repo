import "server-only";
import { bindNetworkOrigin, getNetworkOrigin, inspectNetworkOrigin } from "./network-origin";
import { ApiError, ok, readJson, withApi, orgHeader } from "./http";

type Ctx = { params: Promise<{ id: string }> };

function organization(request: Request) {
  const org = orgHeader(request);
  if (!org || !/^[A-Za-z0-9_.:-]{1,64}$/.test(org)) throw new ApiError(400, "organization_required", "Indica X-PhoneWard-Org.");
  return org;
}

function noStore(handler: (request: Request, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx) => {
    const response = await handler(request, ctx);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}

export const getOrigin = noStore(withApi(async (request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await getNetworkOrigin(organization(request), id));
}));

export const putOrigin = noStore(withApi(async (request, ctx: Ctx, { key }) => {
  const { id } = await ctx.params;
  return ok(await bindNetworkOrigin(organization(request), id, await readJson(request), key.id));
}));

export const postOrigin = noStore(withApi(async (request, ctx: Ctx, { key }) => {
  const { id } = await ctx.params;
  return ok(await inspectNetworkOrigin(organization(request), id, key.id));
}));
