"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { clearNumberReportAction } from "@/app/actions";

/** Pide confirmación: borrar el historial de reportes no se puede deshacer. */
export function ClearReportButton({ number, label }: { number: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`¿Eliminar el reporte de ${label}? Se borra su historial de reportes y bloqueos, y la app deja de avisar por este número. Las llamadas se conservan.`)) return;
        start(() => clearNumberReportAction(number));
      }}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-fg-2 hover:bg-critical-wash hover:text-critical-ink disabled:opacity-50"
    >
      <Trash2 size={13} aria-hidden />
      {pending ? "Eliminando…" : "Eliminar reporte"}
    </button>
  );
}
