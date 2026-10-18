import "server-only";
import { z } from "zod";
import { ApiError } from "./http";
import { vapiCallMetadata } from "../network-origin";

const MAX_RESPONSE = 1024 * 1024;

/** Ruta fija y sin redirecciones: nunca se siguen URLs del llamante o del modelo. */
export async function getVapiCall(id: string, options: { apiKey?: string; fetcher?: typeof fetch } = {}) {
  z.uuid().parse(id);
  const key = options.apiKey ?? process.env.VAPI_PRIVATE_KEY;
  if (!key?.trim()) throw new ApiError(503, "vapi_not_configured", "Configura VAPI_PRIVATE_KEY en el servidor para consultar Vapi.");
  try {
    const response = await (options.fetcher ?? fetch)(`https://api.vapi.ai/call/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(502, response.status === 404 ? "vapi_call_not_found" : "vapi_unavailable",
        response.status === 404 ? "Vapi no encuentra la llamada vinculada en esta cuenta." : "No se pudo consultar Vapi. Revisa la configuración del servidor.");
    }
    if (Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE) {
      await response.body?.cancel();
      throw new ApiError(502, "vapi_invalid_response", "La respuesta de Vapi supera el límite permitido.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError(502, "vapi_invalid_response", "Vapi devolvió una respuesta vacía.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_RESPONSE) {
          await reader.cancel();
          throw new ApiError(502, "vapi_invalid_response", "La respuesta de Vapi supera el límite permitido.");
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const result = vapiCallMetadata.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!result.success || result.data.id !== id) {
      throw new ApiError(502, "vapi_invalid_response", "La respuesta de Vapi no corresponde a la llamada vinculada.");
    }
    // Zod descarta transcripciones, grabaciones, URLs de control, IPs y campos desconocidos.
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // No propagar ni registrar cuerpos del proveedor, credenciales o URLs de control.
    throw new ApiError(502, "vapi_unavailable", "La consulta a Vapi falló o excedió el tiempo de espera.");
  }
}
