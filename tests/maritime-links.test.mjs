import test from 'node:test';
import assert from 'node:assert/strict';
import {generateMaritimeLinkExplanation} from '../src/lib/reports/maritime-links.mjs';

const agentId='11111111-1111-4111-8111-111111111111';
const context={case_a:{summary:'Se solicita transferir dinero con urgencia.'},case_b:{summary:'Se presiona para enviar dinero de inmediato.'},
  reasons:[{index:0,kind:'contenido',label:'Patrón de señales parecido'}]};
const answer={behavior_similarity:'similar',evidence_a:'transferir dinero con urgencia',evidence_b:'enviar dinero de inmediato',
  supporting_reason_indexes:[0],limitations:['Los resúmenes no prueban identidad.'],
  generation:{provider:'maritime',model_id:'gpt-4.1-mini-2025-04-14',usage:{total_tokens:120}}};
const response=value=>Response.json({response:JSON.stringify(value)});

test('la web pide a Maritime solo dos resúmenes y categorías; revalida sus citas y procedencia',async()=>{
  let input;
  const output=await generateMaritimeLinkExplanation(context,{agentId,apiKey:'private-test',fetch:async(url,init)=>{
    assert.equal(url,`https://api.maritime.sh/api/agents/${agentId}/chat`);
    assert.equal(init.headers.Authorization,'Bearer private-test');
    input=JSON.parse(JSON.parse(init.body).message);
    return response(answer);
  }});
  assert.equal(input.task,'explain_link');assert.equal(input.consentimiento_reporte,true);
  assert.deepEqual(input.case_a,context.case_a);assert.equal(input.transcripcion,undefined);
  assert.equal(output.behavior_similarity,'similar');assert.equal(output.generation.usage.total_tokens,120);
  assert.equal(JSON.stringify(output).includes('private-test'),false);
});

test('la web rechaza referencias inventadas y errores sin repetir llamadas ni revelar respuestas',async()=>{
  for(const invalid of [{...answer,evidence_b:'hecho inventado'},
    {...answer,supporting_reason_indexes:[2]},
    {...answer,generation:{...answer.generation,provider:'xai'}}]) {
    await assert.rejects(generateMaritimeLinkExplanation(context,{agentId,apiKey:'private-test',fetch:async()=>response(invalid)}),
      error=>['link_agent_ungrounded_response','link_agent_invalid_response'].includes(error.code));
  }
  let calls=0;
  await assert.rejects(generateMaritimeLinkExplanation(context,{agentId,apiKey:'private-test',fetch:async()=>{calls++;return new Response('secret',{status:503});}}),
    error=>error.code==='link_agent_http_503'&&!error.message.includes('secret'));
  assert.equal(calls,1);
});
