import "server-only";
import { z } from "zod";
import { db } from "../db";
import { requireOrg, saveAudio, listAudio, loadAudio } from "./audio";
import { ApiError, ok, readJson, withApi } from "./http";
import { canonicalOrg } from "../orgs";

async function organization(request: Request) {
  const org = canonicalOrg(request.headers.get("X-Tiskz-Org"));
  if (!org) throw new ApiError(400, "missing_org", "Indica X-Tiskz-Org.");
  await requireOrg(org, await db());
  return org;
}

// Credenciales de servicio: estas rutas se llaman desde el backend, nunca con
// una clave global embebida en la APK. Comparten permisos y cuotas con MCP.
export const postAudio = withApi(async (request) => {
  const org = await organization(request);
  let saved;
  try { saved = await saveAudio(org, await readJson(request)); }
  catch (err) {
    if (err instanceof ApiError || err instanceof z.ZodError) throw err;
    // No registrar errores SQL que puedan incluir los bytes de audio en params.
    throw new ApiError(500, "audio_storage_failed", "No se pudo guardar el fragmento.");
  }
  const response = ok(saved, 201);
  response.headers.set("Cache-Control", "no-store");
  return response;
});

export const getAudioList = withApi(async (request) => {
  const org = await organization(request);
  const session = new URL(request.url).searchParams.get("session_id") ?? "";
  const response = ok(await listAudio(org, session));
  response.headers.set("Cache-Control", "no-store");
  return response;
});

export const getAudio = withApi(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const org = await organization(request);
  const session = new URL(request.url).searchParams.get("session_id") ?? "";
  const audio = await loadAudio(org, session, (await ctx.params).id);
  return new Response(new Uint8Array(audio), { headers: {
    "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
});
