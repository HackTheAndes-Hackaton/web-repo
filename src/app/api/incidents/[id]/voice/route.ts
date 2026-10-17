import { addVoiceSample } from "@/lib/pipeline";
import { refreshLinksFor } from "@/lib/links";
import { emit } from "@/lib/events";
import { getIncident, logAction } from "@/lib/repo";
import { getSession, sessionError } from "@/lib/session";

/**
 * Registra un embedding de voz calculado por un servicio externo.
 * Cuerpo: { "embedding": number[], "duration_s"?: number }.
 * Solo el dueño del incidente puede agregar muestras.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/incidents/[id]/voice">) {
  const { id } = await ctx.params;
  const session = await getSession();
  const inc = await getIncident(id);
  if (!inc) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (session?.userId !== inc.user_id) return sessionError("usuario");

  const body = (await request.json().catch(() => null)) as { embedding?: unknown; duration_s?: unknown } | null;
  const embedding = body?.embedding;
  if (!Array.isArray(embedding) || embedding.length < 16 || !embedding.every((x) => typeof x === "number")) {
    return Response.json({ error: "embedding debe ser un arreglo de números" }, { status: 400 });
  }
  await addVoiceSample(id, embedding as number[], typeof body?.duration_s === "number" ? body.duration_s : null);
  await logAction(id, "voz_registrada", "Se registró una muestra de voz (dato biométrico sensible).");
  if (inc.shared_org_id) {
    await refreshLinksFor(id);
    emit({ type: "links", orgId: inc.shared_org_id });
  }
  return Response.json({ ok: true });
}
