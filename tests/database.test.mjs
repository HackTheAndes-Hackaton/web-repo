import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { applyMigrations } from "../scripts/migration-runner.mjs";
import { refreshLinksFor } from "../src/lib/links.ts";
import { getResource } from "../src/lib/api/resources.ts";
import { seedDemoData } from "../src/lib/seed.ts";
import { buildOpenApi } from "../src/lib/api/openapi.ts";
import { createRows, updateRow, deleteRow } from "../src/lib/api/crud.ts";

const initial = await fs.readFile(new URL('../supabase/migrations/20261017000000_init.sql', import.meta.url),'utf8');

async function database(run) {
  const db = await PGlite.create({ extensions: { vector } });
  const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
  await server.start();
  const address = server.getServerConn();
  const sql = postgres({ host:'127.0.0.1', port:Number(address.split(':').at(-1)), username:'postgres', database:'postgres', prepare:false, max:1, onnotice:()=>{} });
  try { await run(db,sql); }
  finally { await sql.end(); await server.stop(); await db.close(); }
}
async function fixture(sql) {
  await applyMigrations(sql);
  await sql`insert into organizations(id,name) values ('org','Organización'),('other','Otra')`;
  await sql`insert into users(id,name,role,org_id) values ('analyst','Analista','analista','org'),('second','Otra analista','analista','org')`;
  await sql`insert into incidents(id,org_id,simulated,consent_snapshot) values
    ('a','org',false,'{"voice_storage":true,"voice_reference":true}'),
    ('b','org',false,'{"voice_storage":true,"voice_reference":true}')`;
}

test('actualiza una base existente sin perder datos ni la revisión anterior; repetir no cambia el historial', async () => {
  await database(async (db,sql) => {
    await db.exec(initial);
    await db.exec("insert into incidents(id,title) values ('old-a','Caso conservado'),('old-b','Otro'); insert into links(id,incident_a,incident_b,score,status,reviewed_by) values ('old-link','old-a','old-b',0.8,'confirmado','Revisor anterior')");
    const files=await applyMigrations(sql);
    assert.deepEqual(files,['20261017010000_call_data_and_review_history.sql']);
    assert.equal((await sql`select title from incidents where id='old-a'`)[0].title,'Caso conservado');
    assert.equal((await sql`select simulated from incidents where id='old-a'`)[0].simulated,null);
    const [link]=await sql`select * from links where id='old-link'`;
    assert.equal(link.status,'confirmado'); assert.equal(link.reviewed_evidence.score,0.8);
    assert.deepEqual(await applyMigrations(sql),[]);
    assert.equal((await sql`select count(*)::int n from app_meta.schema_migrations`)[0].n,2);
  });
});

test('admite el esquema antiguo con shared_org_id y sin api_keys, speaker ni external_id', async () => {
  await database(async (db,sql) => {
    await db.exec(initial);
    await db.exec("drop table api_keys; alter table incidents rename column org_id to shared_org_id; alter table incidents drop column external_id; alter table segments drop column speaker; insert into organizations(id,name) values ('legacy-org','Anterior'); insert into incidents(id,shared_org_id) values ('old','legacy-org')");
    await applyMigrations(sql);
    assert.equal((await sql`select org_id from incidents where id='old'`)[0].org_id,'legacy-org');
    assert.equal((await sql`select to_regclass('public.api_keys') is not null ok`)[0].ok,true);
  });
});

test('congela la evidencia revisada y conserva cada decisión con su analista al reabrir y revisar', async () => {
  await database(async (_db,sql) => {
    await fixture(sql);
    await sql`insert into entities(id,incident_id,kind,value,normalized) values ('e1','a','cuenta','123','123'),('e2','b','cuenta','123','123')`;
    await refreshLinksFor('a',sql);
    const [original]=await sql`select * from links`;
    await sql`update links set status='confirmado',reviewed_by='Analista',reviewed_by_id='analyst' where id=${original.id}`;
    const [reviewed]=await sql`select * from links`;
    await assert.rejects(sql`update links set score=0.99 where id=${original.id}`, (e)=>e.code==='P0001');
    await sql`delete from entities where id='e2'`;
    await refreshLinksFor('a',sql);
    const [after]=await sql`select * from links`;
    assert.equal(after.score,reviewed.score); assert.deepEqual(after.reasons,reviewed.reasons);
    assert.deepEqual(after.reviewed_evidence,reviewed.reviewed_evidence);
    await sql`update links set status='pendiente',reviewed_by_id='second' where id=${original.id}`;
    let history=await sql`select * from actions where link_id=${original.id} order by created_at,id`;
    assert.equal(history.length,2);
    const reopened=history.find((r)=>r.payload.after.status==='pendiente');
    assert.equal(reopened.actor_id,'second'); assert.equal(reopened.payload.before.status,'confirmado');
    assert.deepEqual(reopened.payload.before.reviewed_evidence,reviewed.reviewed_evidence);
    await sql`update links set score=0.9,status='descartado',reviewed_by_id='second' where id=${original.id}`;
    const [last]=await sql`select * from links`;
    assert.equal(last.evidence_version,2); assert.equal(last.reviewed_evidence_version,2);
    assert.equal(last.reviewed_evidence.score,0.9);
  });
});

