import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const directory = path.join(process.cwd(), "supabase", "migrations");
export function migrationFiles() {
  return fs.readdirSync(directory).filter((name) => name.endsWith(".sql")).sort().map((name) => {
    const source = fs.readFileSync(path.join(directory, name), "utf8");
    return { name, source, checksum: crypto.createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex") };
  });
}

/** @param {import('postgres').Sql} sql */
export async function applyMigrations(sql) {
  const files = migrationFiles();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(846231901)`;
    await tx`create schema if not exists app_meta`;
    await tx`create table if not exists app_meta.schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now()
    )`;
    const history = await tx`select name, checksum from app_meta.schema_migrations`;
    const applied = new Map(history.map((row) => [row.name, row.checksum]));
    const [{ existing }] = await tx`select to_regclass('public.links') is not null as existing`;
    const initial = files[0];
    // La demo original no tenía historial. La nueva migración incorpora sus diferencias.
    if (existing && initial && !applied.has(initial.name)) {
      await tx`insert into app_meta.schema_migrations(name,checksum) values (${initial.name},${initial.checksum})`;
      applied.set(initial.name, initial.checksum);
    }
    const executed = [];
    for (const file of files) {
      if (applied.has(file.name)) {
        if (applied.get(file.name) !== file.checksum) throw new Error(`La migración ${file.name} cambió después de aplicarse. Crea una nueva migración.`);
        continue;
      }
      await tx.unsafe(file.source);
      await tx`insert into app_meta.schema_migrations(name,checksum) values (${file.name},${file.checksum})`;
      executed.push(file.name);
    }
    return executed;
  });
}
