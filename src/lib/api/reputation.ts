import "server-only";
import { db, type Sql } from "../db";
import { normalizePhonePe } from "../peru";
import { ApiError } from "./http";

/**
 * Reputación comunitaria de un número: cuántas llamadas reales lo marcaron como estafa o
 * sospechoso, en cualquier organización, y en cuántos casos se mencionó (por ejemplo, como
 * número de Yape). Solo totales: nunca conversaciones, personas ni organizaciones.
 * Lo consulta la app mientras suena la llamada para avisar antes de contestar.
 */

export interface Reputation {
  number_key: string;
  reports: number;
  scam: number;
  suspicious: number;
  mentioned_in: number;
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
  // Comparar números peruanos completos; un número extranjero con igual sufijo no es la misma línea.
  const [stats] = await sql<Omit<Reputation, "number_key" | "mentioned_in">[]>`
    with calls as (
      select verdict, started_at, scam_type, impersonating from incidents
      where simulated = false and sharing_revoked_at is null
        and verdict in ('scam', 'suspicious')
        and regexp_replace(coalesce(caller_e164, caller_number_raw, ''), '\\D', '', 'g') in (${local},${international})
    )
    select count(*)::int as reports,
           count(*) filter (where verdict = 'scam')::int as scam,
           count(*) filter (where verdict = 'suspicious')::int as suspicious,
           max(started_at) as last_reported_at,
           (select scam_type from calls where scam_type is not null group by scam_type order by count(*) desc limit 1) as scam_type,
           (select impersonating from calls where impersonating is not null group by impersonating order by count(*) desc limit 1) as impersonating
    from calls`;
  const [{ mentioned_in }] = await sql<{ mentioned_in: number }[]>`
    select count(distinct e.incident_id)::int as mentioned_in from entities e
    join incidents i on i.id = e.incident_id
    where e.kind = 'telefono' and e.provenance = 'mencionado' and e.normalized in (${key},${local})
      and i.simulated = false and i.sharing_revoked_at is null`;
  return { number_key: key, ...stats, mentioned_in };
}
