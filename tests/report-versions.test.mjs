import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import postgres from 'postgres';
import {applyMigrations} from '../scripts/migration-runner.mjs';
import {createReportVersion,getReportVersion,listLatestReportVersions,ReportVersionError} from '../src/lib/reports/versions.ts';

async function database(run) {
  const database=await PGlite.create({extensions:{vector}});
  const server=new PGLiteSocketServer({db:database,host:'127.0.0.1',port:0});
  await server.start();
  const sql=postgres({host:'127.0.0.1',port:Number(server.getServerConn().split(':').at(-1)),
    username:'postgres',database:'postgres',prepare:false,max:1,onnotice:()=>{},
    types:{isoDate:{to:1184,from:[1082,1114,1184],serialize:value=>value instanceof Date?value.toISOString():value,
      parse:value=>new Date(value.replace(' ','T').replace(/([+-]\d\d)$/,'$1:00')).toISOString()}},
  });
  try {await applyMigrations(sql);await run(sql);}
  finally {await sql.end();await server.stop();await database.close();}
}

async function fixture(sql) {
  await sql`insert into organizations(id,name) values ('org','Equipo de prueba'),('other','Otra entidad')`;
  await sql`insert into users(id,name,role,org_id) values ('analyst','Analista','analista','org'),('other-analyst','Otra','analista','other')`;
  const meta={report_generation:{provider:'maritime',status:'completed',model_id:'maritime-test',prompt_version:'pe-report-v1',limitations:['Solo hay indicios.']}};
  const consent={report_storage:true,report_sharing:true};
  await sql`insert into incidents(id,org_id,title,status,simulated,summary,analysis_meta,consent_snapshot)
    values ('a','org','Primer caso','finalizado',true,'Se solicita transferir dinero.',${sql.json(meta)},${sql.json(consent)}),
      ('b','org','Segundo caso','finalizado',true,'Se repite una petición de dinero.',${sql.json(meta)},${sql.json(consent)})`;
  await sql`insert into signals(id,incident_id,type,evidence,explanation,confidence,source)
    values ('signal-a','a','urgencia','','Presión para transferir.',0.8,'maritime')`;
  await sql`insert into entities(id,incident_id,kind,value,normalized,provenance)
    values ('entity-a','a','cuenta','1234567890','1234567890','mencionado')`;
  await sql`insert into links(id,incident_a,incident_b,score,reasons,evidence_snapshot)
    values ('ab','a','b',0.8,'[{"kind":"dato_compartido","detail":"Cuenta repetida"}]','{"ai_explanation":{"status":"completed","behavior_similarity":"similar"}}')`;
}

const input={orgId:'org',analystId:'analyst',caseIds:['a','b'],linkIds:['ab'],title:'Informe de prueba'};
function stable(value) {
  if(Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if(value!==null&&typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

test('versiones conservan selección, hallazgos y revisión anteriores aunque cambien las fuentes',async()=>{
  await database(async sql=>{
    await fixture(sql);
    const first=await createReportVersion(input,sql);
    assert.equal(first.version,1);
    assert.deepEqual(first.snapshot.selected_case_ids,['a','b']);
    assert.deepEqual(first.snapshot.selected_link_ids,['ab']);
    assert.equal(first.snapshot.cases[0].signals[0].explanation,'Presión para transferir.');
    assert.equal(first.snapshot.cases[0].entities[0].value,'1234567890');
    assert.equal(first.snapshot.links[0].evidence_snapshot.ai_explanation.behavior_similarity,'similar');
    assert.equal(first.content_sha256,crypto.createHash('sha256').update(stable({title:first.title,summary:first.summary,snapshot:first.snapshot})).digest('hex'));
    await sql`update incidents set summary='Resumen corregido.' where id='a'`;
    await sql`update links set status='confirmado',reviewed_by='Analista',reviewed_by_id='analyst',
      note='Coincidencia verificada en los resúmenes.' where id='ab'`;
    const second=await createReportVersion({...input,seriesId:first.series_id},sql);
    assert.equal(second.version,2);
    assert.equal(second.snapshot.cases[0].summary,'Resumen corregido.');
    assert.equal(second.snapshot.links[0].status,'confirmado');
    assert.equal(second.snapshot.links[0].note,'Coincidencia verificada en los resúmenes.');
    assert.equal(second.snapshot.links[0].reviewed_evidence_version,second.snapshot.links[0].evidence_version);
    const historical=await getReportVersion('org',first.id,sql);
    assert.equal(historical.snapshot.cases[0].summary,'Se solicita transferir dinero.');
    assert.equal(historical.snapshot.links[0].status,'pendiente');
    assert.equal((await listLatestReportVersions('org',sql))[0].id,second.id);
    await assert.rejects(sql`update report_versions set title='Manipulado' where id=${first.id}`,error=>error.code==='P0001');
  });
});

test('rechaza selección sin vínculo, analista ajeno y permisos retirados; oculta versiones retiradas',async()=>{
  await database(async sql=>{
    await fixture(sql);
    await assert.rejects(createReportVersion({...input,linkIds:[]},sql),error=>error instanceof ReportVersionError&&error.code==='invalid_selection');
    await assert.rejects(createReportVersion({...input,analystId:'other-analyst'},sql),error=>error instanceof ReportVersionError&&error.code==='forbidden');
    const saved=await createReportVersion(input,sql);
    await sql`update incidents set sharing_revoked_at=now() where id='b'`;
    assert.equal(await getReportVersion('org',saved.id,sql),null);
    assert.deepEqual(await listLatestReportVersions('org',sql),[]);
    await assert.rejects(createReportVersion({...input,seriesId:saved.series_id},sql),error=>error instanceof ReportVersionError&&error.code==='cases_unavailable');
  });
});

test('el informe incluye el conjunto identificado completo, sin omitir casos ni vínculos',async()=>{
  await database(async sql=>{
    await fixture(sql);
    await sql`insert into incidents(id,org_id,title,status,simulated,summary,analysis_meta,consent_snapshot)
      select 'c',org_id,'Tercer caso',status,simulated,'Otra solicitud de dinero.',analysis_meta,consent_snapshot
      from incidents where id='a'`;
    await sql`insert into links(id,incident_a,incident_b,score,reasons)
      values ('bc','b','c',0.7,'[{"kind":"dato_compartido","detail":"Cuenta repetida"}]')`;
    await assert.rejects(createReportVersion(input,sql),
      error=>error instanceof ReportVersionError&&error.code==='incomplete_group');
    await sql`insert into links(id,incident_a,incident_b,score,reasons)
      values ('ac','a','c',0.6,'[{"kind":"dato_compartido","detail":"Otro dato repetido"}]')`;
    await assert.rejects(createReportVersion({...input,caseIds:['a','b','c'],linkIds:['ab','bc']},sql),
      error=>error instanceof ReportVersionError&&error.code==='incomplete_group');
    const complete=await createReportVersion({...input,caseIds:['a','b','c'],linkIds:['ab','bc','ac']},sql);
    assert.deepEqual(complete.snapshot.selected_case_ids,['a','b','c']);
    assert.deepEqual(complete.snapshot.selected_link_ids,['ab','ac','bc']);
  });
});
