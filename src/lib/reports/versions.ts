import "server-only";
import crypto from "node:crypto";
import type postgres from "postgres";
import { db, newId, type Sql } from "../db";
import { buildLinkGroups } from "../link-groups";
import type { LinkReason, LinkStatus } from "../types";

export class ReportVersionError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

type CaseRow = {
  id:string; org_id:string; simulated:boolean|null; sharing_revoked_at:string|null;
  title:string; started_at:string; ended_at:string|null; status:string; channel:string;
  risk_score:number; risk_level:string; verdict:string; scam_type:string|null;
  impersonating:string|null; caller_e164:string|null; caller_number_raw:string|null;
  summary:string|null; recommendation:string|null; analysis_meta:Record<string,unknown>;
  consent_snapshot:Record<string,unknown>;
};
type LinkRow = {
  id:string; incident_a:string; incident_b:string; status:LinkStatus; score:number;
  voice_sim:number|null; content_sim:number; reasons:LinkReason[];
  evidence_snapshot:Record<string,unknown>; evidence_version:number;
  reviewed_by:string|null; reviewed_at:string|null; reviewed_evidence_version:number|null;
  reviewed_evidence:Record<string,unknown>|null; note:string|null;
};
type SignalRow = {incident_id:string;type:string;evidence:string;explanation:string;confidence:number;source:string};
type EntityRow = {incident_id:string;kind:string;value:string;normalized:string;provenance:string};

export type ReportCase = Omit<CaseRow,"org_id"|"simulated"|"sharing_revoked_at"|"analysis_meta"|"consent_snapshot"> & {
  maritime:{model_id:string|null;prompt_version:string|null;limitations:string[]};
  signals:Omit<SignalRow,"incident_id">[];entities:Omit<EntityRow,"incident_id">[];
};
export type ReportLink = Omit<LinkRow,"reviewed_evidence"> & {reviewed_evidence:Record<string,unknown>|null};
export type ReportSnapshot = {
  schema_version:1; captured_at:string; organization:{id:string;name:string};
  selected_case_ids:string[]; selected_link_ids:string[];
  cases:ReportCase[];links:ReportLink[];
  caveat:string;
};
export type ReportVersion = {
  id:string;org_id:string;series_id:string;version:number;title:string;summary:string;
  snapshot:ReportSnapshot;content_sha256:string;created_by_id:string|null;
  created_by_name:string;created_at:string;
};

