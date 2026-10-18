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
import { bindNetworkOrigin, getNetworkOrigin, inspectNetworkOrigin } from "../src/lib/api/network-origin.ts";
import { getVapiCall } from "../src/lib/api/vapi.ts";
import { buildLinkGroups } from "../src/lib/link-groups.ts";
import { getIncidentDetail, dashboardData, navCounts } from "../src/lib/repo.ts";
import { createSuspect, listSuspects, SuspectError, unassignCase } from "../src/lib/suspects.ts";

const initial = await fs.readFile(new URL('../supabase/migrations/20261017000000_init.sql', import.meta.url),'utf8');

async function database(run) {
  const db = await PGlite.create({ extensions: { vector } });
  const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
  await server.start();
  const address = server.getServerConn();
  const sql = postgres({ host:'127.0.0.1', port:Number(address.split(':').at(-1)), username:'postgres', database:'postgres', prepare:false, max:1, onnotice:()=>{},
    // La aplicación recibe fechas ISO; reproducir ese contrato en la base temporal.
    types:{isoDate:{to:1184,from:[1082,1114,1184],serialize:value=>value instanceof Date?value.toISOString():value,
      parse:value=>new Date(value.replace(' ','T').replace(/([+-]\d\d)$/,'$1:00')).toISOString()}},
  });
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
    assert.deepEqual(files,['20261017010000_call_data_and_review_history.sql','20261017020000_audio_fragments.sql','20261018000000_suspects.sql']);
    assert.equal((await sql`select title from incidents where id='old-a'`)[0].title,'Caso conservado');
    assert.equal((await sql`select simulated from incidents where id='old-a'`)[0].simulated,null);
    const [link]=await sql`select * from links where id='old-link'`;
    assert.equal(link.status,'confirmado'); assert.equal(link.reviewed_evidence.score,0.8);
    assert.deepEqual(await applyMigrations(sql),[]);
    assert.equal((await sql`select count(*)::int n from app_meta.schema_migrations`)[0].n,4);
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


test('audio: guarda bytes originales, aísla organización y sesión, respeta revocación e idempotencia', async () => {
  const { saveAudio, listAudio, loadAudio } = await import('../src/lib/api/audio.ts');
  const { randomUUID } = await import('node:crypto');
  await database(async (_db,sql) => {
    await fixture(sql);
    const audio=Buffer.alloc(32044);
    audio.write('RIFF',0); audio.writeUInt32LE(audio.length-8,4); audio.write('WAVEfmt ',8);
    audio.writeUInt32LE(16,16); audio.writeUInt16LE(1,20); audio.writeUInt16LE(1,22);
    audio.writeUInt32LE(16000,24); audio.writeUInt32LE(32000,28); audio.writeUInt16LE(2,32); audio.writeUInt16LE(16,34);
    audio.write('data',36); audio.writeUInt32LE(32000,40);
    const input={session_id:randomUUID(),request_id:randomUUID(),consentimiento_conservacion:true,audio_base64:audio.toString('base64'),source:'webrtc_microphone',risk_percent:91};
    const row=await saveAudio('org',input,sql);
    assert.equal((await saveAudio('org',input,sql)).id,row.id);
    assert.equal((await listAudio('org',input.session_id,sql)).length,1);
    assert.equal((await listAudio('other',input.session_id,sql)).length,0);
    assert.deepEqual(await loadAudio('org',input.session_id,row.id,sql),audio);
    await assert.rejects(loadAudio('other',input.session_id,row.id,sql));
    await assert.rejects(loadAudio('org',randomUUID(),row.id,sql));
    await assert.rejects(saveAudio('org',{...input,consentimiento_conservacion:false},sql));
    await assert.rejects(saveAudio('org',{...input,audio_base64:Buffer.alloc(32044).toString('base64')},sql));
    const changed=Buffer.from(audio); changed[44]=2;
    await assert.rejects(saveAudio('org',{...input,audio_base64:changed.toString('base64')},sql),e=>e.code==='idempotency_conflict');
    const [incident]=await sql`select * from incidents where id=${row.incident_id}`;
    assert.equal(incident.caller_e164,null); assert.equal(incident.analysis_meta.identity_verified,false);
    assert.equal(incident.consent_snapshot.voice_reference,false);
    for(let index=0;index<5;index++) await saveAudio('org',{...input,request_id:randomUUID()},sql);
    await assert.rejects(saveAudio('org',{...input,request_id:randomUUID()},sql),e=>e.code==='clip_limit');
    await sql`update incidents set consent_snapshot='{"voice_storage":false}' where id=${row.incident_id}`;
    assert.equal((await listAudio('org',input.session_id,sql)).length,0);
    await assert.rejects(loadAudio('org',input.session_id,row.id,sql));
    await sql`delete from incidents where id=${row.incident_id}`;
    assert.equal((await sql`select count(*)::int n from audio_fragments`)[0].n,0);
  });
});

test('MCP HTTP compatible con herramientas 2025 entrega WAV reproducible', async () => {
  const { audioMcp }=await import('../src/lib/api/mcp.ts');
  const { randomUUID }=await import('node:crypto');
  const session_id=randomUUID();
  const fragment_id='clip_'+'a'.repeat(48);
  const wave=Buffer.from('audio-de-prueba');
  const handler=audioMcp('org',{
    saveAudio:async()=>({id:fragment_id}),
    listAudio:async(org,session)=>{assert.equal(org,'org');assert.equal(session,session_id);return [{id:fragment_id}];},
    loadAudio:async()=>wave,
  });
  const client=async(name,args)=>{
    const id=randomUUID();
    const response=await handler.fetch(new Request('http://mcp.test/api/v1/mcp',{
      method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'},
      body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}}),
    }));
    assert.equal(response.status,200);
    const text=await response.text();
    const message=response.headers.get('content-type').includes('event-stream')
      ? text.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5))).find(item=>item.id===id) : JSON.parse(text);
    if(message.error || message.result?.isError) throw Error('Tool rejected');
    return message.result.content;
  };
  try {
    const list=await client('listar_fragmentos',{session_id});
    assert.equal(JSON.parse(list[0].text)[0].id,fragment_id);
    const audio=await client('escuchar_fragmento',{session_id,fragment_id});
    assert.equal(audio[0].mimeType,'audio/wav');assert.deepEqual(Buffer.from(audio[0].data,'base64'),wave);
    await assert.rejects(client('listar_fragmentos',{session_id:'invalid'}));
  } finally {await handler.close();}
});

