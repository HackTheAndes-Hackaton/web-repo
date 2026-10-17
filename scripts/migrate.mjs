// Aplica las migraciones de supabase/migrations a la base de DATABASE_URL.
// Uso: npm run db:migrate   (lee .env.local)
import { databaseClient, reportDatabaseError } from "./database-config.mjs";
import { applyMigrations } from "./migration-runner.mjs";

let sql;
try {
  sql = databaseClient({ migration: true });
  const files = await applyMigrations(sql);
  console.log(files.length ? files.map((f) => `Aplicada: ${f}`).join("\n") : "La base ya está actualizada.");
} catch (error) {
  reportDatabaseError(error);
  process.exitCode = 1;
} finally {
  if (sql) await sql.end();
}
