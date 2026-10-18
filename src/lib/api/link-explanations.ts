import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type postgres from 'postgres';
import {db,type Sql} from '../db';
import {generateMaritimeLinkExplanation,type LinkExplanation,type LinkExplanationContext} from '../reports/maritime-links.mjs';
import {maritimeReportConfig} from '../reports/maritime.mjs';
import type {LinkReason} from '../types';
import {ApiError,notFound} from './http';

type LinkRow={id:string;status:string;score:number;content_sim:number;reasons:LinkReason[];evidence_snapshot:Record<string,unknown>;
  a_org:string|null;b_org:string|null;a_simulated:boolean|null;b_simulated:boolean|null;
  a_revoked:string|null;b_revoked:string|null;a_consent:Record<string,unknown>;b_consent:Record<string,unknown>;
  a_meta:Record<string,unknown>;b_meta:Record<string,unknown>;a_summary:string|null;b_summary:string|null};
type Options={connection?:Sql;generate?:(context:LinkExplanationContext)=>Promise<LinkExplanation>;now?:()=>Date};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reportReady=(meta:Record<string,unknown>)=>{
  const value=meta?.report_generation as {status?:string;provider?:string}|undefined;
  return value?.status==='completed'&&value.provider==='maritime';
};
const consented=(value:Record<string,unknown>)=>value?.report_storage===true&&value?.report_sharing===true;
const explanationOf=(snapshot:Record<string,unknown>)=>snapshot?.ai_explanation as {status?:string;input_sha256?:string;run_id?:string;started_at?:string}|undefined;

/** Compara solo un vínculo propuesto; no crea aristas ni cambia la decisión humana. */
export async function explainPendingLink(org:string,linkId:string,options:Options={}) {
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(linkId)) throw new ApiError(422,'invalid_link_id','ID de vínculo inválido.');
  const sql=options.connection??await db();
  const now=options.now??(()=>new Date());
  const claim=await sql.begin(async tx=>{
    const [row]=await tx<LinkRow[]>`select l.id,l.status,l.score,l.content_sim,l.reasons,l.evidence_snapshot,
      a.org_id as a_org,b.org_id as b_org,a.simulated as a_simulated,b.simulated as b_simulated,
      a.sharing_revoked_at as a_revoked,b.sharing_revoked_at as b_revoked,
      a.consent_snapshot as a_consent,b.consent_snapshot as b_consent,
      a.analysis_meta as a_meta,b.analysis_meta as b_meta,a.summary as a_summary,b.summary as b_summary
      from links l join incidents a on a.id=l.incident_a join incidents b on b.id=l.incident_b
      where l.id=${linkId} for update of l`;
    if(!row||row.a_org!==org||row.b_org!==org) throw notFound('Vínculo');
    if(row.status!=='pendiente') throw new ApiError(409,'link_already_reviewed','La revisión humana está congelada.');
    if(row.a_simulated!==true||row.b_simulated!==true) throw new ApiError(403,'link_demo_only','Solo se comparan casos ficticios.');
    if(row.a_revoked||row.b_revoked||!consented(row.a_consent)||!consented(row.b_consent))
      throw new ApiError(403,'link_not_authorized','Uno de los casos ya no autoriza el reporte.');
    if(!reportReady(row.a_meta)||!reportReady(row.b_meta)||!row.a_summary?.trim()||!row.b_summary?.trim())
      throw new ApiError(422,'link_reports_unavailable','Se necesitan dos resúmenes Maritime completos.');
    if(!Array.isArray(row.reasons)||row.reasons.length>20) throw new ApiError(422,'link_reasons_invalid','Evidencia del vínculo incompatible.');
    if(!options.generate&&!maritimeReportConfig().configured)
      throw new ApiError(503,'link_agent_not_configured','Maritime no está configurado en la web.');
    const context:LinkExplanationContext={case_a:{summary:row.a_summary.slice(0,1200)},case_b:{summary:row.b_summary.slice(0,1200)},
      reasons:row.reasons.map((reason,index)=>({index,kind:reason.kind,label:reason.detail.split(':')[0].slice(0,80)}))};
    const hash=digest({context,reasons:row.reasons,score:row.score,content_sim:row.content_sim});
    const previous=explanationOf(row.evidence_snapshot);
    if(previous?.input_sha256===hash&&previous.status==='completed') return {status:'completed' as const,duplicate:true};
    if(previous?.status==='running'&&previous.started_at&&now().getTime()-Date.parse(previous.started_at)<120000)
      return {status:'running' as const,duplicate:true};
    const runId=randomUUID();
    const pending={status:'running',provider:'maritime',run_id:runId,input_sha256:hash,started_at:now().toISOString()};
    await tx`update links set evidence_snapshot=${tx.json({...row.evidence_snapshot,ai_explanation:pending} as postgres.JSONValue)} where id=${linkId}`;
    return {status:'claimed' as const,duplicate:false,context,runId,hash};
  });
  if(claim.status!=='claimed') return {link_id:linkId,status:claim.status,duplicate:true};
  try {
    const result=await (options.generate??generateMaritimeLinkExplanation)(claim.context);
    const completed={status:'completed',provider:'maritime',run_id:claim.runId,input_sha256:claim.hash,
      generated_at:now().toISOString(),behavior_similarity:result.behavior_similarity,evidence_a:result.evidence_a,
      evidence_b:result.evidence_b,supporting_reason_indexes:result.supporting_reason_indexes,
      limitations:result.limitations,model_id:result.generation.model_id,prompt_version:result.generation.prompt_version,
      usage:result.generation.usage};
    const updated=await sql`update links set evidence_snapshot=jsonb_set(evidence_snapshot,'{ai_explanation}',${sql.json(completed)})
      where id=${linkId} and status='pendiente' and evidence_snapshot->'ai_explanation'->>'run_id'=${claim.runId}
      returning id`;
    return {link_id:linkId,status:updated.length?'completed':'stale',duplicate:false};
  } catch(error) {
    const candidate=(error as {code?:string})?.code??'';
    const code=/^link_[a-zA-Z0-9_]+$/.test(candidate)?candidate:'link_agent_failed';
    const failed={status:'failed',provider:'maritime',run_id:claim.runId,input_sha256:claim.hash,
      failed_at:now().toISOString(),error_code:code};
    await sql`update links set evidence_snapshot=jsonb_set(evidence_snapshot,'{ai_explanation}',${sql.json(failed)})
      where id=${linkId} and status='pendiente' and evidence_snapshot->'ai_explanation'->>'run_id'=${claim.runId}`;
    return {link_id:linkId,status:'failed' as const,duplicate:false};
  }
}