test('HTTP audio autentica el servicio y comparte permisos, datos e idempotencia con MCP',async()=>{
  const {postAudio,getAudioList,getAudio}=await import('../src/lib/api/audio-http.ts');
  const {randomUUID,createHash}=await import('node:crypto');
  await database(async(_db,sql)=>{
    await fixture(sql);globalThis.__sql=sql;globalThis.__dbReady=Promise.resolve();
    try {
      const key='tkz_synthetic_audio_http';
      await sql`insert into api_keys(id,name,prefix,key_hash) values ('http-test-key','Prueba HTTP','tkz_synthetic',${createHash('sha256').update(key).digest('hex')})`;
      const wave=Buffer.alloc(32044);wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);
      wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);
      wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(32000,40);
      const input={session_id:randomUUID(),request_id:randomUUID(),consentimiento_conservacion:true,audio_base64:wave.toString('base64'),source:'webrtc_microphone',risk_percent:90,simulated:true};
      const headers={'X-API-Key':key,'X-Tiskz-Org':'org','Content-Type':'application/json'};
      const upload=(h=headers)=>new Request('https://panel.test/api/v1/audio-fragments',{method:'POST',headers:h,body:JSON.stringify(input)});
      assert.equal((await postAudio(upload({}))).status,401);
      assert.equal((await postAudio(upload({'X-API-Key':key}))).status,400);
      const response=await postAudio(upload());assert.equal(response.status,201);assert.equal(response.headers.get('Cache-Control'),'no-store');
      const saved=(await response.json()).data;
      const duplicate=(await (await postAudio(upload())).json()).data;assert.equal(duplicate.id,saved.id);
      const list=await getAudioList(new Request('https://panel.test/api/v1/audio-fragments?session_id='+input.session_id,{headers}));
      const rows=(await list.json()).data;assert.equal(rows.length,1);assert.ok(!('audio' in rows[0]));
      const request=(h=headers)=>new Request('https://panel.test/api/v1/audio-fragments/'+saved.id+'?session_id='+input.session_id,{headers:h});
      const ctx={params:Promise.resolve({id:saved.id})};
      const audio=await getAudio(request(),ctx);assert.equal(audio.status,200);assert.equal(audio.headers.get('Content-Type'),'audio/wav');
      assert.deepEqual(Buffer.from(await audio.arrayBuffer()),wave);
      assert.equal((await getAudio(request({...headers,'X-Tiskz-Org':'other'}),ctx)).status,404);
      await sql`update incidents set consent_snapshot='{"voice_storage":false}' where id=${saved.incident_id}`;
      assert.equal((await getAudio(request(),ctx)).status,404);
      assert.equal((await postAudio(upload())).status,403);
    } finally {delete globalThis.__sql;delete globalThis.__dbReady;}
  });
});

