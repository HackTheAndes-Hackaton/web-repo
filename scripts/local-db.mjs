// Postgres local para desarrollo mientras no hay proyecto de Supabase.
// PGlite (Postgres en WebAssembly) con pgvector, expuesto en el puerto 54322.
// Los datos se guardan en .pglite/ (ignorado por git). Uso: npm run db:local
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const dataDir = "./.pglite";
fs.mkdirSync(dataDir, { recursive: true });
const port = Number(process.env.LOCAL_DB_PORT ?? 54322);

const db = await PGlite.create({ dataDir, extensions: { vector } });
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 10 });
await server.start();
console.log(`Postgres local listo: postgres://postgres:postgres@127.0.0.1:${port}/postgres`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