/** Tras cerrar un caso, explica como máximo dos candidatos deterministas. Los fallos quedan para reintento manual. */
export async function explainTopPendingLinks(org:string,incidentId:string,options:Options={}) {
  if(!options.generate&&!maritimeReportConfig().configured) return [];
  const sql=options.connection??await db();
  const candidates=await sql<{id:string}[]>`select l.id from links l
    join incidents a on a.id=l.incident_a join incidents b on b.id=l.incident_b
    where (a.id=${incidentId} or b.id=${incidentId}) and l.status='pendiente'
      and a.org_id=${org} and b.org_id=${org} and a.simulated=true and b.simulated=true
      and a.sharing_revoked_at is null and b.sharing_revoked_at is null
      and a.consent_snapshot->>'report_storage'='true' and b.consent_snapshot->>'report_storage'='true'
      and a.consent_snapshot->>'report_sharing'='true' and b.consent_snapshot->>'report_sharing'='true'
      and a.analysis_meta->'report_generation'->>'status'='completed'
      and b.analysis_meta->'report_generation'->>'status'='completed'
      and a.analysis_meta->'report_generation'->>'provider'='maritime'
      and b.analysis_meta->'report_generation'->>'provider'='maritime'
      and nullif(trim(a.summary),'') is not null and nullif(trim(b.summary),'') is not null
      and coalesce(l.evidence_snapshot->'ai_explanation'->>'status','') not in ('completed','running','failed')
    order by l.score desc,l.id limit 2`;
  const results=[];
  for(const candidate of candidates) {
    try {results.push(await explainPendingLink(org,candidate.id,{...options,connection:sql}));}
    catch(error) {
      const code=(error as {code?:string})?.code;
      results.push({link_id:candidate.id,status:typeof code==='string'&&/^link_[a-z_]+$/.test(code)?code:'failed'});
    }
  }
  return results;
}
