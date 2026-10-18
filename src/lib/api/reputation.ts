import "server-only";
import { db, type Sql } from "../db";
import { normalizePhonePe } from "../peru";
import { ApiError } from "./http";

/**
 * Reputación comunitaria de un número: cuántas llamadas reales lo marcaron como estafa o
 * sospechoso, en cualquier organización, y en cuántos casos se mencionó (por ejemplo, como
 * número de Yape). Solo totales: nunca conversaciones, personas ni organizaciones.
 * Lo consulta la app mientras suena la llamada para avisar antes de contestar.
 *
 * Un número también queda reportado cuando lo bloquearon BLOCK_REPORT_THRESHOLD veces:
 * desde ahí cada bloqueo cuenta como reporte. "Eliminar reporte" en el panel borra el
 * historial: lo anterior a esa fecha deja de contar.
 */

/** Bloqueos a partir de los cuales el número cuenta como reportado para todos. */
export const BLOCK_REPORT_THRESHOLD = 3;

export interface Reputation {
  number_key: string;
  reports: number;
  scam: number;
  suspicious: number;
  mentioned_in: number;
  /** Veces que lo bloquearon desde la app (desde el último "Eliminar reporte"). */
  blocks: number;
  last_reported_at: string | null;
  scam_type: string | null;
  impersonating: string | null;
}

export function numberKey(value: string) {
  const key = normalizePhonePe(value);
  if (!key) throw new ApiError(400, "invalid_number", "El número no es válido.");
  return key;
}

export async function getReputation(number: string, connection?: Sql): Promise<Reputation> {
  const key = numberKey(number);
  const local = key.slice(3);
  const international = `51${local}`;
  const sql = connection ?? (await db());
  const [clear] = await sql<{ cleared_at: string }[]>`select cleared_at from number_report_clears where number_key = ${key}`;
  const since = clear?.cleared_at ?? null;
  // Comparar números peruanos completos; un número extranjero con igual sufijo no es la misma línea.
  const [stats] = await sql<Omit<Reputation, "number_key" | "mentioned_in">[]>`
    with calls as (
      select verdict, blocked, started_at, scam_type, impersonating from incidents
      where simulated = false and sharing_revoked_at is null
        and regexp_replace(coalesce(caller_e164, caller_number_raw, ''), '\\D', '', 'g') in (${local},${international})
        and (${since}::timestamptz is null or coalesce(started_at, created_at) > ${since}::timestamptz)
    ), counted as (
      select (count(*) filter (where blocked))::int as blocks from calls
    ), reported as (
      select calls.* from calls, counted
      where verdict in ('scam', 'suspicious') or (blocked and counted.blocks >= ${BLOCK_REPORT_THRESHOLD})
    )
    select (select count(*)::int from reported) as reports,
           (select count(*)::int from reported where verdict = 'scam') as scam,
           (select count(*)::int from reported where verdict = 'suspicious') as suspicious,
           (select blocks from counted) as blocks,
           (select max(started_at) from reported) as last_reported_at,
           (select scam_type from reported where scam_type is not null group by scam_type order by count(*) desc limit 1) as scam_type,
           (select impersonating from reported where impersonating is not null group by impersonating order by count(*) desc limit 1) as impersonating`;
  const [{ mentioned_in }] = await sql<{ mentioned_in: number }[]>`
    select count(distinct e.incident_id)::int as mentioned_in from entities e
    join incidents i on i.id = e.incident_id
    where e.kind = 'telefono' and e.provenance = 'mencionado' and e.normalized in (${key},${local})
      and i.simulated = false and i.sharing_revoked_at is null
      and (${since}::timestamptz is null or coalesce(i.started_at, i.created_at) > ${since}::timestamptz)`;
  return { number_key: key, ...stats, mentioned_in };
}
