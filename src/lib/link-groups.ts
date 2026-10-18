import type { Incident, IncidentLink } from "./types";

export type GroupIncident = Pick<Incident, "id" | "org_id" | "simulated" | "sharing_revoked_at">;
type Connection = Pick<IncidentLink, "id" | "incident_a" | "incident_b" | "status">;

export interface LinkGroup<T extends Connection> {
  /** Ancla de navegación calculada; no es un ID persistente de campaña o persona. */
  anchor: string;
  incidentIds: string[];
  links: T[];
  confirmedCount: number;
  pendingCount: number;
}

/**
 * Componentes de una red: un grupo admite dos o más casos sin crear nuevas
 * conexiones, promediar confianza ni extender la revisión de una arista a otra.
 */
export function buildLinkGroups<T extends Connection>(incidents: GroupIncident[], links: T[]): LinkGroup<T>[] {
  const cases = new Map(incidents.filter((i) => i.org_id && !i.sharing_revoked_at).map((i) => [i.id, i]));
  const neighbors = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const eligible = links.filter((link) => {
    const a = cases.get(link.incident_a);
    const b = cases.get(link.incident_b);
    if (link.status === "descartado" || link.incident_a === link.incident_b || seen.has(link.id) ||
        !a || !b || a.org_id !== b.org_id || a.simulated !== b.simulated) return false;
    seen.add(link.id);
    for (const [from, to] of [[a.id, b.id], [b.id, a.id]]) {
      if (!neighbors.has(from)) neighbors.set(from, new Set());
      neighbors.get(from)!.add(to);
    }
    return true;
  });
  const visited = new Set<string>();
  const component = new Map<string, LinkGroup<T>>();
  const groups: LinkGroup<T>[] = [];
  for (const start of [...neighbors.keys()].sort()) {
    if (visited.has(start)) continue;
    const queue = [start];
    visited.add(start);
    for (let index = 0; index < queue.length; index++) {
      for (const next of neighbors.get(queue[index]) ?? []) {
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    queue.sort();
    const group: LinkGroup<T> = { anchor: `grupo-${queue[0]}`, incidentIds: queue, links: [], confirmedCount: 0, pendingCount: 0 };
    for (const id of queue) component.set(id, group);
    groups.push(group);
  }
  for (const link of eligible) {
    const group = component.get(link.incident_a)!;
    group.links.push(link);
    if (link.status === "confirmado") group.confirmedCount++;
    else group.pendingCount++;
  }
  return groups.sort((a, b) => b.incidentIds.length - a.incidentIds.length || a.incidentIds[0].localeCompare(b.incidentIds[0]));
}
