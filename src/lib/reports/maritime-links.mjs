import 'server-only';
import {maritimeReportConfig} from './maritime.mjs';

export const LINK_PROMPT_VERSION='pe-link-v1';
const failure=code=>Object.assign(new Error(code),{code});

export function validateLinkExplanation(context,remote) {
  if(!remote||typeof remote!=='object'||Array.isArray(remote)||
    !['similar','unclear','different'].includes(remote.behavior_similarity)||
    !Array.isArray(remote.supporting_reason_indexes)||remote.supporting_reason_indexes.length>8||
    remote.supporting_reason_indexes.some(index=>!Number.isInteger(index)||index<0||index>=context.reasons.length)||
    !Array.isArray(remote.limitations)||remote.limitations.length>3||
    remote.limitations.some(value=>typeof value!=='string'||!value.trim()||value.length>180)||
    remote.generation?.provider!=='maritime'||typeof remote.generation.model_id!=='string'||
    !/^[a-zA-Z0-9_.:-]{1,100}$/.test(remote.generation.model_id)) throw failure('link_agent_invalid_response');
  for(const [field,summary] of [['evidence_a',context.case_a.summary],['evidence_b',context.case_b.summary]]) {
    const phrase=remote[field];
    if(phrase!==null&&(typeof phrase!=='string'||!phrase.trim()||phrase.length>180||!summary.includes(phrase))) throw failure('link_agent_ungrounded_response');
  }
  if(remote.behavior_similarity==='similar'&&(!remote.evidence_a||!remote.evidence_b)) throw failure('link_agent_ungrounded_response');
  const usage={};
  for(const field of ['prompt_tokens','completion_tokens','total_tokens']) if(Number.isSafeInteger(remote.generation.usage?.[field])&&remote.generation.usage[field]>=0) usage[field]=remote.generation.usage[field];
  return {behavior_similarity:remote.behavior_similarity,evidence_a:remote.evidence_a,evidence_b:remote.evidence_b,
    supporting_reason_indexes:[...new Set(remote.supporting_reason_indexes)],limitations:remote.limitations,
    generation:{provider:'maritime',prompt_version:LINK_PROMPT_VERSION,model_id:remote.generation.model_id,usage}};
}

/** La web solo envía los dos resúmenes y categorías de evidencia del vínculo que ya propuso. */
export async function generateMaritimeLinkExplanation(context,options={}) {
  const config=maritimeReportConfig(options);
  if(!config.configured) throw failure('link_agent_not_configured');
  let response;
  try {response=await (options.fetch??fetch)(config.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(options.timeoutMs??25000),
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},
    body:JSON.stringify({message:JSON.stringify({task:'explain_link',consentimiento_analisis:true,consentimiento_reporte:true,...context})})});}
  catch {throw failure('link_agent_network_error');}
  if(!response.ok) throw failure(`link_agent_http_${response.status}`);
  let remote;
  try {const body=await response.text();if(body.length>30000) throw Error();remote=JSON.parse(JSON.parse(body).response);}
  catch {throw failure('link_agent_invalid_response');}
  return validateLinkExplanation(context,remote);
}
