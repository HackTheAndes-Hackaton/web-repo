"use client";

import { useActionState, useState } from "react";
import { Pencil, UserRoundPlus, UserRoundSearch } from "lucide-react";
import {
  assignToSuspectAction,
  createSuspectAction,
  updateSuspectAction,
  type SuspectFormState,
} from "@/app/actions";
import { buttonCls } from "@/components/ui";

const field =
  "w-full rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/15";

function Feedback({ state }: { state: SuspectFormState }) {
  if (state.error) return <p role="alert" className="text-xs text-critical-ink">{state.error}</p>;
  if (state.success) return <p role="status" className="text-xs text-good-ink">{state.success}</p>;
  return null;
}

function CaseInputs({ ids }: { ids: string[] }) {
  return ids.map((id) => <input key={id} type="hidden" name="incidentId" value={id} />);
}

/** Registrar un grupo como obra del mismo presunto estafador, nuevo o ya existente. */
export function NameGroupForm({
  incidentIds,
  existing,
}: {
  incidentIds: string[];
  existing: { id: string; alias: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"nuevo" | "existente">("nuevo");
  const [created, create, creating] = useActionState<SuspectFormState, FormData>(createSuspectAction, {});
  const [assigned, assign, assigning] = useActionState<SuspectFormState, FormData>(assignToSuspectAction, {});

  if (!open) {
    return (
      <button type="button" className={buttonCls.secondary} onClick={() => setOpen(true)}>
        <UserRoundSearch size={15} aria-hidden />
        Registrar como posible mismo estafador
      </button>
    );
  }
  return (
    <div className="w-full rounded-2xl bg-surface-2 p-4 sm:p-5">
      <div className="flex flex-wrap gap-2 text-sm" role="tablist" aria-label="Tipo de registro">
        {(["nuevo", "existente"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            disabled={m === "existente" && !existing.length}
            onClick={() => setMode(m)}
            className={`rounded-full px-4 py-1.5 font-semibold disabled:opacity-40 ${mode === m ? "bg-accent text-white" : "bg-surface text-fg-2"}`}
          >
            {m === "nuevo" ? "Nuevo registro" : "Agregar a uno existente"}
          </button>
        ))}
      </div>

      {mode === "nuevo" ? (
        <form action={create} className="mt-4 space-y-3">
          <CaseInputs ids={incidentIds} />
          <label className="block text-sm font-semibold">
            Alias
            <input name="alias" required maxLength={80} placeholder="p. ej. Falso abogado Ramírez" className={`${field} mt-1.5`} />
          </label>
          <label className="block text-sm font-semibold">
            Notas <span className="font-normal text-muted">(opcional)</span>
            <textarea name="notes" maxLength={2000} rows={3} placeholder="Qué tienen en común, qué falta verificar…" className={`${field} mt-1.5 resize-y`} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button className={buttonCls.primary} disabled={creating}>
              <UserRoundPlus size={15} aria-hidden />
              {creating ? "Guardando…" : `Registrar ${incidentIds.length} casos`}
            </button>
            <button type="button" className={buttonCls.ghost} onClick={() => setOpen(false)}>Cancelar</button>
            <Feedback state={created} />
          </div>
        </form>
      ) : (
        <form action={assign} className="mt-4 space-y-3">
          <CaseInputs ids={incidentIds} />
          <label className="block text-sm font-semibold">
            Registro
            <select name="suspectId" required className={`${field} mt-1.5`}>
              {existing.map((s) => <option key={s.id} value={s.id}>{s.alias}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button className={buttonCls.primary} disabled={assigning}>
              {assigning ? "Guardando…" : `Agregar ${incidentIds.length} casos`}
            </button>
            <button type="button" className={buttonCls.ghost} onClick={() => setOpen(false)}>Cancelar</button>
            <Feedback state={assigned} />
          </div>
        </form>
      )}
      <p className="mt-3 text-xs text-muted">
        El alias sirve para llevar registro. No identifica a una persona ni prueba que todos los casos tengan el mismo autor.
      </p>
    </div>
  );
}

/** Agrega al registro los casos del grupo que todavía no están asociados. */
export function AddMissingForm({ suspectId, alias, incidentIds }: { suspectId: string; alias: string; incidentIds: string[] }) {
  const [state, action, pending] = useActionState<SuspectFormState, FormData>(assignToSuspectAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="suspectId" value={suspectId} />
      <CaseInputs ids={incidentIds} />
      <button className={buttonCls.secondary} disabled={pending}>
        <UserRoundPlus size={15} aria-hidden />
        {pending ? "Guardando…" : `Agregar ${incidentIds.length} ${incidentIds.length === 1 ? "caso nuevo" : "casos nuevos"} a «${alias}»`}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function EditSuspectForm({ suspect }: { suspect: { id: string; alias: string; notes: string; status: string } }) {
  const [state, action, pending] = useActionState<SuspectFormState, FormData>(updateSuspectAction, {});
  return (
    <details className="group mt-3">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-accent-ink">
        <Pencil size={13} aria-hidden />
        Editar
      </summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="suspectId" value={suspect.id} />
        <label className="block text-sm font-semibold">
          Alias
          <input name="alias" required maxLength={80} defaultValue={suspect.alias} className={`${field} mt-1.5`} />
        </label>
        <label className="block text-sm font-semibold">
          Notas
          <textarea name="notes" maxLength={2000} rows={3} defaultValue={suspect.notes} className={`${field} mt-1.5 resize-y`} />
        </label>
        <label className="block text-sm font-semibold">
          Estado
          <select name="status" defaultValue={suspect.status} className={`${field} mt-1.5`}>
            <option value="en_investigacion">En investigación</option>
            <option value="descartado">Descartado (no era el mismo)</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button className={buttonCls.primary} disabled={pending}>{pending ? "Guardando…" : "Guardar cambios"}</button>
          <Feedback state={state} />
        </div>
      </form>
    </details>
  );
}
