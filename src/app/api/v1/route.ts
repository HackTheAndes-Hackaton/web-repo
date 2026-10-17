import { RESOURCES } from "@/lib/api/resources";

/** Índice de la API (no requiere API key). */
export async function GET(request: Request) {
  const base = `${new URL(request.url).origin}/api/v1`;
  return Response.json({
    name: "Centinela API",
    version: "1.0.0",
    auth: "Authorization: Bearer <clave> o X-API-Key: <clave>. Las claves se crean en el panel → Integraciones.",
    openapi: `${base}/openapi.json`,
    resources: RESOURCES.map((r) => ({
      name: r.name,
      title: r.title,
      url: `${base}/${r.name}`,
      nested: r.childOfIncident ? `${base}/incidents/{id}/${r.name}` : undefined,
    })),
  });
}
