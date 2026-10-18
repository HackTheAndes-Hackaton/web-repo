import "server-only";
import type postgres from "postgres";
import { db, newId, type Db, type Sql } from "../db";
import { emit } from "../events";
import { networkBindingInput, readNetworkOrigin, vapiCallMetadata, type NetworkOrigin } from "../network-origin";
import type { Incident } from "../types";
import { ApiError, notFound } from "./http";
import { getVapiCall } from "./vapi";

async function authorizedIncident(sql: Db, org: string, id: string, lock = false) {
  const [incident] = await sql<Incident[]>`select * from incidents where id=${id} and org_id=${org} ${lock ? sql`for update` : sql``}`;
  if (!incident) throw notFound("Incidente");
  if (incident.consent_snapshot.network_metadata_storage !== true || incident.sharing_revoked_at) {
    throw new ApiError(403, "network_storage_not_authorized", "La conservación de metadatos de red de este incidente no está autorizada.");
  }
  return incident;
}

async function audit(sql: Db, id: string, actor: string, kind: string, detail: string, payload: Record<string, unknown>) {
  await sql`insert into actions(id,incident_id,kind,detail,payload)
    values (${newId("act")},${id},${kind},${detail},${sql.json({ ...payload, service_or_analyst: actor } as postgres.JSONValue)})`;
}

export async function getNetworkOrigin(org: string, id: string, connection?: Sql) {
  const incident = await authorizedIncident(connection ?? await db(), org, id);
  return readNetworkOrigin(incident.analysis_meta);
}

/** Solo el backend que conoce ambos identificadores puede asociar la conferencia. */
export async function bindNetworkOrigin(org: string, id: string, value: unknown, actor: string, connection?: Sql) {
  const input = networkBindingInput.parse(value);
  const sql = connection ?? await db();
  const result = await sql.begin(async (tx) => {
    // Serializa incluso asociaciones concurrentes hacia incidentes distintos.
    for (const key of [`vapi:${input.vapi_call_id}`, `conference:${input.conference_request_id}`].sort()) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${key},0))`;
    }
    const incident = await authorizedIncident(tx, org, id, true);
    if (incident.client_call_id !== input.client_call_id) {
      throw new ApiError(409, "call_correlation_mismatch", "El identificador de Android debe coincidir con el registrado en el incidente.");
    }
    const [other] = await tx`select id from incidents where id<>${id} and (
      analysis_meta #>> '{network_origin,binding,vapi_call_id}'=${input.vapi_call_id}
      or analysis_meta #>> '{network_origin,binding,conference_request_id}'=${input.conference_request_id}
      or provider_call_id=${input.vapi_call_id}
      or (org_id=${org} and client_call_id=${input.client_call_id})
    ) limit 1`;
    if (other) throw new ApiError(409, "call_already_bound", "Una de las llamadas ya corresponde a otro incidente. Revisa la asociación.");
    const existing = readNetworkOrigin(incident.analysis_meta);
    if (!existing && Object.hasOwn(incident.analysis_meta, "network_origin")) {
      throw new ApiError(409, "binding_conflict", "Los metadatos de origen existentes requieren revisión antes de vincular otra llamada.");
    }
    if (existing) {
      if (Object.entries(input).some(([key, v]) => existing.binding[key as keyof typeof input] !== v)) {
        throw new ApiError(409, "binding_conflict", "La llamada ya tiene otra asociación. No se reemplaza automáticamente.");
      }
      return existing;
    }
    const origin: NetworkOrigin = {
      version: 1, binding: { ...input, bound_at: new Date().toISOString(), bound_by: actor }, inspection: null,
    };
    await tx`update incidents set analysis_meta=jsonb_set(coalesce(analysis_meta,'{}'::jsonb),'{network_origin}',${tx.json(origin)},true), updated_at=now() where id=${id}`;
    await audit(tx, id, actor, "network_origin_binding", "Conferencia vinculada a su llamada Vapi; origen IP pendiente de consultar.", {
      client_call_id: input.client_call_id, conference_request_id: input.conference_request_id, vapi_call_id: input.vapi_call_id,
    });
    return origin;
  });
  emit({ type: "incident", orgId: org, incidentId: id });
  return result;
}

export async function inspectNetworkOrigin(org: string, id: string, actor: string, connection?: Sql, lookup = getVapiCall) {
  const sql = connection ?? await db();
  const incident = await authorizedIncident(sql, org, id);
  const origin = readNetworkOrigin(incident.analysis_meta);
  if (!origin) throw new ApiError(409, "call_not_bound", "Primero vincula la conferencia y la llamada Vapi desde el backend.");
  const call = vapiCallMetadata.parse(await lookup(origin.binding.vapi_call_id));
  if (call.id !== origin.binding.vapi_call_id) throw new ApiError(502, "vapi_invalid_response", "La respuesta no corresponde a la llamada vinculada.");
  const result = await sql.begin(async (tx) => {
    // Revalida permisos y asociación después de la consulta externa.
    const current = await authorizedIncident(tx, org, id, true);
    const bound = readNetworkOrigin(current.analysis_meta);
    if (!bound || JSON.stringify(bound.binding) !== JSON.stringify(origin.binding) || current.client_call_id !== bound.binding.client_call_id) {
      throw new ApiError(409, "binding_conflict", "La asociación de la llamada cambió durante la consulta.");
    }
    const next: NetworkOrigin = { ...bound, inspection: {
      checked_at: new Date().toISOString(), source: "vapi_get_call", evidence_ref: `/call/${call.id}`,
      availability: "unavailable", reason: "original_endpoint_not_exposed", endpoint_ip: null, call,
    } };
    await tx`update incidents set analysis_meta=jsonb_set(coalesce(analysis_meta,'{}'::jsonb),'{network_origin}',${tx.json(next)},true), updated_at=now() where id=${id}`;
    await audit(tx, id, actor, "network_origin_check", "Metadatos de Vapi consultados. IP original del interlocutor no disponible en esta ruta.", {
      vapi_call_id: call.id, checked_at: next.inspection!.checked_at, source: "vapi_get_call", availability: "unavailable",
    });
    return next;
  });
  emit({ type: "incident", orgId: org, incidentId: id });
  return result;
}