const networkInput = {
  client_call_id: 'android-test',
  conference_request_id: '30000000-0000-4000-8000-000000000001',
  vapi_call_id: '40000000-0000-4000-8000-000000000001',
  route: 'android_sim_conference',
};
async function networkFixture(sql) {
  await fixture(sql);
  await sql`update incidents set client_call_id='android-test',provider_call_id='carrier-existing',caller_e164='+51900000001',
    consent_snapshot=consent_snapshot || '{"network_metadata_storage":true}'::jsonb,
    analysis_meta='{"model":"existing-model"}' where id='a'`;
}

test('vincula llamadas con IDs explícitos, reintentos idempotentes y sin confundir el número original', async () => {
  await database(async (_db,sql) => {
    await networkFixture(sql);
    await assert.rejects(bindNetworkOrigin('other','a',networkInput,'service',sql),e=>e.status===404);
    await assert.rejects(bindNetworkOrigin('org','b',networkInput,'service',sql),e=>e.status===403);
    await assert.rejects(bindNetworkOrigin('org','a',{...networkInput,client_call_id:'wrong'},'service',sql),e=>e.code==='call_correlation_mismatch');
    const origin=await bindNetworkOrigin('org','a',networkInput,'service',sql);
    assert.deepEqual(await bindNetworkOrigin('org','a',networkInput,'service',sql),origin);
    assert.equal((await sql`select count(*)::int n from actions where kind='network_origin_binding'`)[0].n,1);
    await assert.rejects(bindNetworkOrigin('org','a',{...networkInput,vapi_call_id:'40000000-0000-4000-8000-000000000002'},'service',sql),e=>e.code==='binding_conflict');
    await sql`update incidents set client_call_id='android-other',consent_snapshot=consent_snapshot || '{"network_metadata_storage":true}'::jsonb where id='b'`;
    await assert.rejects(bindNetworkOrigin('org','b',{...networkInput,client_call_id:'android-other'},'service',sql),e=>e.code==='call_already_bound');
    const call=async()=>({id:networkInput.vapi_call_id,phoneCallTransport:'sip',phoneCallProvider:'twilio',customer:{number:'+51900000002'},messages:['contenido que no se conserva'],ip:'203.0.113.10',metadata:{callerIp:'203.0.113.11'}});
    const checked=await inspectNetworkOrigin('org','a','service',sql,call);
    assert.equal(checked.inspection.availability,'unavailable');
    assert.equal(checked.inspection.endpoint_ip,null);
    assert.equal(checked.inspection.call.customer.number,'+51900000002');
    assert.equal('ip' in checked.inspection.call,false);
    assert.equal('messages' in checked.inspection.call,false);
    const [incident]=await sql`select * from incidents where id='a'`;
    assert.equal(incident.caller_e164,'+51900000001');
    assert.equal(incident.provider_call_id,'carrier-existing');
    assert.equal(incident.analysis_meta.model,'existing-model');
    assert.equal(JSON.stringify(incident.analysis_meta).includes('203.0.113.'),false);
    assert.equal((await sql`select count(*)::int n from actions where kind='network_origin_check'`)[0].n,1);
    assert.deepEqual(await getNetworkOrigin('org','a',sql),checked);
  });
});

test('revalida autorización tras consultar Vapi y conserva el resultado anterior ante fallos', async () => {
  await database(async (_db,sql) => {
    await networkFixture(sql);
    await bindNetworkOrigin('org','a',networkInput,'service',sql);
    await assert.rejects(inspectNetworkOrigin('org','a','service',sql,async()=>({id:'40000000-0000-4000-8000-000000000002'})),e=>e.code==='vapi_invalid_response');
    await assert.rejects(inspectNetworkOrigin('org','a','service',sql,async()=>{throw Error('fallo controlado');}));
    assert.equal((await getNetworkOrigin('org','a',sql)).inspection,null);
    const checked=await inspectNetworkOrigin('org','a','service',sql,async()=>({id:networkInput.vapi_call_id}));
    await assert.rejects(inspectNetworkOrigin('org','a','service',sql,async()=>{throw Error('fallo controlado');}));
    assert.deepEqual(await getNetworkOrigin('org','a',sql),checked);
    await assert.rejects(inspectNetworkOrigin('org','a','service',sql,async()=>{
      await sql`update incidents set consent_snapshot=consent_snapshot || '{"network_metadata_storage":false}'::jsonb where id='a'`;
      return {id:networkInput.vapi_call_id};
    }),e=>e.status===403);
    await assert.rejects(getNetworkOrigin('org','a',sql),e=>e.status===403);
    assert.equal((await sql`select count(*)::int n from actions where kind='network_origin_check'`)[0].n,1);
  });
});

