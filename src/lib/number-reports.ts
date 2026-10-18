import "server-only";
import { db, newId, nowIso } from "./db";
import { normalizePhonePe } from "./peru";
import type { Session } from "./types";

export class NumberReportError extends Error {}

/** Clave del número (la misma que usa la reputación) y las formas en que puede llegar escrito. */
function numberForms(value: string) {
  const pe = normalizePhonePe(value);
  if (pe) {
    const local = pe.slice(3);
    return { key: pe, digits: [local, `51${local}`] };
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) throw new NumberReportError("El número no es válido.");
  return { key: `+${digits}`, digits: [digits] };
}

/**
 * "Eliminar reporte": borra el historial de reportes del número. Los reportes y
 * bloqueos anteriores dejan de contar en la reputación (la app deja de avisar) y
 * sus llamadas dejan de figurar como bloqueadas. Las llamadas se conservan.
 */
export async function clearNumberReport(session: Session, number: string) {
  const orgId = session.orgId!;
  const { key, digits } = numberForms(number);
  const sql = await db();
  return sql.begin(async (tx) => {
    await tx`insert into number_report_clears (number_key, cleared_at, cleared_by, cleared_by_id)
      values (${key}, ${nowIso()}, ${session.name}, ${session.userId})
      on conflict (number_key) do update set cleared_at = excluded.cleared_at,
        cleared_by = excluded.cleared_by, cleared_by_id = excluded.cleared_by_id`;
    const unblocked = await tx<{ id: string }[]>`
      update incidents set blocked = false, updated_at = ${nowIso()}
      where org_id = ${orgId} and blocked
        and regexp_replace(coalesce(caller_e164, caller_number_raw, ''), '\\D', '', 'g') in ${tx(digits)}
      returning id`;
    if (unblocked.length) {
      await tx`insert into actions ${tx(unblocked.map(({ id }) => ({
        id: newId("act"), incident_id: id, kind: "report_cleared",
        detail: `Reporte del número eliminado por ${session.name}.`,
        actor_id: session.userId, actor_kind: "analyst", result: "applied",
        payload: tx.json({ number_key: key } as never), created_at: nowIso(),
      })))}`;
    }
    return { number_key: key, unblocked: unblocked.length };
  });
}
