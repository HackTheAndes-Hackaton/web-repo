import "server-only";
import crypto from "node:crypto";
import postgres from "postgres";
import { seedDemoData } from "./seed";
import { applyMigrations } from "../../scripts/migration-runner.mjs";

/**
 * Conexión a Supabase (Postgres) desde el servidor.
 *
 * DATABASE_URL es la cadena del Session pooler de Supabase (IPv4, puerto 5432;
 * funciona en local y en Vercel). La conexión directa db.<ref>.supabase.co es
 * solo IPv6 y no sirve en Vercel.
 */

export type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
/** Cliente o transacción: las funciones que escriben aceptan cualquiera de los dos. */
export type Db = Sql | Tx;

/** Postgres devuelve "2026-10-17 18:52:55.12+00"; la app trabaja con ISO 8601. */
function toIso(value: string) {
  const normalized = value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function createClient(): Sql {
  // POSTGRES_URL es la que crea la integración de Supabase en Vercel (pooler de Supabase).
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "Falta DATABASE_URL. En local copia .env.example a .env.local; en Vercel agrégala en Settings → Environment Variables (o conecta la integración de Supabase).",
    );
  }
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // Las cadenas de Supabase/Vercel traen parámetros extra (sslmode, supa, …) que
  // postgres.js enviaría al servidor; el SSL se configura abajo.
  const clean = new URL(url);
  clean.search = "";
  // El Transaction pooler (6543) se cuelga cuando postgres.js encadena consultas
  // en la misma conexión; el Session pooler del mismo host no tiene ese problema.
  if (clean.hostname.endsWith(".pooler.supabase.com") && clean.port === "6543") clean.port = "5432";
  return postgres(clean.toString(), {
    prepare: false, // compatible con cualquier modo del pooler de Supabase
    ssl: local ? false : "require",
    // En Vercel cada instancia abre su propio pool y el Session pooler de Supabase
    // admite pocos clientes: una conexión por instancia, liberada pronto.
    max: Number(process.env.DATABASE_POOL_MAX ?? (local || process.env.VERCEL ? 1 : 5)),
    idle_timeout: process.env.VERCEL ? 5 : 20,
    onnotice: () => {},
    types: {
      // Fechas como cadenas ISO en lugar de objetos Date.
      isoDate: {
        to: 1184,
        from: [1082, 1114, 1184],
        serialize: (x: string | Date) => (x instanceof Date ? x.toISOString() : x),
        parse: toIso,
      },
    },
  });
}

const g = globalThis as unknown as { __sql?: Sql; __dbReady?: Promise<void> };

/** Cliente sin esperar a que el esquema esté listo (solo para la inicialización). */
export function rawClient(): Sql {
  return (g.__sql ??= createClient());
}

async function prepare() {
  const sql = rawClient();
  await applyMigrations(sql);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from users`;
  if (n === 0) await sql.begin((tx) => seedDemoData(tx));
}

/** Cliente listo para usar: aplica el esquema y los datos de demo la primera vez. */
export async function db(): Promise<Sql> {
  g.__dbReady ??= prepare().catch((err) => {
    g.__dbReady = undefined; // reintenta en la siguiente solicitud
    throw err;
  });
  await g.__dbReady;
  return rawClient();
}

/** Borra todos los datos y vuelve a cargar la demo. */
export async function resetDatabase() {
  const sql = await db();
  await sql.begin(async (tx) => {
    await tx`truncate links, notes, actions, voice_samples, voice_profiles, entities, signals, segments, incidents, users, organizations cascade`;
    await seedDemoData(tx);
  });
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

/** Formato de pgvector para insertar un embedding. */
export function toVector(embedding: number[]) {
  return `[${embedding.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
}
