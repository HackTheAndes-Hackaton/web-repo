import test from 'node:test';
import assert from 'node:assert/strict';
import {generateMaritimeReport,maritimeReportConfig,reportSegments,validateReport} from '../src/lib/reports/maritime.mjs';

const transcript='Solicita transferir S/ 1500.50 a la cuenta BCP 191-1234567-0-01.\nIndica el teléfono 999 888 777.';
const agentId='11111111-1111-4111-8111-111111111111';
const options={agentId,apiKey:'private-agent-test-token'};
function raw() {return {summary:'Se describe una solicitud de transferencia que requiere revisión.',recommendation:'Verificar el pedido por un canal independiente.',modality:'Solicitud de transferencia',limitations:['Los identificadores mencionados no verifican una identidad.'],
  signals:[{type:'dinero',explanation:'Se solicita una transferencia.',segment_id:'s0'}],
  entities:[{kind:'cuenta',value:'191-1234567-0-01',segment_id:'s0',bank:'BCP',wallet:null,currency:null},
    {kind:'telefono',value:'999 888 777',segment_id:'s1',bank:null,wallet:null,currency:null}]};}
const remote=(input=raw())=>({...validateReport(input,reportSegments(transcript)),generation:{provider:'maritime',model_id:'gpt-4.1-mini-2025-04-14',usage:{prompt_tokens:120,completion_tokens:80,total_tokens:200}}});
const response=report=>Response.json({response:JSON.stringify(report)});

test('Maritime: usa el agente privado y comprueba otra vez los datos en la web',async()=>{
  let sent;
  const output=await generateMaritimeReport(transcript,{...options,fetch:async(url,init)=>{
    assert.equal(url,`https://api.maritime.sh/api/agents/${agentId}/chat`);
    assert.equal(init.headers.Authorization,'Bearer private-agent-test-token');assert.equal(init.redirect,'error');
    sent=JSON.parse(JSON.parse(init.body).message);return response(remote());
  }});
  assert.equal(sent.transcripcion,transcript);assert.equal(sent.consentimiento_analisis,true);assert.equal(sent.consentimiento_reporte,true);
  assert.equal(output.generation.provider,'maritime');assert.equal(output.generation.usage.total_tokens,200);
  assert.equal(output.entities[0].analysis_meta.source_segment,'s0');assert.equal(output.entities[0].analysis_meta.source_sha256.length,64);
  assert.equal(JSON.stringify(output).includes(transcript.split('\n')[0]),false);
  assert.equal(JSON.stringify(output).includes(options.apiKey),false);
});

test('Maritime: rechaza identificadores, banco y segmentos sin sustento',async()=>{
  for(const change of [
    {value:'1911234567001'},
    {analysis_meta:{...remote().entities[0].analysis_meta,bank:'Interbank'}},
    {analysis_meta:{...remote().entities[0].analysis_meta,source_segment:'s99'}},
  ]) {
    const report=remote();report.entities[0]={...report.entities[0],...change};
    await assert.rejects(generateMaritimeReport(transcript,{...options,fetch:async()=>response(report)}),error=>error.code==='report_ungrounded_output');
  }
  const report=remote();report.summary=reportSegments(transcript)[0].text;
  await assert.rejects(generateMaritimeReport(transcript,{...options,fetch:async()=>response(report)}),error=>error.code==='report_literal_transcript_rejected');
  const rawOutput=raw();rawOutput.entities[0].currency='USD';assert.throws(()=>validateReport(rawOutput,reportSegments(transcript)));
});

test('Maritime: sin credencial o ID no se configura y no acepta identificadores de agente manipulados',()=>{
  assert.equal(maritimeReportConfig({agentId,apiKey:''}).configured,false);
  assert.equal(maritimeReportConfig({agentId:'',apiKey:'private'}).configured,false);
  assert.throws(()=>maritimeReportConfig({agentId:'../../other',apiKey:'private'}),error=>error.code==='report_invalid_agent_id');
  assert.equal(maritimeReportConfig(options).endpoint,`https://api.maritime.sh/api/agents/${agentId}/chat`);
});

test('Maritime: un error no revela el cuerpo del proveedor ni repite el consumo',async()=>{
  let calls=0;
  await assert.rejects(generateMaritimeReport(transcript,{...options,fetch:async()=>{calls++;return new Response('secreto del proveedor',{status:503});}}),
    error=>error.code==='report_agent_http_503'&&!error.message.includes('secreto'));
  assert.equal(calls,1);
  await assert.rejects(generateMaritimeReport(transcript,{...options,fetch:async()=>response({generation:{provider:'maritime'},signals:[],entities:[]})}),
    error=>error.code==='report_agent_invalid_response');
});