test('el adaptador Vapi limita origen, datos, respuesta y errores; nunca fabrica una IP', async () => {
  const id=networkInput.vapi_call_id;
  let requested=0;
  const fetcher=async(url,options)=>{
    requested++;
    assert.equal(url,`https://api.vapi.ai/call/${id}`);
    assert.equal(options.redirect,'error'); assert.equal(options.cache,'no-store');
    return Response.json({id,phoneCallTransport:'sip',customer:{number:'+51900000002',name:'no guardar'},ip:'203.0.113.1',messages:['no guardar'],monitor:{controlUrl:'no guardar'}});
  };
  await assert.rejects(getVapiCall(id,{apiKey:'',fetcher}),e=>e.code==='vapi_not_configured');
  assert.equal(requested,0);
  await assert.rejects(getVapiCall('https://untrusted.example',{apiKey:'test-key',fetcher}));
  assert.equal(requested,0);
  assert.deepEqual(await getVapiCall(id,{apiKey:'test-key',fetcher}),{id,phoneCallTransport:'sip',customer:{number:'+51900000002'}});
  for (const status of [401,404,429,500]) await assert.rejects(getVapiCall(id,{apiKey:'test-key',fetcher:async()=>new Response('cuerpo privado',{status})}),e=>e.status===502 && !e.message.includes('privado'));
  await assert.rejects(getVapiCall(id,{apiKey:'test-key',fetcher:async()=>Response.json({id:'40000000-0000-4000-8000-000000000002'})}),e=>e.code==='vapi_invalid_response');
  await assert.rejects(getVapiCall(id,{apiKey:'test-key',fetcher:async()=>new Response('x'.repeat(1024*1024+1))}),e=>e.code==='vapi_invalid_response');
});

test('la API de análisis no falsifica ni borra la procedencia técnica con una actualización', async () => {
  await database(async (_db,sql) => {
    await networkFixture(sql);
    globalThis.__sql=sql; globalThis.__dbReady=Promise.resolve();
    try {
      const def=getResource('incidents');
      assert.equal(def.create.safeParse({analysis_meta:{network_origin:{endpoint_ip:'203.0.113.1'}}}).success,false);
      assert.equal(def.update.safeParse({analysis_meta:{network_origin:null}}).success,false);
      await bindNetworkOrigin('org','a',networkInput,'service',sql);
      const before=await getNetworkOrigin('org','a',sql);
      const row=await updateRow(def,'a',{analysis_meta:{model:'new-model'},summary:'Resumen nuevo'});
      assert.equal(row.analysis_meta.model,'new-model');
      assert.deepEqual(row.analysis_meta.network_origin,before);
      await assert.rejects(updateRow(def,'a',{client_call_id:'other'}),e=>e.code==='binding_conflict');
      const [action]=await sql`select id from actions where kind='network_origin_binding'`;
      await assert.rejects(deleteRow(getResource('actions'),action.id),e=>e.code==='immutable_review');
      await assert.rejects(updateRow(getResource('actions'),action.id,{detail:'reemplazo'}),e=>e.code==='immutable_review');
      const api=buildOpenApi('http://localhost:3000');
      assert.ok(api.paths['/incidents/{id}/network-origin'].put);
      assert.ok(api.components.schemas.NetworkBinding.properties.vapi_call_id);
    } finally {delete globalThis.__sql;delete globalThis.__dbReady;}
  });
});

test('HTTP procedencia exige clave, organización y permiso y no permite cachear el resultado', async () => {
  const {getOrigin,putOrigin,postOrigin}=await import('../src/lib/api/network-origin-http.ts');
  const {createHash}=await import('node:crypto');
  await database(async (_db,sql) => {
    await networkFixture(sql);
    globalThis.__sql=sql; globalThis.__dbReady=Promise.resolve();
    try {
      const key='tkz_synthetic_network_http';
      await sql`insert into api_keys(id,name,prefix,key_hash) values ('network-key','Prueba red','tkz_synthetic',${createHash('sha256').update(key).digest('hex')})`;
      const headers={'Authorization':`Bearer ${key}`,'X-Tiskz-Org':'org','Content-Type':'application/json'};
      const request=(method='GET',h=headers)=>new Request('https://panel.test/api/v1/incidents/a/network-origin',{
        method,headers:h,...(method==='PUT'?{body:JSON.stringify(networkInput)}:{}),
      });
      const ctx={params:Promise.resolve({id:'a'})};
      const denied=await getOrigin(request('GET',{}),ctx);
      assert.equal(denied.status,401);assert.equal(denied.headers.get('Cache-Control'),'no-store');
      assert.equal((await getOrigin(request('GET',{Authorization:`Bearer ${key}`}),ctx)).status,400);
      assert.equal((await getOrigin(request('GET',{...headers,'X-Tiskz-Org':'other'}),ctx)).status,404);
      assert.equal((await (await getOrigin(request(),ctx)).json()).data,null);
      assert.equal((await postOrigin(request('POST'),ctx)).status,409);
      const bound=await putOrigin(request('PUT'),ctx);
      assert.equal(bound.status,200);assert.equal(bound.headers.get('Cache-Control'),'no-store');
      assert.equal((await bound.json()).data.binding.vapi_call_id,networkInput.vapi_call_id);
      const stored=await getOrigin(request(),ctx);
      assert.equal((await stored.json()).data.inspection,null);
      await sql`update incidents set sharing_revoked_at=now() where id='a'`;
      assert.equal((await getOrigin(request(),ctx)).status,403);
    } finally {delete globalThis.__sql;delete globalThis.__dbReady;}
  });
});

