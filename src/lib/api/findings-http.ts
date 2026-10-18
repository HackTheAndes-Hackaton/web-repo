import "server-only";
import { after } from "next/server";
import { commitFindings } from "./findings";
import { ApiError, ok, readJson, withApi } from "./http";
import { emit } from "../events";
import { refreshLinksFor } from "../links";
import { explainTopPendingLinks } from "./link-explanations";

type Ctx = { params: Promise<{ id: string }> };
export const postFindings = withApi(async (request, ctx: Ctx, { key }) => {
  const org = request.headers.get("X-Tiskz-Org");
  if (!org || !/^[A-Za-z0-9_.:-]{1,64}$/.test(org)) throw new ApiError(400, "organization_required", "Indica X-Tiskz-Org.");
  const { id } = await ctx.params;
  const receipt = await commitFindings(org, id, await readJson(request), key.id);
  if (!receipt.duplicate) after(async () => {
    await refreshLinksFor(id);
    emit({ type: "incident", orgId: org, incidentId: id });
    emit({ type: "links", orgId: org });
    await explainTopPendingLinks(org,id);
    emit({ type: "links", orgId: org });
  });
  const response = ok(receipt);
  response.headers.set("Cache-Control", "no-store");
  return response;
});
