// Prueba local opcional: motor real de huellas (instalado aparte) + base con pgvector.
// Uso: node --import ./tests/register-ts.mjs tests/voice-e2e.local.mjs <dir-motor> <wav-voz-A1> <wav-voz-A2> <wav-voz-B>
// Los WAV deben ser PCM16 mono 16 kHz y de voces ficticias.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { applyMigrations } from "../scripts/migration-runner.mjs";
import { enrollVoice, searchVoices } from "../src/lib/api/voice-matches.ts";
import { createVoiceprintEngine, VoiceCollector } from "../../agents/voiceprint.mjs";

const [dir, a1, a2, b] = process.argv.slice(2);
const engine = createVoiceprintEngine({ dir });
if (!(await engine.ready)) throw Error("Motor no disponible");
const embed = async (file) => {
  const c = new VoiceCollector();
  c.push(readFileSync(file).subarray(44), 16000);
  const s = c.snapshot();
  return engine.embed(s.pcm, s.rate);
};
const db = await PGlite.create({ extensions: { vector } });
const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0 });
await server.start();
const sql = postgres({ host: "127.0.0.1", port: Number(server.getServerConn().split(":").at(-1)), username: "postgres", database: "postgres", prepare: false, max: 1, onnotice: () => {} });
try {
  await applyMigrations(sql);
  await sql`insert into organizations(id,name) values ('org_a','Usuario A'),('org_b','Usuario B')`;
  const model = { model_id: engine.model.id, model_version: engine.model.version };
  await enrollVoice("org_a", { request_id: crypto.randomUUID(), session_id: crypto.randomUUID(), embeddings: [await embed(a1)], ...model,
    active_s: 10, risk_score: 95, caller_number: "987654321", simulated: true }, sql);
  const same = await searchVoices({ embedding: await embed(a2), ...model, simulated: true }, sql);
  const other = await searchVoices({ embedding: await embed(b), ...model, simulated: true }, sql);
  console.log(JSON.stringify({ misma_voz_otro_numero: same, otra_voz: other }, null, 2));
} finally { engine.close(); await sql.end(); await server.stop(); await db.close(); }
