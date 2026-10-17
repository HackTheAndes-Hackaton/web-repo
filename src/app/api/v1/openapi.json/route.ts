import { buildOpenApi } from "@/lib/api/openapi";

/** Especificación OpenAPI pública (no requiere API key). */
export async function GET(request: Request) {
  return Response.json(buildOpenApi(new URL(request.url).origin));
}
