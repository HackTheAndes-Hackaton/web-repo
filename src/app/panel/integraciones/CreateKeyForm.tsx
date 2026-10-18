"use client";

import { useActionState, useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { createApiKeyAction, type CreatedKey } from "@/app/actions";
import { buttonCls } from "@/components/ui";

export function CreateKeyForm() {
  const [state, formAction, pending] = useActionState<CreatedKey, FormData>(createApiKeyAction, {});
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <input
          name="name"
          required
          maxLength={80}
          placeholder="Nombre del servicio (p. ej. Servidor de llamadas)"
          aria-label="Nombre de la clave"
          className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2 text-sm outline-none focus:ring-4 focus:ring-accent/15 focus:border-accent"
        />
        <button className={buttonCls.primary} disabled={pending}>
          <KeyRound size={15} aria-hidden />
          {pending ? "Creando…" : "Crear clave"}
        </button>
      </form>
      {state.error && <p className="text-xs text-critical-ink">{state.error}</p>}
      {state.key && (
        <div role="status" className="rounded-lg border border-warning bg-warning-wash p-3 text-sm">
          <p className="font-medium text-warning-ink">
            Copia la clave de «{state.name}» ahora: no se volverá a mostrar.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="tabular min-w-0 flex-1 overflow-x-auto rounded-md bg-surface px-2 py-1.5 text-xs text-fg">
              {state.key}
            </code>
            <button
              type="button"
              className={buttonCls.secondary}
              onClick={async () => {
                await navigator.clipboard.writeText(state.key!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              {copied ? "Copiada" : "Copiar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
