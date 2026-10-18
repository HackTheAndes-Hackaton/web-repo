import { z } from "zod";

const reference = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
export const networkBindingInput = z.object({
  client_call_id: reference,
  conference_request_id: z.uuid(),
  vapi_call_id: z.uuid(),
  route: z.literal("android_sim_conference"),
}).strict();

export const vapiCallMetadata = z.object({
  id: z.uuid(),
  type: z.string().max(80).optional(),
  status: z.string().max(80).optional(),
  phoneCallProvider: z.string().max(80).nullish(),
  phoneCallProviderId: z.string().max(200).nullish(),
  phoneCallTransport: z.string().max(40).nullish(),
  startedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  endedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  customer: z.object({ number: z.string().max(100).nullish() }).nullish(),
});

export const networkOriginSchema = z.object({
  version: z.literal(1),
  binding: networkBindingInput.extend({
    bound_at: z.iso.datetime({ offset: true }),
    bound_by: reference,
  }),
  inspection: z.object({
    checked_at: z.iso.datetime({ offset: true }),
    source: z.literal("vapi_get_call"),
    evidence_ref: z.string().regex(/^\/call\/[a-f0-9-]{36}$/i),
    availability: z.literal("unavailable"),
    reason: z.literal("original_endpoint_not_exposed"),
    endpoint_ip: z.null(),
    call: vapiCallMetadata,
  }).nullable(),
});

export type NetworkOrigin = z.infer<typeof networkOriginSchema>;

/** Nunca interpreta IPs libres, cabeceras, SDP, URLs ni salidas del modelo. */
export function readNetworkOrigin(meta: Record<string, unknown>): NetworkOrigin | null {
  const parsed = networkOriginSchema.safeParse(meta.network_origin);
  return parsed.success ? parsed.data : null;
}

export const NETWORK_ORIGIN_UNAVAILABLE = "La conferencia telefónica no expone la IP original del interlocutor en los metadatos consultados.";
