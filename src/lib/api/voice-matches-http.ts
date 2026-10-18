import "server-only";
import { after } from "next/server";
import { ApiError, ok, readJson, withApi } from "./http";
import { enrollVoice, searchVoices } from "./voice-matches";
import { refreshLinksFor } from "../links";
import { emit } from "../events";
import { canonicalOrg } from "../orgs";

function organization(request: Request) {
  const org = canonicalOrg(request.headers.get("X-Tiskz-Org"));
  if (!org || !/^[A-Za-z0-9_.:-]{1,64}$/.test(org)) throw new ApiError(400, "organization_required", "Indica X-Tiskz-Org.");
  return org;
}

const noStore = (response: Response) => {
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export const postVoiceSearch = withApi(async (request) => {
  organization(request);
  return noStore(ok(await searchVoices(await readJson(request))));
});

export const postVoiceEnroll = withApi(async (request) => {
  const org = organization(request);
  const result = await enrollVoice(org, await readJson(request));
  if (result.samples > 0) after(async () => {
    emit({ type: "incident", orgId: org, incidentId: result.incident_id });
    await refreshLinksFor(result.incident_id);
    emit({ type: "links", orgId: org });
  });
  return noStore(ok(result, result.samples > 0 ? 201 : 200));
});
