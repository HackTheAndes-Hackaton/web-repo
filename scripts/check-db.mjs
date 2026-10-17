import { databaseClient, reportDatabaseError } from "./database-config.mjs";
import { migrationFiles } from "./migration-runner.mjs";

let sql;
try {
  sql = databaseClient({ migration: true });
  await sql.begin('read only', async (tx) => {
    const tables = await tx`select tablename from pg_tables where schemaname='public' order by tablename`;
    const columns = await tx`select table_name,column_name,data_type from information_schema.columns
      where table_schema='public' and table_name in ('incidents','voice_samples','links','actions','voice_profiles')
      order by table_name,ordinal_position`;
    const [{ exists }] = await tx`select to_regclass('app_meta.schema_migrations') is not null as exists`;
    const history = exists ? await tx`select name,checksum from app_meta.schema_migrations order by name` : [];
    const pending = migrationFiles().filter((file) => !history.some((row) => row.name===file.name && row.checksum===file.checksum)).map((file) => file.name);
    console.log(JSON.stringify({ tables: tables.map((row) => row.tablename), columns, pending_migrations: pending }, null, 2));
  });
} catch (error) { reportDatabaseError(error); process.exitCode=1; }
finally { if (sql) await sql.end(); }
