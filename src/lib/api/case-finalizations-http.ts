import "server-only";
import { after } from "next/server";
import { finalizeCase } from "./case-finalizations";
import { ApiError, ok, readJson, withApi } from "./http";
import { refreshLinksFor } from "../links";
import { emit } from "../events";

export const postCaseFinalization = withApi(async (request, _ctx, {key}) => {
  const org = request.headers.get("X-Tiskz-Org");
  if (!org || !/^[A-Za-z0-9_.:-]{1,64}$/.test(org)) throw new ApiError(400,"organization_required","Indica X-Tiskz-Org.");
  const result = await finalizeCase(org,await readJson(request),key.id);
  if (result.status === "completed" && !result.duplicate) after(async()=>{
    await refreshLinksFor(result.incident_id);
    emit({type:"incident",orgId:org,incidentId:result.incident_id});emit({type:"links",orgId:org});
  });
  const response = ok(result,result.status === "running" ? 202 : 200);
  response.headers.set("Cache-Control","no-store");
  return response;
});
