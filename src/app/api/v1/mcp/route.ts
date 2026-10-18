import { withApi, ApiError, readJson, orgHeader } from "@/lib/api/http";
import { audioMcp } from "@/lib/api/mcp";
import { requireOrg } from "@/lib/api/audio";
import { db } from "@/lib/db";

export const maxDuration = 30;
// Las claves actuales son credenciales de servicio globales, nunca de la APK.
export const POST = withApi(async (request) => {
  const org=orgHeader(request);
  if (!org) throw new ApiError(400,"missing_org","Indica X-PhoneWard-Org.");
  await requireOrg(org,await db());
  const handler=audioMcp(org);
  const response=await handler.fetch(request,{parsedBody:await readJson(request)});
  return new Response(response.body,{status:response.status,headers:new Headers({...Object.fromEntries(response.headers),"Cache-Control":"no-store"})});
});
