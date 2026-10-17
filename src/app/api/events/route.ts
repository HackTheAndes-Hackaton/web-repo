import { subscribe, type AppEvent } from "@/lib/events";
import { getSession, sessionError } from "@/lib/session";

/** Eventos en vivo por SSE. Cada navegador recibe solo lo que le corresponde. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return sessionError();

  const relevant = (e: AppEvent) => {
    if (session.role === "usuario") return "userId" in e && e.userId === session.userId;
    if (e.type === "links") return e.orgId === session.orgId;
    return e.type === "incident" && e.orgId !== null && e.orgId === session.orgId;
  };

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          cleanup();
        }
      };
      send(`retry: 2000\n\n`);
      const unsubscribe = subscribe((e) => {
        if (relevant(e)) send(`data: ${JSON.stringify(e)}\n\n`);
      });
      const ping = setInterval(() => send(`: ping\n\n`), 15000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
