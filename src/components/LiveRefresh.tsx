"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Escucha /api/events y refresca los componentes de servidor cuando llega un
 * cambio. `pollMs` agrega un refresco periódico (p. ej. para actualizar la
 * duración de una captura en curso, que no genera ningún evento).
 */
export function LiveRefresh({ pollMs }: { pollMs?: number }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
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
    const poll = pollMs ? setInterval(() => router.refresh(), pollMs) : null;
    return () => {
      es.close();
      if (poll) clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router, pollMs]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title="Actualización en vivo">
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-good" : "bg-line-strong"}`} aria-hidden />
      {connected ? "En vivo" : "Reconectando…"}
    </span>
  );
}
