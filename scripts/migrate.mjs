// Aplica las migraciones de supabase/migrations a la base de DATABASE_URL.
// Uso: npm run db:migrate   (lee .env.local)
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL (copia .env.example a .env.local).");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { prepare: false, ssl: local ? false : "require", max: 1, onnotice: () => {} });

const dir = path.join(process.cwd(), "supabase", "migrations");
try {
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await sql.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
    console.log("✓", file);
  }
} finally {
  await sql.end();
}
