import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type postgres from "postgres";
import { db, type Sql } from "../db";
import { generateMaritimeReport, maritimeReportConfig, type MaritimeReport } from "../reports/maritime.mjs";
import { commitFindings } from "./findings";
import { ApiError, notFound } from "./http";

/** Contexto transitorio del cierre: no se guarda la conversación. Solo pruebas ficticias. */
export const caseFinalizationInput = z.object({
  request_id: z.uuid(), session_id: z.string().trim().min(1).max(200), simulated: z.literal(true),
  started_at: z.iso.datetime({offset:true}), ended_at: z.iso.datetime({offset:true}),
  channel: z.enum(["webrtc", "telefono_vapi"]),
  time_source: z.enum(["session_started", "monitor_first_event"]).default("session_started"),
  text: z.string().trim().min(1).max(12000),
  decision: z.object({alerta:z.boolean(), probabilidad:z.number().min(0).max(1)}).strict().nullable().default(null),
}).strict().refine(value => new Date(value.ended_at) >= new Date(value.started_at), "Fechas de sesión incompatibles.");

const incidentId = (org:string, session:string) => `aud_${createHash("sha256").update(`${org}:${session}`).digest("hex").slice(0,48)}`;
type Options = {connection?:Sql; generate?:(text:string)=>Promise<MaritimeReport>; allowDemo?:boolean};

export async function finalizeCase(org:string, value:unknown, actor:string, options:Options = {}) {
  const input = caseFinalizationInput.parse(value);
  const sql = options.connection ?? await db();
  const id = incidentId(org,input.session_id);
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const demoAuthorized = options.allowDemo ?? (process.env.PHONEWARD_DEMO_REPORTS_ENABLED ?? process.env.TISKZ_DEMO_REPORTS_ENABLED) === "true";
  const claim = await sql.begin(async tx => {
    // La autorización de pruebas pertenece a la web, nunca al cliente móvil ni a voz.
    if (demoAuthorized) await tx`insert into incidents(id,org_id,agent_session_id,started_at,simulated,channel,title)
      values (${id},${org},${input.session_id},${input.started_at},true,${input.channel},'Caso ficticio · análisis pendiente')
      on conflict (id) do nothing`;
    const [current] = await tx`select * from incidents where id=${id} and org_id=${org} for update`;
    if (!current) throw notFound("Incidente autorizado desde la web");
    if (current.agent_session_id !== input.session_id || current.simulated !== true) throw new ApiError(409,"source_conflict","Sesión u origen incompatibles.");
    if (current.sharing_revoked_at) throw new ApiError(403,"sharing_revoked","La compartición fue revocada.");
    if (new Date(input.ended_at) < new Date(current.started_at)) throw new ApiError(422,"invalid_call_dates","Fechas incompatibles con el caso registrado.");
    const consent = current.consent_snapshot ?? {};
    if (consent.report_storage === false || consent.report_sharing === false) throw new ApiError(403,"report_not_authorized","El permiso del reporte fue retirado desde la web.");
    if (!demoAuthorized && (consent.report_storage !== true || consent.report_sharing !== true)) {
      throw new ApiError(403,"report_not_authorized","Autoriza el procesamiento del reporte desde la web.");
    }
    const previous = current.analysis_meta?.report_request;
    const generation = current.analysis_meta?.report_generation;
    if (previous?.run_id === input.request_id) {
      if (previous.sha256 !== digest) throw new ApiError(409,"idempotency_conflict","El request_id ya corresponde a otros datos.");
      return {status:generation?.status ?? "failed",duplicate:true};
    }
    if (generation?.status === "running") throw new ApiError(409,"report_in_progress","El análisis anterior sigue en curso.");
    if (current.analysis_meta?.findings_batch) throw new ApiError(409,"report_already_finalized","El caso ya tiene hallazgos finales; conserva esa versión.");
    const provider = maritimeReportConfig();
    if (!options.generate && !provider.configured) throw new ApiError(503,"report_not_configured","Falta configurar Maritime en el servidor web.");
    const meta = {...current.analysis_meta,
      report_request:{run_id:input.request_id,sha256:digest},
      report_generation:{status:"running",provider:"maritime",run_id:input.request_id,model_id:provider.model},
      report_time_source:input.time_source,
      ...(demoAuthorized?{report_authorization:{source:"team_demo_web_configuration"}}:{}),
    };
    await tx`update incidents set started_at=${input.started_at},analysis_status='running',
      consent_snapshot=${tx.json({...consent,...(demoAuthorized?{report_storage:true,report_sharing:true}:{})} as postgres.JSONValue)},
      analysis_meta=${tx.json(meta as postgres.JSONValue)} where id=${id}`;
    return {status:"claimed",duplicate:false};
  });
  if (claim.duplicate) return {incident_id:id,request_id:input.request_id,status:claim.status,duplicate:true};

  try {
    const report = await (options.generate ?? generateMaritimeReport)(input.text);
    const risk = input.decision ? Math.round(input.decision.probabilidad*100) : null;
    await commitFindings(org,id,{
      schema_version:"pe-v1",run_id:input.request_id,revision:1,session_id:input.session_id,simulated:true,ended_at:input.ended_at,
      analysis:{risk_score:risk,verdict:report.signals.length||input.decision?.alerta?"suspicious":"none",
        risk_reasons:report.signals.map(signal=>signal.explanation),summary:report.summary,recommendation:report.recommendation,
        scam_type:report.modality,impersonating:null,model_id:report.generation.model_id,
        generation:{...report.generation,status:"completed",generation_id:input.request_id,limitations:report.limitations}},
      signals:report.signals,entities:report.entities,
    },actor,sql);
    return {incident_id:id,request_id:input.request_id,status:"completed",duplicate:false};
  } catch (error) {
    const candidate = (error as {code?:string})?.code ?? "";
    const code = /^report_[a-zA-Z0-9_]+$/.test(candidate) ? candidate : "report_generation_failed";
    const failed = {status:"failed",provider:"maritime",run_id:input.request_id,error_code:code};
    await sql`update incidents set analysis_status='failed',analysis_meta=jsonb_set(analysis_meta,'{report_generation}',${sql.json(failed)})
      where id=${id} and org_id=${org} and analysis_meta->'report_generation'->>'run_id'=${input.request_id}
      and analysis_meta->'report_generation'->>'status'='running'`;
    if (error instanceof ApiError) throw error;
    throw new ApiError(502,code,"No se pudo generar el resumen. El caso requiere revisión.");
  } finally { input.text = ""; }
}