test('no mezcla modelos ni dimensiones; exige una referencia revisada y permiso explícito', async () => {
  await database(async (_db,sql) => {
    await fixture(sql);
    const v16='['+Array(16).fill(1).join(',')+']';
    const v32='['+Array(32).fill(1).join(',')+']';
    await sql`insert into voice_samples(id,incident_id,embedding,model_id,model_version,speaker,quality_status)
      values ('va','a',${v16}::extensions.vector,'ecapa','1','caller','usable'),('vb','b',${v32}::extensions.vector,'ecapa','1','caller','usable')`;
    await refreshLinksFor('a',sql);
    assert.equal((await sql`select count(*)::int n from links`)[0].n,0);
    await sql`update voice_samples set review_status='aprobada',reference_enabled=true where id='vb'`;
    await refreshLinksFor('a',sql); // Dimensiones distintas: no error y no coincidencia.
    assert.equal((await sql`select count(*)::int n from links`)[0].n,0);
    await sql`update voice_samples set embedding=${v16}::extensions.vector,model_version='2' where id='vb'`;
    await refreshLinksFor('a',sql);
    assert.equal((await sql`select count(*)::int n from links`)[0].n,0);
    await sql`update voice_samples set model_version='1' where id='vb'`;
    await refreshLinksFor('a',sql);
    const [matched]=await sql`select * from links`;
    assert.ok(matched.voice_sim>0.99); assert.equal(matched.evidence_snapshot.sample_b,'vb');
    await sql`update incidents set consent_snapshot='{"voice_storage":true,"voice_reference":false}' where id='b'`;
    await refreshLinksFor('a',sql);
    assert.equal((await sql`select count(*)::int n from links`)[0].n,0);
    await assert.rejects(sql`update voice_samples set reference_enabled=true where id='va'`,(e)=>e.code==='23514');
  });
});

test('separa las muestras de demo y no permite perfiles de otra organización', async () => {
  await database(async (_db,sql) => {
    await fixture(sql);
    await sql`update incidents set simulated=true where id='b'`;
    await sql`insert into entities(id,incident_id,kind,value,normalized) values ('e1','a','cuenta','123','123'),('e2','b','cuenta','123','123')`;
    await refreshLinksFor('a',sql);
    assert.equal((await sql`select count(*)::int n from links`)[0].n,0);
    await sql`insert into voice_profiles(id,org_id,public_code) values ('p','other','VOZ-001')`;
    const v='['+Array(16).fill(1).join(',')+']';
    await assert.rejects(sql`insert into voice_samples(id,incident_id,embedding,profile_id) values ('v','a',${v}::extensions.vector,'p')`,(e)=>e.code==='23514');
  });
});

test('la API acepta los datos móviles y PATCH no restablece campos omitidos', () => {
  const incident=getResource('incidents');
  const input=incident.create.parse({ caller_e164:'+51987654321',client_call_id:'android-1',verdict:'suspicious',risk_reasons:['Urgencia'],simulated:false,consent_snapshot:{voice_storage:true} });
  assert.equal(input.client_call_id,'android-1');
  assert.deepEqual(incident.update.parse({summary:'Actualizado'}),{summary:'Actualizado'});
  assert.deepEqual(getResource('voice-samples').update.parse({quality_status:'usable'}),{quality_status:'usable'});
  assert.equal(getResource('voice-samples').columns.includes('embedding'),false);
  assert.equal(getResource('voice-samples').create.safeParse({incident_id:'a',embedding:Array(16).fill(0)}).success,false);
  const spec=buildOpenApi('http://localhost');
  assert.ok(spec.paths['/voice-profiles']);
});

test('los datos de demostración funcionan con el esquema nuevo y tienen origen y modelo explícitos', async () => {
  await database(async (_db,sql) => {
    await applyMigrations(sql);
    await seedDemoData(sql);
    assert.ok((await sql`select count(*)::int n from incidents where simulated=true`)[0].n>0);
    assert.equal((await sql`select count(*)::int n from incidents where simulated is not true`)[0].n,0);
    assert.ok((await sql`select count(*)::int n from links where status='confirmado' and reviewed_evidence is not null`)[0].n>0);
    assert.ok((await sql`select count(*)::int n from actions where kind='link_review'`)[0].n>0);
  });
});

test('el CRUD persiste JSON, metadatos y revisiones; PATCH conserva los campos omitidos', async () => {
  await database(async (_db,sql) => {
    await fixture(sql);
    globalThis.__sql=sql;
    globalThis.__dbReady=Promise.resolve();
    try {
      const incident=getResource('incidents');
      const result=await createRows(incident,{id:'mobile',org_id:'org',client_call_id:'android-5',risk_reasons:['Pide dinero'],consent_snapshot:{voice_storage:true},analysis_meta:{model:'m1'}});
      assert.deepEqual(result.data.risk_reasons,['Pide dinero']);
      assert.equal(result.data.analysis_meta.model,'m1');
      const patched=await updateRow(incident,'mobile',{summary:'Nuevo resumen'});
      assert.deepEqual(patched.risk_reasons,['Pide dinero']);
      assert.equal(patched.consent_snapshot.voice_storage,true);
      const voice=await createRows(getResource('voice-samples'),{incident_id:'mobile',embedding:Array(16).fill(1),model_id:'m',model_version:'1',speaker:'caller',quality_status:'usable'});
      assert.equal(voice.data.embedding_dims,16); assert.equal('embedding' in voice.data,false);
      const link=await createRows(getResource('links'),{incident_a:'a',incident_b:'b',score:0.8,reasons:[{kind:'contenido',detail:'Guion parecido'}]});
      await updateRow(getResource('links'),link.data.id,{status:'confirmado',reviewed_by_id:'analyst'});
      await assert.rejects(updateRow(getResource('links'),link.data.id,{score:0.95}),(e)=>e.code==='P0001');
      const [audit]=await sql`select id from actions where kind='link_review' and link_id=${link.data.id}`;
      await assert.rejects(deleteRow(getResource('actions'),audit.id),(e)=>e.code==='immutable_review');
    } finally { delete globalThis.__sql; delete globalThis.__dbReady; }
  });
});