const groupCase = (id, overrides={}) => ({id,org_id:'org',simulated:false,sharing_revoked_at:null,...overrides});
const groupLink = (id,a,b,status='pendiente') => ({id,incident_a:a,incident_b:b,status});

test('agrupa N casos conectados sin inventar relaciones directas ni una certeza para todo el grupo',()=>{
  const cases=['a','b','c','d'].map(id=>groupCase(id));
  const links=[groupLink('ab','a','b','confirmado'),groupLink('bc','b','c'),groupLink('cd','c','d')];
  for(const link of links) Object.freeze(link);
  Object.freeze(links);
  const [group]=buildLinkGroups(cases,links);
  assert.deepEqual(group.incidentIds,['a','b','c','d']);
  assert.deepEqual(group.links.map(link=>link.id),['ab','bc','cd']);
  assert.equal(group.confirmedCount,1);assert.equal(group.pendingCount,2);
  assert.equal('score' in group,false);
  assert.equal(group.links.some(link=>link.incident_a==='a'&&link.incident_b==='c'),false);
  assert.equal(group.links[0],links[0]);
});

test('descartar una conexión puente divide la red y los aislados no forman grupos',()=>{
  const cases=['a','b','c','d','isolated'].map(id=>groupCase(id));
  const links=[groupLink('ab','a','b'),groupLink('bc','b','c','descartado'),groupLink('cd','c','d')];
  assert.deepEqual(buildLinkGroups(cases,links).map(group=>group.incidentIds),[['a','b'],['c','d']]);
  assert.deepEqual(buildLinkGroups(cases,[]),[]);
});

test('los grupos no mezclan organizaciones, datos de demo, origen desconocido ni casos revocados',()=>{
  const cases=[groupCase('a'),groupCase('b'),groupCase('demo',{simulated:true}),groupCase('unknown',{simulated:null}),
    groupCase('other',{org_id:'other'}),groupCase('private',{org_id:null}),groupCase('revoked',{sharing_revoked_at:'2026-10-17T12:00:00Z'})];
  const links=[groupLink('ab','a','b'),...['demo','unknown','other','private','revoked','missing'].map(id=>groupLink(id,'a',id))];
  assert.deepEqual(buildLinkGroups(cases,links).map(group=>group.incidentIds),[['a','b']]);
});

test('una red cíclica o entradas repetidas no duplican miembros ni conexiones',()=>{
  const cases=['c','b','a'].map(id=>groupCase(id));
  const links=[groupLink('ab','a','b'),groupLink('bc','b','c'),groupLink('ca','c','a'),groupLink('ab','a','b'),groupLink('self','a','a')];
  const [group]=buildLinkGroups(cases,links);
  assert.deepEqual(group.incidentIds,['a','b','c']);
  assert.equal(group.links.length,3);
  assert.equal(group.anchor,'grupo-a');
});

