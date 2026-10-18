import "server-only";
import crypto from "node:crypto";
import { db, newId, nowIso } from "./db";

/**
 * Claves de API para los servicios que alimentan el panel (servidor de
 * llamadas, servicio de IA). Formato: phw_<48 hex>. Solo se guarda el hash.
 */

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const hash = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

export async function createApiKey(name: string) {
  const key = `phw_${crypto.randomBytes(24).toString("hex")}`;
  const sql = await db();
  const [row] = await sql<ApiKey[]>`
    insert into api_keys (id, name, prefix, key_hash, created_at)
    values (${newId("key")}, ${name}, ${key.slice(0, 12)}, ${hash(key)}, ${nowIso()})
    returning id, name, prefix, created_at, last_used_at, revoked_at`;
  return { key, record: row };
}

export async function listApiKeys() {
  const sql = await db();
  return [
    ...(await sql<ApiKey[]>`
      select id, name, prefix, created_at, last_used_at, revoked_at from api_keys
      order by revoked_at nulls first, created_at desc`),
  ];
}

export async function revokeApiKey(id: string) {
  const sql = await db();
  await sql`update api_keys set revoked_at = ${nowIso()} where id = ${id} and revoked_at is null`;
}

// Evita escribir last_used_at en cada solicitud.
const lastTouch = new Map<string, number>();

/** Devuelve la clave válida que corresponde al texto recibido, o null. */
export async function verifyApiKey(presented: string | null) {
  // tkz_ (Tiskz) y cen_ son prefijos de claves creadas antes de los cambios de nombre: siguen valiendo.
  if (!presented || !/^(phw|tkz|cen)_/.test(presented)) return null;
  const sql = await db();
  const [row] = await sql<ApiKey[]>`
    select id, name, prefix, created_at, last_used_at, revoked_at from api_keys
    where key_hash = ${hash(presented)} and revoked_at is null`;
  if (!row) return null;
  const now = Date.now();
  if (now - (lastTouch.get(row.id) ?? 0) > 60_000) {
    lastTouch.set(row.id, now);
    await sql`update api_keys set last_used_at = ${nowIso()} where id = ${row.id}`;
  }
  return row;
}