function selected(values:string[],min:number,max:number,label:string) {
  if(values.length<min||values.length>max||values.some(value=>!value||value.length>100)||new Set(values).size!==values.length)
    throw new ReportVersionError("invalid_selection",`Selecciona entre ${min} y ${max} ${label} diferentes.`);
  return [...values].sort();
}
function reportReady(row:CaseRow) {
  const generation=row.analysis_meta?.report_generation as Record<string,unknown>|undefined;
  return row.simulated===true && row.status==="finalizado" && !row.sharing_revoked_at &&
    row.consent_snapshot?.report_storage===true && row.consent_snapshot?.report_sharing===true &&
    generation?.status==="completed" && generation.provider==="maritime" && Boolean(row.summary?.trim());
}
function maritimeMeta(meta:Record<string,unknown>) {
  const generation=(meta.report_generation??{}) as Record<string,unknown>;
  const limitations=Array.isArray(generation.limitations)?generation.limitations.filter((v):v is string=>typeof v==="string"):[];
  return {model_id:typeof generation.model_id==="string"?generation.model_id:null,
    prompt_version:typeof generation.prompt_version==="string"?generation.prompt_version:null,limitations};
}
function stable(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if(value!==null&&typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Una transacción fija los hallazgos y las decisiones que existían al crear esta versión. */
export async function createReportVersion(input:{orgId:string;analystId:string;caseIds:string[];linkIds:string[];
  title:string;seriesId?:string|null},client?:Sql):Promise<ReportVersion> {
  const caseIds=selected(input.caseIds,2,20,"casos");
  const linkIds=selected(input.linkIds,1,50,"vínculos");
  const title=input.title.trim();
  if(!title||title.length>120) throw new ReportVersionError("invalid_title","Escribe un título de hasta 120 caracteres.");
  if(input.seriesId && (input.seriesId.length>100||!/^rep_[a-f0-9]+$/.test(input.seriesId)))
    throw new ReportVersionError("invalid_series","La serie del informe no es válida.");
  const sql=client??await db();
  return sql.begin(async tx=>{
    await tx`set transaction isolation level repeatable read`;
    const [analyst]=await tx<{id:string;name:string}[]>`
      select id,name from users where id=${input.analystId} and org_id=${input.orgId} and role='analista'`;
    if(!analyst) throw new ReportVersionError("forbidden","El analista no pertenece a esta organización.");
    const [org]=await tx<{id:string;name:string}[]>`select id,name from organizations where id=${input.orgId}`;
    if(!org) throw new ReportVersionError("invalid_org","La organización no existe.");
    const cases=await tx<CaseRow[]>`select id,org_id,simulated,sharing_revoked_at,title,started_at,ended_at,status,channel,
      risk_score,risk_level,verdict,scam_type,impersonating,caller_e164,caller_number_raw,summary,recommendation,
      analysis_meta,consent_snapshot from incidents where id=any(${caseIds}::text[]) and org_id=${input.orgId}`;
    if(cases.length!==caseIds.length||cases.some(row=>!reportReady(row)))
      throw new ReportVersionError("cases_unavailable","Todos los casos deben ser ficticios, finalizados, autorizados y tener un resumen Maritime completo.");
    const links=await tx<LinkRow[]>`select l.id,l.incident_a,l.incident_b,l.status,l.score,l.voice_sim,l.content_sim,l.reasons,
      l.evidence_snapshot,l.evidence_version,l.reviewed_by,l.reviewed_at,
      l.reviewed_evidence_version,l.reviewed_evidence,l.note
      from links l join incidents a on a.id=l.incident_a join incidents b on b.id=l.incident_b
      where l.id=any(${linkIds}::text[]) and a.org_id=${input.orgId} and b.org_id=${input.orgId}`;
    if(links.length!==linkIds.length||links.some(link=>link.status==="descartado"||
      !caseIds.includes(link.incident_a)||!caseIds.includes(link.incident_b)))
      throw new ReportVersionError("links_unavailable","Cada vínculo elegido debe unir dos casos seleccionados y seguir vigente.");
    const groups=buildLinkGroups(cases,links);
    if(groups.length!==1||groups[0].incidentIds.length!==caseIds.length)
      throw new ReportVersionError("disconnected_selection","Los vínculos elegidos deben conectar todos los casos seleccionados.");
    const eligibleCases=await tx<Pick<CaseRow,"id"|"org_id"|"simulated"|"sharing_revoked_at">[]>`
      select id,org_id,simulated,sharing_revoked_at from incidents
      where org_id=${input.orgId} and simulated is true and status='finalizado'
        and sharing_revoked_at is null and consent_snapshot->>'report_storage'='true'
        and consent_snapshot->>'report_sharing'='true'
        and analysis_meta->'report_generation'->>'status'='completed'
        and analysis_meta->'report_generation'->>'provider'='maritime'
        and nullif(trim(summary),'') is not null`;
    const eligibleIds=eligibleCases.map(row=>row.id);
    const eligibleLinks=await tx<Pick<LinkRow,"id"|"incident_a"|"incident_b"|"status">[]>`
      select id,incident_a,incident_b,status from links
      where incident_a=any(${eligibleIds}::text[]) and incident_b=any(${eligibleIds}::text[])
        and status<>'descartado'`;
    const completeGroup=buildLinkGroups(eligibleCases,eligibleLinks)
      .find(group=>group.incidentIds.includes(caseIds[0]));
    if(!completeGroup||completeGroup.incidentIds.join(',')!==caseIds.join(',')||
      completeGroup.links.map(link=>link.id).sort().join(',')!==linkIds.join(','))
      throw new ReportVersionError("incomplete_group","El informe debe incluir todos los casos y vínculos vigentes del conjunto identificado.");
    const [signals,entities]=await Promise.all([
      tx<SignalRow[]>`select incident_id,type,evidence,explanation,confidence,source from signals
        where incident_id=any(${caseIds}::text[]) order by incident_id,created_at,id`,
      tx<EntityRow[]>`select incident_id,kind,value,normalized,provenance from entities
        where incident_id=any(${caseIds}::text[]) order by incident_id,kind,normalized,id`,
    ]);
    const reportCases:ReportCase[]=cases.sort((a,b)=>a.started_at.localeCompare(b.started_at)||a.id.localeCompare(b.id))
      .map(row=>({id:row.id,title:row.title,started_at:row.started_at,ended_at:row.ended_at,status:row.status,
        channel:row.channel,risk_score:row.risk_score,risk_level:row.risk_level,verdict:row.verdict,
        scam_type:row.scam_type,impersonating:row.impersonating,caller_e164:row.caller_e164,
        caller_number_raw:row.caller_number_raw,summary:row.summary,recommendation:row.recommendation,
        maritime:maritimeMeta(row.analysis_meta),
        signals:signals.filter(signal=>signal.incident_id===row.id).map(signal=>({type:signal.type,evidence:signal.evidence,
          explanation:signal.explanation,confidence:signal.confidence,source:signal.source})),
        entities:entities.filter(entity=>entity.incident_id===row.id).map(entity=>({kind:entity.kind,value:entity.value,
          normalized:entity.normalized,provenance:entity.provenance}))}));
    const reportLinks=links.sort((a,b)=>a.id.localeCompare(b.id));
    const snapshot:ReportSnapshot={schema_version:1,captured_at:new Date().toISOString(),organization:org,
      selected_case_ids:caseIds,selected_link_ids:linkIds,cases:reportCases,links:reportLinks,
      caveat:"Agrupación preliminar de casos ficticios. Los indicios y coincidencias no identifican a una persona ni sustituyen la revisión policial."};
    const summary=`Informe preliminar de ${reportCases.length} casos ficticios y ${reportLinks.length} vínculos seleccionados. `+
      `${reportLinks.filter(link=>link.status==="confirmado").length} vínculos confirmados por analista; `+
      `${reportLinks.filter(link=>link.status==="pendiente").length} pendientes de revisión. `+
      reportCases.map(row=>`${row.title}: ${row.summary}`).join(" ").slice(0,5000);
    const seriesId=input.seriesId??newId("rep");
    await tx`select pg_advisory_xact_lock(hashtext(${input.orgId}),hashtext(${seriesId}))`;
    const previous=await tx<{version:number;snapshot:ReportSnapshot}[]>`select version,snapshot from report_versions
      where org_id=${input.orgId} and series_id=${seriesId} order by version desc limit 1`;
    if(input.seriesId&&!previous.length) throw new ReportVersionError("series_unavailable","No existe esta serie de informes en la organización.");
    if(previous.length&&previous[0].snapshot.selected_case_ids.join(',')!==caseIds.join(','))
      throw new ReportVersionError("series_group_mismatch","La serie pertenece a otro conjunto de casos.");
    const version=(previous[0]?.version??0)+1;
    const contentSha256=crypto.createHash("sha256").update(stable({title,summary,snapshot})).digest("hex");
    const [saved]=await tx<ReportVersion[]>`insert into report_versions
      (id,org_id,series_id,version,title,summary,snapshot,content_sha256,created_by_id,created_by_name)
      values (${newId("rv")},${input.orgId},${seriesId},${version},${title},${summary},
        ${tx.json(snapshot as unknown as postgres.JSONValue)},${contentSha256},${analyst.id},${analyst.name}) returning *`;
    return saved;
  });
}

export async function listLatestReportVersions(orgId:string,client?:Sql) {
  const sql=client??await db();
  return [...await sql<ReportVersion[]>`select distinct on (series_id) * from report_versions
    where org_id=${orgId} and not exists (
      select 1 from jsonb_array_elements_text(snapshot->'selected_case_ids') as chosen(case_id)
      left join incidents i on i.id=chosen.case_id and i.org_id=${orgId}
      where i.id is null or i.sharing_revoked_at is not null
        or i.consent_snapshot->>'report_storage' is distinct from 'true'
        or i.consent_snapshot->>'report_sharing' is distinct from 'true')
    order by series_id,version desc`]
    .sort((a,b)=>b.created_at.localeCompare(a.created_at));
}

export async function getReportVersion(orgId:string,id:string,client?:Sql) {
  const sql=client??await db();
  const [row]=await sql<ReportVersion[]>`select * from report_versions
    where org_id=${orgId} and id=${id} and not exists (
      select 1 from jsonb_array_elements_text(snapshot->'selected_case_ids') as chosen(case_id)
      left join incidents i on i.id=chosen.case_id and i.org_id=${orgId}
      where i.id is null or i.sharing_revoked_at is not null
        or i.consent_snapshot->>'report_storage' is distinct from 'true'
        or i.consent_snapshot->>'report_sharing' is distinct from 'true')`;
  return row??null;
}

export async function listReportVersions(orgId:string,seriesId:string,client?:Sql) {
  const sql=client??await db();
  return [...await sql<ReportVersion[]>`select * from report_versions
    where org_id=${orgId} and series_id=${seriesId} and not exists (
      select 1 from jsonb_array_elements_text(snapshot->'selected_case_ids') as chosen(case_id)
      left join incidents i on i.id=chosen.case_id and i.org_id=${orgId}
      where i.id is null or i.sharing_revoked_at is not null
        or i.consent_snapshot->>'report_storage' is distinct from 'true'
        or i.consent_snapshot->>'report_sharing' is distinct from 'true')
    order by version desc`];
}