test('el detalle muestra el grupo completo con casos indirectos y conserva las revisiones existentes',async()=>{
  await database(async(_db,sql)=>{
    await fixture(sql);
    await sql`insert into incidents(id,org_id,simulated,title) values ('c','org',false,'Tercer caso')`;
    await sql`insert into entities(id,incident_id,kind,value,normalized) values
      ('ga','a','cuenta','111','111'),('gb','b','cuenta','111','111'),
      ('gb2','b','telefono','222','222'),('gc','c','telefono','222','222')`;
    await refreshLinksFor('a',sql);await refreshLinksFor('c',sql);
    const [ab]=await sql`update links set status='confirmado',reviewed_by_id='analyst',reviewed_by='Analista' where incident_a='a' and incident_b='b' returning *`;
    globalThis.__sql=sql;globalThis.__dbReady=Promise.resolve();
    try {
      const session={userId:'analyst',name:'Analista',role:'analista',orgId:'org'};
      const detail=await getIncidentDetail('a',session);
      assert.deepEqual(detail.relatedGroup.incidentIds,['a','b','c']);
      assert.equal(detail.relatedGroup.links.length,2);
      assert.deepEqual(detail.relatedCases.map(item=>[item.id,item.direct]),[['b',true],['c',false]]);
      assert.equal(detail.links.length,1);
      assert.equal(detail.relatedGroup.confirmedCount,1);assert.equal(detail.relatedGroup.pendingCount,1);
      assert.deepEqual(await navCounts('org'),{cases:3,links:2,groups:1});
      const dashboard=await dashboardData('org');
      assert.equal(dashboard.kpis.groups,1);assert.equal(dashboard.kpis.links,2);
      const [after]=await sql`select * from links where id=${ab.id}`;
      assert.deepEqual(after.reviewed_evidence,ab.reviewed_evidence);assert.equal(after.evidence_version,ab.evidence_version);
      await sql`update links set status='descartado',reviewed_by_id='analyst' where incident_a='b' and incident_b='c'`;
      const split=await getIncidentDetail('a',session);
      assert.deepEqual(split.relatedGroup.incidentIds,['a','b']);
      assert.deepEqual(split.relatedCases.map(item=>item.id),['b']);
      assert.equal((await getIncidentDetail('c',session)).relatedGroup,null);
      assert.equal(await getIncidentDetail('a',{...session,orgId:'other'}),null);
    } finally {delete globalThis.__sql;delete globalThis.__dbReady;}
  });
});

test('llamadas: guarda la conversación, reemplaza al reenviar, aísla organizaciones y exige clave', async () => {
  const {listCallsHandler,getCallHandler,putCallHandler,getIncidentTranscriptHandler}=await import('../src/lib/api/calls-http.ts');
  const {createHash}=await import('node:crypto');
  await database(async (_db,sql) => {
    await fixture(sql);
    globalThis.__sql=sql; globalThis.__dbReady=Promise.resolve();
    try {
      const key='tkz_synthetic_calls_http';
      await sql`insert into api_keys(id,name,prefix,key_hash) values ('calls-key','Prueba llamadas','tkz_synthetic',${createHash('sha256').update(key).digest('hex')})`;
      const headers={'Authorization':`Bearer ${key}`,'X-Tiskz-Org':'org','Content-Type':'application/json'};
      const call={
        caller_number_raw:'946189585',caller_e164:'+51946189585',direction:'incoming',call_status:'ended',
        started_at:'2026-10-17T20:00:00.000Z',answered_at:'2026-10-17T20:00:05.000Z',ended_at:'2026-10-17T20:02:00.000Z',
        talk_duration_s:115,screened:true,verdict:'scam',risk_score:86,risk_reasons:['Pide código de verificación'],
        scam_type:'Suplantación bancaria',impersonating:'BCP',
        transcript:[
          {id:'l1',speaker:'agent',text:'Hola, soy el asistente de esta línea. ¿Quién llama?'},
          {id:'l2',speaker:'caller',text:'Le llamo del BCP, necesito el código que le llegó.',flagged:true},
          {id:'l3',speaker:'user',text:'No voy a dar ningún código.'},
        ],
      };
      const ctx={params:Promise.resolve({callId:'android-call-1'})};
      const put=(body,h=headers)=>putCallHandler(new Request('https://panel.test/api/v1/calls/android-call-1',{method:'PUT',headers:h,body:JSON.stringify(body)}),ctx);
      assert.equal((await put(call,{'Content-Type':'application/json'})).status,401);
      assert.equal((await put(call,{...headers,'X-Tiskz-Org':''})).status,400);
      assert.equal((await put({...call,transcript:[{id:'x',speaker:'robot',text:'?'}]})).status,422);
      const created=await put(call);
      assert.equal(created.status,201);assert.equal(created.headers.get('Cache-Control'),'no-store');
      const saved=(await created.json()).data;
      assert.equal(saved.transcript_lines,3);
      const [incident]=await sql`select * from incidents where id=${saved.incident_id}`;
      assert.equal(incident.org_id,'org');assert.equal(incident.risk_level,'alto');assert.equal(incident.title,'Llamada de +51946189585');
      assert.equal(incident.consent_snapshot.transcript_storage,true);assert.equal(incident.analysis_meta.screened_by_assistant,true);
      // Reenviar la misma llamada actualiza y reemplaza la conversación: no duplica.
      const again=await put({...call,transcript:call.transcript.slice(0,2),verdict:'suspicious',risk_score:50});
      assert.equal(again.status,200);
      assert.equal((await sql`select count(*)::int n from incidents where client_call_id='android-call-1'`)[0].n,1);
      const read=await (await getCallHandler(new Request('https://panel.test/api/v1/calls/android-call-1',{headers}),ctx)).json();
      assert.deepEqual(read.data.transcript.map(l=>[l.speaker,l.flagged]),[['agent',false],['caller',true]]);
      assert.equal(read.data.incident.verdict,'suspicious');
      // Otra organización no ve la llamada.
      assert.equal((await getCallHandler(new Request('https://panel.test/api/v1/calls/android-call-1',{headers:{...headers,'X-Tiskz-Org':'other'}}),ctx)).status,404);
      const list=await (await listCallsHandler(new Request('https://panel.test/api/v1/calls?limit=10',{headers}),{})).json();
      assert.equal(list.pagination.total,1);assert.equal(list.data[0].transcript_lines,2);
      const lines=await (await getIncidentTranscriptHandler(new Request(`https://panel.test/api/v1/incidents/${saved.incident_id}/transcript`,{headers}),{params:Promise.resolve({id:saved.incident_id})})).json();
      assert.equal(lines.data.length,2);
      // El panel muestra la conversación en el detalle del caso.
      const detail=await getIncidentDetail(saved.incident_id,{role:'analista',orgId:'org',userId:'analyst'});
      assert.equal(detail.transcript[0].text,call.transcript[0].text);
      // Si la persona revoca la compartición, no se reescribe ni se lee.
      await sql`update incidents set sharing_revoked_at=now() where id=${saved.incident_id}`;
      assert.equal((await put(call)).status,403);
      assert.equal((await getCallHandler(new Request('https://panel.test/api/v1/calls/android-call-1',{headers}),ctx)).status,404);
      assert.ok(buildOpenApi('https://panel.test').paths['/calls/{callId}'].put);
    } finally {delete globalThis.__sql;delete globalThis.__dbReady;}
  });
});

