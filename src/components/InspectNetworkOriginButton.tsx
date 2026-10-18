"use client";

import { useActionState } from "react";
import { inspectNetworkOriginAction } from "@/app/actions";

export function InspectNetworkOriginButton({ incidentId }: { incidentId: string }) {
  const [state, action, pending] = useActionState(inspectNetworkOriginAction.bind(null, incidentId), {});
  return (
    <form action={action} className="no-print mt-4">
      <button disabled={pending} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Consultando…" : "Consultar metadatos de Vapi"}
      </button>
      {state.error && <p role="alert" className="mt-2 text-sm text-critical-ink">{state.error}</p>}
      {state.success && <p role="status" className="mt-2 text-sm text-muted">{state.success}</p>}
    </form>
  );
}
