import "server-only";
import { EventEmitter } from "node:events";

/**
 * Bus de eventos en memoria para empujar cambios al panel por SSE cuando la API
 * recibe datos. Alcanza para un solo proceso de Next.js (`next dev` / `next start`).
 * En un despliegue serverless habría que cambiarlo por Supabase Realtime.
 */
export type AppEvent =
  | { type: "incident"; orgId: string | null; incidentId: string }
  | { type: "links"; orgId: string };

const g = globalThis as unknown as { __bus?: EventEmitter };
const bus = (g.__bus ??= new EventEmitter().setMaxListeners(200));

export function emit(event: AppEvent) {
  bus.emit("event", event);
}

export function subscribe(fn: (event: AppEvent) => void) {
  bus.on("event", fn);
  return () => {
    bus.off("event", fn);
  };
}
