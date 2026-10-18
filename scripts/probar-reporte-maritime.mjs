import {generateMaritimeReport,reportSegments,validateReport} from '../src/lib/reports/maritime.mjs';
const mock=process.argv.includes('--mock');
const text='Caso ficticio. Solicita transferir S/ 1500.50 a la cuenta BCP 191-1234567-0-01.';
const mockRaw={summary:'La prueba ficticia describe una solicitud de transferencia que requiere revisión.',recommendation:'Verificar por un canal independiente.',
  modality:'Solicitud de transferencia',limitations:['Ejemplo ficticio.'],signals:[{type:'dinero',explanation:'Se solicita transferir dinero.',segment_id:'s0'}],
  entities:[{kind:'cuenta',value:'191-1234567-0-01',segment_id:'s0',bank:'BCP',wallet:null,currency:null}]};
const sample={...validateReport(mockRaw,reportSegments(text)),generation:{provider:'maritime',model_id:'maritime-simulado',usage:{total_tokens:0}}};
const config=mock?{agentId:'11111111-1111-4111-8111-111111111111',apiKey:'mock-only',fetch:async()=>Response.json({response:JSON.stringify(sample)})}:{};
try {
  if(process.argv.slice(2).some(arg=>arg!=='--mock')) throw Object.assign(Error(),{code:'report_invalid_arguments'});
  const result=await generateMaritimeReport(text,config);
  console.log(JSON.stringify({status:'completed',provider:mock?'mock':'maritime',persisted_to_panel:false,model:result.generation.model_id,
    usage:result.generation.usage,summary:result.summary,signals:result.signals.length,entities:result.entities.length},null,2));
} catch(error) {
  console.error(JSON.stringify({status:'failed',error_code:/^report_[a-zA-Z0-9_]+$/.test(error?.code??'')?error.code:'report_test_failed'}));process.exitCode=1;
}
