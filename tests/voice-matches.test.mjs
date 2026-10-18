import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { applyMigrations } from "../scripts/migration-runner.mjs";
import { enrollVoice, searchVoices } from "../src/lib/api/voice-matches.ts";
import { getReputation } from "../src/lib/api/reputation.ts";

async function database(run) {
  const db = await PGlite.create({ extensions: { vector } });
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0 });
  await server.start();
  const sql = postgres({ host: "127.0.0.1", port: Number(server.getServerConn().split(":").at(-1)), username: "postgres", database: "postgres", prepare: false, max: 1, onnotice: () => {} });
  try {
    await applyMigrations(sql);
    await sql`insert into organizations(id,name) values ('org_a','Vecinos A'),('org_b','Vecinos B')`;
    await run(sql);
  } finally { await sql.end(); await server.stop(); await db.close(); }
}

// Huellas ficticias: vectores deterministas, no voces reales.
function voice(seed, noise = 0) {
  let x = seed;
  const next = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648 - 0.5; };
  return Array.from({ length: 256 }, () => next()).map((v, i) => v + (noise ? Math.sin(i * noise) * 0.05 : 0));
}
const model = { model_id: "modelo-ficticio", model_version: "v1" };
const enroll = (over = {}) => ({ request_id: crypto.randomUUID(), session_id: crypto.randomUUID(), embeddings: [voice(1)], ...model,
  active_s: 20, risk_score: 95, caller_number: "987654321", simulated: false, ...over });

test("una voz guardada por un usuario se reconoce en la llamada de otro usuario, solo con totales", async () => {
  await database(async (sql) => {
    const saved = await enrollVoice("org_a", enroll({ embeddings: [voice(1), voice(1, 3), voice(1, 5)] }), sql);
    assert.equal(saved.samples, 3);
    const hit = await searchVoices({ embedding: voice(1, 7), ...model }, sql);
    assert.ok(hit.best_similarity > 0.95, String(hit.best_similarity));
    assert.equal(hit.cases, 1);
    assert.equal(hit.reviewed_cases, 0);
    assert.deepEqual(Object.keys(hit).sort(), ["best_similarity", "cases", "impersonating", "last_seen_at", "reviewed_cases", "scam_type"]);
    const miss = await searchVoices({ embedding: voice(99), ...model }, sql);
    assert.ok(miss.best_similarity < 0.5);
    assert.equal(miss.cases, 0);
  });
});

test("reintentar no duplica; otro modelo, pruebas simuladas y muestras rechazadas no se mezclan", async () => {
  await database(async (sql) => {
    const body = enroll();
    await enrollVoice("org_a", body, sql);
    assert.equal((await enrollVoice("org_a", body, sql)).samples, 0);
    assert.equal((await searchVoices({ embedding: voice(1), model_id: "otro", model_version: "v1" }, sql)).best_similarity, null);
    assert.equal((await searchVoices({ embedding: voice(1), ...model, simulated: true }, sql)).best_similarity, null);
    await sql`update voice_samples set review_status='rechazada'`;
    assert.equal((await searchVoices({ embedding: voice(1), ...model }, sql)).cases, 0);
  });
});

test("guardar la voz no cuenta dos veces el número en la reputación", async () => {
  await database(async (sql) => {
    await enrollVoice("org_b", enroll(), sql);
    assert.equal((await getReputation("987654321", sql)).reports, 0);
    const [incident] = await sql`select verdict, caller_e164, analysis_meta from incidents`;
    assert.equal(incident.verdict, "scam");
    assert.equal(incident.caller_e164, null);
    assert.equal(incident.analysis_meta.caller_number, "+51987654321");
    assert.equal(incident.analysis_meta.identity_verified, false);
  });
});

test("valida la entrada: sin dimensiones mezcladas ni huellas vacías", async () => {
  await database(async (sql) => {
    await assert.rejects(enrollVoice("org_a", enroll({ embeddings: [voice(1), voice(2).slice(0, 128)] }), sql), /misma dimensión/);
    await assert.rejects(enrollVoice("org_a", enroll({ embeddings: [] }), sql));
    await assert.rejects(searchVoices({ embedding: [1, 2, 3], ...model }, sql));
  });
});