test('llamadas: extrae evidencia peruana, la recalcula sin duplicar y alimenta la reputación del número', async () => {
  const {putCallHandler,getReputationHandler}=await import('../src/lib/api/calls-http.ts');
  const {createHash}=await import('node:crypto');
  await database(async (_db,sql) => {
    await fixture(sql);
    globalThis.__sql=sql; globalThis.__dbReady=Promise.resolve();
    try {
      const key='tkz_synthetic_reputation';
      await sql`insert into api_keys(id,name,prefix,key_hash) values ('rep-key','Prueba reputación','tkz_synthetic',${createHash('sha256').update(key).digest('hex')})`;
      const headers={'Authorization':`Bearer ${key}`,'X-Tiskz-Org':'org','Content-Type':'application/json'};
      const call=(over={})=>({caller_e164:'+51946189585',started_at:'2026-10-17T20:00:00Z',ended_at:'2026-10-17T20:02:00Z',verdict:'scam',risk_score:90,
        scam_type:'Suplantación bancaria',impersonating:'BCP',transcript:[
          {id:'a',speaker:'agent',text:'¿Quién llama y cuál es el motivo?'},
          {id:'b',speaker:'caller',text:'¡Hola tío! Le hablo del BCP, del área de seguridad.'},
          {id:'c',speaker:'caller',text:'Para anular la compra dígame el código que le llegó por SMS y yapee S/ 500 al 987 654 321.'},
          {id:'d',speaker:'user',text:'No le daré ningún código.'},
        ],...over});
      const put=(id,body,org='org')=>putCallHandler(new Request(`https://panel.test/api/v1/calls/${id}`,{method:'PUT',headers:{...headers,'X-Tiskz-Org':org},body:JSON.stringify(body)}),{params:Promise.resolve({callId:id})});
      const saved=(await (await put('peru-1',call())).json()).data;
      const types=(await sql`select type from signals where incident_id=${saved.incident_id} order by type`).map(r=>r.type);
      for (const t of ['datos_sensibles','dinero','familiaridad','suplantacion']) assert.ok(types.includes(t),`falta ${t}: ${types}`);
      const ents=await sql`select kind,normalized,provenance from entities where incident_id=${saved.incident_id}`;
      assert.ok(ents.some(e=>e.kind==='telefono'&&e.normalized==='987654321'&&e.provenance==='mencionado'));
      assert.ok(ents.some(e=>e.kind==='telefono'&&e.normalized==='946189585'&&e.provenance==='mostrado'));
      assert.ok(ents.some(e=>e.kind==='monto'&&e.normalized==='500'));
      assert.ok(ents.some(e=>e.kind==='organizacion'&&e.normalized==='bcp'));
      // Reenviar no duplica la evidencia derivada.
      await put('peru-1',call());
      assert.equal((await sql`select count(*)::int n from signals where incident_id=${saved.incident_id}`)[0].n,types.length);
      // Otra víctima de otra organización con el mismo número: la reputación suma ambas, sin datos personales.
      await put('peru-2',call({caller_e164:null,caller_number_raw:'946 189 585',verdict:'suspicious',risk_score:55}),'other');
      await put('demo',call({simulated:true}));
      const rep=async(n)=>(await (await getReputationHandler(new Request(`https://panel.test/api/v1/reputation/${n}`,{headers}),{params:Promise.resolve({number:n})})).json()).data;
      const r=await rep('+51946189585');
      assert.equal(r.reports,2);assert.equal(r.scam,1);assert.equal(r.suspicious,1);assert.equal(r.impersonating,'BCP');
      assert.deepEqual(Object.keys(r).sort(),['impersonating','last_reported_at','mentioned_in','number_key','reports','scam','scam_type','suspicious']);
      assert.equal((await rep('987654321')).mentioned_in,2);
      assert.equal((await rep('900000000')).reports,0);
    } finally {delete globalThis.__sql;delete globalThis.__dbReady;}
  });
});

