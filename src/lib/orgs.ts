/**
 * Solo hay una organización. Las que se fusionaron con ella se siguen aceptando por
 * su nombre anterior, para que los servicios ya desplegados no dejen de funcionar.
 */
const MERGED_INTO: Record<string, string> = { org_vecinal: "org_uav" };

export function canonicalOrg<T extends string | null>(id: T): T {
  return (id && MERGED_INTO[id] ? MERGED_INTO[id] : id) as T;
}
