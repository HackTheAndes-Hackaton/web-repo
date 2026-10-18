import 'server-only';
import {createHash} from 'node:crypto';

export const REPORT_PROMPT_VERSION='pe-report-v1';
export const DEFAULT_MARITIME_MODEL='gpt-4.1-mini';
const signalTypes=['urgencia','dinero','datos_sensibles','secreto','amenaza','suplantacion','aislamiento'];
const entityKinds=['telefono','cuenta','cci','billetera','monto','correo','url'];
const failure=code=>Object.assign(new Error(code),{code});
const normalized=value=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
function exactKeys(value,keys) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key))) throw failure('report_invalid_output');
}
function nonempty(value,max,nullable=false) {
  if(nullable&&value===null) return null;
  if(typeof value!=='string'||!value.trim()||value.length>max) throw failure('report_invalid_output');
  return value.trim();
}
export function reportSegments(transcript) {
  if(typeof transcript!=='string'||!transcript.trim()||transcript.length>12000) throw failure('report_context_unavailable');
  const segments=[...transcript.matchAll(/[^\r\n]+/g)].filter(match=>match[0].trim()).map((match,index)=>{
    const leading=match[0].length-match[0].trimStart().length;
    return {id:`s${index}`,text:match[0].trim(),start:match.index+leading};
  });
  if(segments.length>100) throw failure('report_context_too_large');
  return segments;
}
export function validateReport(raw,segments) {
  exactKeys(raw,['summary','recommendation','modality','limitations','signals','entities']);
  const result={summary:nonempty(raw.summary,1200),recommendation:nonempty(raw.recommendation,600),modality:nonempty(raw.modality,160,true)};
  if(!Array.isArray(raw.limitations)||raw.limitations.length>8||!Array.isArray(raw.signals)||raw.signals.length>20||!Array.isArray(raw.entities)||raw.entities.length>40) throw failure('report_invalid_output');
  const defaultLimit='El resumen usa el contexto recibido; no verifica la transcripción, la identidad ni la totalidad de la llamada.';
  result.limitations=[...new Set(raw.limitations.map(item=>nonempty(item,250)).filter(item=>item!==defaultLimit))].slice(0,7).concat(defaultLimit);
  const sources=new Map(segments.map(segment=>[segment.id,segment]));
  const source=id=>{const segment=sources.get(id);if(!segment) throw failure('report_ungrounded_output');return segment;};
  const provenance=segment=>({source_kind:'received_transcript_unverified',source_segment:segment.id,
    source_sha256:createHash('sha256').update(segment.text).digest('hex'),source_span:{start:segment.start,end:segment.start+segment.text.length}});
  result.signals=raw.signals.map(item=>{
    exactKeys(item,['type','explanation','segment_id']);
    if(!signalTypes.includes(item.type)) throw failure('report_invalid_output');
    return {type:item.type,explanation:nonempty(item.explanation,350),confidence:0.5,source:'ia',
      analysis_meta:{...provenance(source(item.segment_id)),confidence_kind:'not_calibrated'}};
  });
  result.entities=raw.entities.map(item=>{
    exactKeys(item,['kind','value','segment_id','bank','wallet','currency']);
    if(!entityKinds.includes(item.kind)||![null,'Yape','Plin'].includes(item.wallet)||![null,'PEN','USD'].includes(item.currency)) throw failure('report_invalid_output');
    const segment=source(item.segment_id),value=nonempty(item.value,400),bank=nonempty(item.bank,80,true);
    if(!segment.text.includes(value)||(bank&&!normalized(segment.text).includes(normalized(bank)))||
      (item.wallet&&!normalized(segment.text).includes(normalized(item.wallet)))) throw failure('report_ungrounded_output');
    if(item.currency&&!(item.currency==='PEN'?/S\s*\/|\bsol(?:es)?\b|\bPEN\b/i:/US\s*\$|\bd[oó]lares\b|\bUSD\b/i).test(segment.text)) throw failure('report_ungrounded_output');
    return {kind:item.kind,value,provenance:'mencionado',analysis_meta:{...provenance(segment),country:'PE',
      ...(bank?{bank}:{}),...(item.wallet?{wallet:item.wallet}:{}),...(item.currency?{currency:item.currency}:{})}};
  });
  const narratives=[result.summary,result.recommendation,...result.limitations,...result.signals.map(item=>item.explanation)];
  if(segments.some(segment=>segment.text.length>=40&&narratives.some(value=>value.includes(segment.text)))) throw failure('report_literal_transcript_rejected');
  return result;
}

export function maritimeReportConfig(options={}) {
  const agentId=options.agentId??process.env.MARITIME_REPORT_AGENT_ID;
  const apiKey=options.apiKey??process.env.MARITIME_REPORT_API_KEY;
  const model=options.model??process.env.PHONEWARD_REPORT_MODEL??process.env.TISKZ_REPORT_MODEL??DEFAULT_MARITIME_MODEL;
  if(agentId&& !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId)) throw failure('report_invalid_agent_id');
  if(typeof model!=='string'||!/^[a-zA-Z0-9_.:-]{1,100}$/.test(model)) throw failure('report_invalid_model');
  return {agentId,apiKey,model,configured:Boolean(agentId&&apiKey),endpoint:agentId?`https://api.maritime.sh/api/agents/${agentId}/chat`:null};
}

/** La web decide permisos, vuelve a comprobar el resultado y guarda el reporte. Maritime ejecuta la inferencia. */
export async function generateMaritimeReport(transcript,options={}) {
  const config=maritimeReportConfig(options);
  if(!config.configured) throw failure('report_not_configured');
  const segments=reportSegments(transcript);
  let response;
  try {
    response=await (options.fetch??fetch)(config.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(options.timeoutMs??25000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},
      body:JSON.stringify({message:JSON.stringify({consentimiento_analisis:true,consentimiento_reporte:true,transcripcion:transcript})})});
  } catch {throw failure('report_agent_network_error');}
  if(!response.ok) throw failure(`report_agent_http_${response.status}`);
  const body=await response.text();
  if(body.length>150000) throw failure('report_agent_invalid_response');
  let remote;
  try {remote=JSON.parse(JSON.parse(body).response);} catch {throw failure('report_agent_invalid_response');}
  if(!remote||remote.generation?.provider!=='maritime'||typeof remote.generation.model_id!=='string'||
    !/^[a-zA-Z0-9_.:-]{1,100}$/.test(remote.generation.model_id)||!Array.isArray(remote.signals)||
    remote.signals.length>20||!Array.isArray(remote.entities)||remote.entities.length>40) throw failure('report_agent_invalid_response');
  let raw;
  try {raw={summary:remote.summary,recommendation:remote.recommendation,modality:remote.modality,limitations:remote.limitations,
    signals:remote.signals.map(item=>({type:item.type,explanation:item.explanation,segment_id:item.analysis_meta?.source_segment})),
    entities:remote.entities.map(item=>({kind:item.kind,value:item.value,segment_id:item.analysis_meta?.source_segment,
      bank:item.analysis_meta?.bank??null,wallet:item.analysis_meta?.wallet??null,currency:item.analysis_meta?.currency??null}))};
  } catch {throw failure('report_agent_invalid_response');}
  const usage={};
  for(const field of ['prompt_tokens','completion_tokens','total_tokens']) if(Number.isSafeInteger(remote.generation.usage?.[field])&&remote.generation.usage[field]>=0) usage[field]=remote.generation.usage[field];
  return {...validateReport(raw,segments),generation:{provider:'maritime',prompt_version:REPORT_PROMPT_VERSION,model_id:remote.generation.model_id,usage}};
}
