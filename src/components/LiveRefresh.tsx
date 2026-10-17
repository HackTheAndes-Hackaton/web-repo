"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Mantiene el panel al día.
 * - Con un servidor propio (`next dev` / `next start`) escucha /api/events (SSE)
 *   y refresca en cuanto la API recibe datos.
 * - En serverless (Vercel) cada instancia tiene su propio bus de eventos, así que
 *   se consulta cada `pollMs` en lugar de mantener una conexión abierta.
 */
export function LiveRefresh({ mode, pollMs = 15000 }: { mode: "sse" | "poll"; pollMs?: number }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (mode === "poll") {
      const poll = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, pollMs);
      return () => clearInterval(poll);
    }
    const schedule = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        router.refresh();
      }, 250);
    };
    const es = new EventSource("/api/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = schedule;
    return () => {
      es.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router, mode, pollMs]);

  if (mode === "poll") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted" title="El panel se actualiza periódicamente">
        <span className="h-2 w-2 rounded-full bg-good" aria-hidden />
        Cada {Math.round(pollMs / 1000)} s
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title="Actualización en vivo">
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-good" : "bg-line-strong"}`} aria-hidden />
      {connected ? "En vivo" : "Reconectando…"}
    </span>
  );
}
