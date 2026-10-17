import "server-only";
import { z } from "zod";
import { verifyApiKey, type ApiKey } from "../api-keys";

/**
 * Utilidades HTTP del API gateway (/api/v1): autenticación con API key,
 * formato uniforme de respuestas y traducción de errores de Postgres.
 *
 * Respuestas:
 *   éxito  → { data: ... } (listas: { data: [...], pagination: { limit, offset, total } })
 *   error  → { error: { code, message, details? } }
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Recurso") => new ApiError(404, "not_found", `${what} no encontrado.`);

export function ok(data: unknown, status = 200) {
  return Response.json({ data }, { status });
}

export function okList(data: unknown[], pagination: { limit: number; offset: number; total: number }) {
  return Response.json({ data, pagination });
}

function errorResponse(err: ApiError) {
  return Response.json(
    { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
    { status: err.status, headers: err.status === 401 ? { "WWW-Authenticate": 'Bearer realm="centinela"' } : undefined },
  );
}

/** Errores de Postgres más comunes → respuestas legibles. */
function fromPostgres(err: { code?: string; detail?: string; message?: string; constraint_name?: string }) {
  switch (err.code) {
    case "23505":
      return new ApiError(409, "conflict", "Ya existe un registro con ese valor único.", err.detail);
    case "23503":
      return new ApiError(422, "invalid_reference", "Una referencia apunta a un registro que no existe.", err.detail);
    case "23514":
      return new ApiError(422, "constraint_violation", "Un valor no cumple las reglas del campo.", err.constraint_name);
    case "23502":
      return new ApiError(422, "missing_field", "Falta un campo obligatorio.", err.message);
    case "22P02":
    case "22007":
    case "22008":
      return new ApiError(400, "invalid_value", "Un valor tiene un formato inválido.", err.message);
    default:
      return null;
  }
}

export function getPresentedKey(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-api-key")?.trim() ?? null;
}

export interface ApiContext {
  key: ApiKey;
}

/**
 * Envuelve un handler: exige una API key válida y convierte cualquier error en
 * una respuesta JSON con el código HTTP adecuado.
 */
export function withApi<C>(handler: (request: Request, ctx: C, api: ApiContext) => Promise<Response>) {
  return async (request: Request, ctx: C) => {
    try {
      const key = await verifyApiKey(getPresentedKey(request));
      if (!key) {
        throw new ApiError(
          401,
          "unauthorized",
          "Falta una API key válida. Envíala en el encabezado «Authorization: Bearer <clave>» o «X-API-Key».",
        );
      }
      return await handler(request, ctx, { key });
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err);
      if (err instanceof z.ZodError) {
        return errorResponse(
          new ApiError(
            422,
            "validation_error",
            "El cuerpo de la solicitud no es válido.",
            err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          ),
        );
      }
      const pg = fromPostgres(err as { code?: string });
      if (pg) return errorResponse(pg);
      console.error("[api]", err);
      return errorResponse(new ApiError(500, "internal_error", "Error interno del servidor."));
    }
  };
}

const MAX_BODY = 2 * 1024 * 1024;

export async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) throw new ApiError(413, "payload_too_large", "El cuerpo supera 2 MB.");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new ApiError(413, "payload_too_large", "El cuerpo supera 2 MB.");
  if (!text.trim()) throw new ApiError(400, "empty_body", "Se esperaba un cuerpo JSON.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "El cuerpo no es JSON válido.");
  }
}

export function pagination(url: URL) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  return { limit, offset };
}
