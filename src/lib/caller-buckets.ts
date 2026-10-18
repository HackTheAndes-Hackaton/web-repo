import type { IncidentSummary } from "./repo";

const RISK_ORDER = { alto: 3, medio: 2, bajo: 1 } as const;

/** Llamadas de un mismo número: en las listas se ven como una sola fila. */
export interface CallerBucket {
  key: string;
  number: string | null;
  /** Solo los dígitos, para buscar el número en la lista de casos. */
  digits: string | null;
  cases: IncidentSummary[];
  /** El caso con el riesgo más alto del grupo. */
  worst: IncidentSummary;
}

/**
 * Agrupa por número de origen conservando el orden recibido (del más reciente al
 * más antiguo): cada grupo toma la posición de su caso más reciente. Los casos
 * sin número, u ocultos, van solos.
 */
export function bucketByCaller(incidents: IncidentSummary[]): CallerBucket[] {
  const buckets = new Map<string, CallerBucket>();
  for (const i of incidents) {
    const raw = i.caller_e164 ?? i.caller_number_raw;
    const digits = raw?.replace(/\D/g, "") ?? "";
    const known = digits.length >= 7;
    const key = known ? `n:${digits}` : `c:${i.id}`;
    const b = buckets.get(key);
    if (b) {
      b.cases.push(i);
      if (RISK_ORDER[i.risk_level] > RISK_ORDER[b.worst.risk_level] ||
          (i.risk_level === b.worst.risk_level && i.risk_score > b.worst.risk_score)) b.worst = i;
    } else {
      buckets.set(key, { key, number: known ? raw : null, digits: known ? digits : null, cases: [i], worst: i });
    }
  }
  return [...buckets.values()];
}
