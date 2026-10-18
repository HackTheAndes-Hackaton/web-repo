import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import postgres from 'postgres';
import pdfLib from '../src/lib/reports/vendor/pdf-lib.cjs';
import {applyMigrations} from '../scripts/migration-runner.mjs';
import {finalizeCase} from '../src/lib/api/case-finalizations.ts';
import {refreshLinksFor} from '../src/lib/links.ts';
import {explainPendingLink} from '../src/lib/api/link-explanations.ts';
import {validateReport,reportSegments} from '../src/lib/reports/maritime.mjs';
import {createReportVersion,getReportVersion,listLatestReportVersions} from '../src/lib/reports/versions.ts';
import {renderReportPdf} from '../src/lib/reports/pdf.mjs';

test('flujo ficticio: cierres, vínculo, informe, PDF solicitado y revocación',async()=>{
  const db=await PGlite.create({extensions:{vector}});
  const server=new PGLiteSocketServer({db,host:'127.0.0.1',port:0});
  await server.start();
  const sql=postgres({host:'127.0.0.1',port:Number(server.getServerConn().split(':').at(-1)),
    username:'postgres',database:'postgres',prepare:false,max:1,onnotice:()=>{},
    types:{isoDate:{to:1184,from:[1082,1114,1184],serialize:value=>value instanceof Date?value.toISOString():value,
      parse:value=>new Date(value.replace(' ','T').replace(/([+-]\d\d)$/,'$1:00')).toISOString()}}});
  try {
    await applyMigrations(sql);
    await sql`insert into organizations(id,name) values ('org','Equipo ficticio Perú')`;
    await sql`insert into users(id,name,role,org_id) values ('analyst','Analista de prueba','analista','org')`;
    let modelCalls=0;
    const generate=async text=>{
      modelCalls++;
      const segments=reportSegments(text);
      return {...validateReport({summary:modelCalls===1
        ?'Se solicita transferir dinero con urgencia a una cuenta BCP.'
        :'Se insiste en enviar dinero de inmediato a la misma cuenta BCP.',
        recommendation:'Verificar el pedido por un canal independiente.',modality:'Solicitud de transferencia',
        limitations:['La cuenta mencionada no identifica a una persona.'],
        signals:[{type:'dinero',explanation:'Se solicita transferir dinero.',segment_id:'s0'}],
        entities:[{kind:'cuenta',value:'191-1234567-0-01',segment_id:'s0',bank:'BCP',wallet:null,currency:null}]},segments),
        generation:{provider:'maritime',prompt_version:'pe-report-v1',model_id:'modelo-ficticio',usage:{total_tokens:20}}};
    };
    const start=performance.now();
    const cases=[];
    for(let index=0;index<2;index++) {
      const value={request_id:randomUUID(),session_id:`simulada-${index}`,simulated:true,
        started_at:'2026-10-18T15:00:00Z',ended_at:'2026-10-18T15:03:00Z',channel:'webrtc',
        text:`Me piden transferir a la cuenta BCP 191-1234567-0-01. Llamada ficticia ${index}.`,
        decision:{alerta:true,probabilidad:0.8}};
      const result=await finalizeCase('org',value,'prueba',{connection:sql,generate,allowDemo:true});
      assert.equal(result.status,'completed');
      cases.push(result.incident_id);
    }
    await sql`insert into segments(id,incident_id,idx,speaker,text,t_offset,flagged) values
      ('chat-a-1',${cases[0]},0,'caller',
        'Le llamo para solicitar una transferencia urgente a la cuenta BCP 191-1234567-0-01. Este mensaje de prueba es suficientemente largo para comprobar que la tabla del informe distribuya la conversación en varias líneas sin cortar el contenido.',0,true),
      ('chat-a-2',${cases[0]},1,'user','Verificaré el pedido con el banco por un canal independiente.',19,false),
      ('chat-b-1',${cases[1]},0,'caller','Debe enviar el dinero de inmediato a la misma cuenta BCP.',0,true),
      ('chat-b-2',${cases[1]},1,'agent','La llamada es sospechosa. No comparta claves ni transfiera dinero.',24,false)`;
    await refreshLinksFor(cases[1],sql);
    const [link]=await sql`select * from links where incident_a=any(${cases}) and incident_b=any(${cases})`;
    assert.ok(link,'la cuenta BCP repetida debe producir un vínculo');
    let comparisonCalls=0;
    const comparison=await explainPendingLink('org',link.id,{connection:sql,generate:async context=>{
      comparisonCalls++;
      assert.equal(JSON.stringify(context).includes('191-1234567-0-01'),false);
      return {behavior_similarity:'similar',evidence_a:'transferir dinero con urgencia',
        evidence_b:'enviar dinero de inmediato',supporting_reason_indexes:[0],
        limitations:['La similitud no prueba identidad.'],
        generation:{provider:'maritime',prompt_version:'pe-link-v1',model_id:'modelo-ficticio',usage:{total_tokens:12}}};
    }});
    assert.equal(comparison.status,'completed');
    const report=await createReportVersion({orgId:'org',analystId:'analyst',caseIds:cases,
      linkIds:[link.id],title:'Informe ficticio de dos llamadas'},sql);
    assert.equal(report.snapshot.cases.length,2);
    assert.deepEqual(report.snapshot.cases.map(item=>item.transcript.length),[2,2]);
    assert.equal(report.snapshot.links[0].evidence_snapshot.ai_explanation.status,'completed');
    assert.equal((await listLatestReportVersions('org',sql))[0].id,report.id);
    const beforePdf=modelCalls+comparisonCalls;
    const bytes=await renderReportPdf(await getReportVersion('org',report.id,sql));
    if(process.env.TISKZ_PDF_SAMPLE_PATH) await writeFile(process.env.TISKZ_PDF_SAMPLE_PATH,bytes);
    assert.equal(Buffer.from(bytes).toString('latin1',0,5),'%PDF-');
    const document=await pdfLib.PDFDocument.load(bytes);
    assert.ok(document.getPageCount()>=2);
    assert.equal(modelCalls+comparisonCalls,beforePdf,'descargar no debe llamar al modelo');
    const elapsed=Math.round(performance.now()-start);
    assert.ok(elapsed<120000,`La prueba local tardó ${elapsed} ms`);
    await sql`update incidents set summary='Texto posterior' where id=${cases[0]}`;
    assert.notEqual((await getReportVersion('org',report.id,sql)).snapshot.cases[0].summary,'Texto posterior');
    await sql`update incidents set sharing_revoked_at=now() where id=${cases[0]}`;
    assert.equal(await getReportVersion('org',report.id,sql),null);
    assert.deepEqual(await listLatestReportVersions('org',sql),[]);
    console.log(`Prueba ficticia: ${elapsed} ms, ${modelCalls} resúmenes, ${comparisonCalls} comparación, ${bytes.length} bytes PDF, 52 tokens simulados.`);
  } finally {await sql.end();await server.stop();await db.close();}
});
