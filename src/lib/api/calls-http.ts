import "server-only";
import { getCall, getIncidentTranscript, listCalls, parseCallId, saveCall } from "./calls";
import { ApiError, ok, pagination, readJson, withApi } from "./http";

type CallCtx = { params: Promise<{ callId: string }> };
type IncidentCtx = { params: Promise<{ id: string }> };

function organization(request: Request) {
  const org = request.headers.get("X-Tiskz-Org");
  if (!org || !/^[A-Za-z0-9_.:-]{1,64}$/.test(org)) throw new ApiError(400, "organization_required", "Indica X-Tiskz-Org.");
  return org;
}

/** Conversaciones privadas: ningún intermediario debe guardarlas en caché. */
function noStore<C>(handler: (request: Request, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C) => {
    const response = await handler(request, ctx);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}

export const listCallsHandler = noStore(withApi(async (request) => {
  const result = await listCalls(organization(request), pagination(new URL(request.url)));
  return Response.json(result);
}));

export const getCallHandler = noStore(withApi(async (request, ctx: CallCtx) => {
  const { callId } = await ctx.params;
  return ok(await getCall(organization(request), parseCallId(callId)));
}));

export const putCallHandler = noStore(withApi(async (request, ctx: CallCtx) => {
  const { callId } = await ctx.params;
  const saved = await saveCall(organization(request), parseCallId(callId), await readJson(request));
  return ok(saved, saved.created ? 201 : 200);
}));

export const getIncidentTranscriptHandler = noStore(withApi(async (request, ctx: IncidentCtx) => {
  const { id } = await ctx.params;
  return ok(await getIncidentTranscript(organization(request), id));
}));