test('vincula llamadas del mismo número de origen o con el número mencionado en otra, nunca números ocultos', async () => {
  await database(async (_db,sql) => {
    await fixture(sql);
    await sql`update incidents set caller_e164='+51946189585' where id='a'`;
    await sql`update incidents set caller_number_raw='946 189 585' where id='b'`;
    await sql`insert into incidents(id,org_id,simulated,caller_e164) values ('c','org',false,'+51999111222'),('d','org',false,null),('e','org',false,null)`;
    await sql`insert into entities(id,incident_id,kind,value,normalized) values ('ec','c','telefono','946189585','946189585')`;
    await refreshLinksFor('a',sql);
    const links=await sql`select incident_a,incident_b,reasons from links order by incident_b`;
    assert.deepEqual(links.map((l)=>[l.incident_a,l.incident_b]),[['a','b'],['a','c']]);
    assert.match(links[0].reasons[0].detail,/Mismo número de origen: \+51946189585/);
    assert.match(links[1].reasons[0].detail,/llamó en un caso y se mencionó en el otro/);
    assert.equal(links[0].reasons.filter((r)=>r.kind==='dato_compartido').length,1);
    await refreshLinksFor('d',sql);
    assert.equal((await sql`select count(*)::int n from links where 'd' in (incident_a,incident_b)`)[0].n,0);
  });
});

test('registro de presuntos estafadores: alias único por organización, casos propios y bitácora', async () => {
  await database(async (_db,sql) => {
    await fixture(sql);
    await sql`insert into incidents(id,org_id,simulated) values ('x','other',false)`;
    globalThis.__sql=sql;
    globalThis.__dbReady=Promise.resolve();
    try {
      const session={userId:'analyst',name:'Analista',role:'analista',orgId:'org'};
      const id=await createSuspect(session,{alias:'  Falso abogado  Ramírez ',notes:'Mismo número',incidentIds:['a','b']});
      const [suspect]=await sql`select alias,created_by from suspects where id=${id}`;
      assert.equal(suspect.alias,'Falso abogado Ramírez');
      assert.equal(suspect.created_by,'Analista');
      assert.deepEqual((await sql`select id from incidents where suspect_id=${id} order by id`).map((r)=>r.id),['a','b']);
      assert.equal((await sql`select count(*)::int n from actions where kind='suspect_assignment'`)[0].n,2);
      await assert.rejects(createSuspect(session,{alias:'falso ABOGADO ramírez',incidentIds:['a']}),SuspectError);
      await assert.rejects(createSuspect(session,{alias:'Otro',incidentIds:['x']}),/no pertenece/);
      await assert.rejects(createSuspect(session,{alias:'',incidentIds:['a']}),SuspectError);
      // La base impide asociar un caso a un registro de otra organización, aunque llegue por la API.
      await sql`insert into suspects(id,org_id,alias) values ('ajeno','other','Ajeno')`;
      await assert.rejects(updateRow(getResource('incidents'),'a',{suspect_id:'ajeno'}),(e)=>e.status===422||e.code==='23514');
      await unassignCase(session,'b');
      assert.equal((await sql`select suspect_id from incidents where id='b'`)[0].suspect_id,null);
      const api=await createRows(getResource('suspects'),{org_id:'org',alias:'Banda del SAT'});
      await updateRow(getResource('incidents'),'b',{suspect_id:api.data.id});
      const listed=await listSuspects('org');
      assert.deepEqual(listed.map((s)=>[s.alias,s.case_count]).sort(),[['Banda del SAT',1],['Falso abogado Ramírez',1]]);
      assert.equal((await listSuspects('other'))[0].alias,'Ajeno');
    } finally { delete globalThis.__sql; delete globalThis.__dbReady; }
  });
});
