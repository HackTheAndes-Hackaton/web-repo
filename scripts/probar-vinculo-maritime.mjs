import {performance} from 'node:perf_hooks';
import {generateMaritimeLinkExplanation} from '../src/lib/reports/maritime-links.mjs';

const context={
  case_a:{summary:'Se solicita transferir dinero con urgencia a una cuenta bancaria.'},
  case_b:{summary:'Se insiste en enviar dinero de inmediato a una cuenta bancaria.'},
  reasons:[{index:0,kind:'contenido',label:'Patrón de solicitud de dinero parecido'}],
};
const start=performance.now();
try {
  const result=await generateMaritimeLinkExplanation(context);
  console.log(JSON.stringify({status:'completed',provider:'maritime',persisted_to_panel:false,
    elapsed_ms:Math.round(performance.now()-start),model:result.generation.model_id,
    usage:result.generation.usage,similarity:result.behavior_similarity,
    evidence_a:result.evidence_a,evidence_b:result.evidence_b},null,2));
} catch(error) {
  console.error(JSON.stringify({status:'failed',error_code:/^link_[a-zA-Z0-9_]+$/.test(error?.code??'')?error.code:'link_test_failed'}));
  process.exitCode=1;
}
