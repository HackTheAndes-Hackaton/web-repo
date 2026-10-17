import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";
import { seedDemoData } from "./seed";

/**
 * Conexión a Supabase (Postgres) desde el servidor.
 *
 * DATABASE_URL es la cadena de conexión del proyecto de Supabase
 * (Project Settings → Database → Connection string). Se recomienda el pooler
 * en modo transacción (puerto 6543), que no admite sentencias preparadas.
 */

export type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
/** Cliente o transacción: las funciones que escriben aceptan cualquiera de los dos. */
export type Db = Sql | Tx;

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/** Postgres devuelve "2026-10-17 18:52:55.12+00"; la app trabaja con ISO 8601. */
function toIso(value: string) {
  const normalized = value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function createClient(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Falta DATABASE_URL. Copia .env.example a .env.local y pega la cadena de conexión de tu proyecto de Supabase.",
    );
  }
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return postgres(url, {
    prepare: false, // requerido por el pooler de Supabase en modo transacción
    ssl: local ? false : "require",
    max: Number(process.env.DATABASE_POOL_MAX ?? (local ? 1 : 5)),
    idle_timeout: 20,
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

async function applyMigrations(sql: Sql) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) await sql.unsafe(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
}

async function prepare() {
  const sql = rawClient();
  const [{ exists }] = await sql<{ exists: boolean }[]>`select to_regclass('public.links') is not null as exists`;
  if (!exists) await applyMigrations(sql);
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
    await tx`truncate links, notes, actions, voice_samples, entities, signals, segments, incidents, users, organizations cascade`;
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
