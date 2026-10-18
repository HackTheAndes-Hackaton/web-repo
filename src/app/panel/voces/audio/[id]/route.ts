import { getSession, sessionError } from "@/lib/session";
import { loadVoiceAudio } from "@/lib/voices";

/** Reproduce un fragmento de voz en el panel: solo la analista de la organización, sin guardar en caché. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "analista" || !session.orgId) return sessionError("analista");
  const { id } = await ctx.params;
  const audio = await loadVoiceAudio(session.orgId, id);
  if (!audio) return new Response("No encontrado", { status: 404 });
  return new Response(new Uint8Array(audio), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(audio.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
