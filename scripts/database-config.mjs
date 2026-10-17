import postgres from "postgres";

/** Nunca imprime URL, contraseña ni parámetros de conexión. */
export function databaseClient({ migration = false } = {}) {
  const value = (migration && process.env.MIGRATION_DATABASE_URL) || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!value?.trim()) throw new Error("Completa DATABASE_URL en .env.local (y MIGRATION_DATABASE_URL si usas una conexión distinta para migrar).");
  let url;
  try { url = new URL(value); } catch { throw new Error("La conexión de .env.local no tiene formato de URL válido."); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || /PROJECT_REF|YOUR-PASSWORD|<|>/.test(value)) {
    throw new Error("Reemplaza los valores de ejemplo de la conexión de .env.local.");
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  url.search = "";
  return postgres(url.toString(), { prepare: false, ssl: local ? false : "require", max: 1, connect_timeout: 12, onnotice: () => {} });
}

export function reportDatabaseError(error) {
  const code = typeof error?.code === "string" ? error.code : null;
  if (!code && /Completa DATABASE_URL|formato de URL|valores de ejemplo|migración .* cambió/.test(error?.message ?? '')) console.error(error.message);
  else console.error(`No se completó la operación${code ? ` (${code})` : ''}. Revisa la conexión y el acceso a Supabase; no se muestran credenciales.`);
}
