import { fmtDateTime } from "@/lib/format";
import { NETWORK_ORIGIN_UNAVAILABLE, readNetworkOrigin } from "@/lib/network-origin";
import type { Incident } from "@/lib/types";
import { Card } from "./ui";
import { InspectNetworkOriginButton } from "./InspectNetworkOriginButton";

export function NetworkOriginPanel({ incident }: { incident: Incident }) {
  const authorized = incident.consent_snapshot.network_metadata_storage === true && !incident.sharing_revoked_at;
  const origin = authorized ? readNetworkOrigin(incident.analysis_meta) : null;
  const inspection = origin?.inspection;
  return (
    <Card title="Procedencia de la llamada">
      <p className="text-sm text-fg-2">IP original del interlocutor: <strong>{inspection ? "No disponible en esta ruta" : "Sin comprobar"}</strong></p>
      {!authorized ? (
        <p className="mt-2 text-sm text-muted">La conservación de metadatos de red de este incidente no está autorizada.</p>
      ) : !origin ? (
        <p className="mt-2 text-sm text-muted">Pendiente de vincular la conferencia de Android con su llamada Vapi desde el servidor de llamadas.</p>
      ) : (
        <>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Llamada Android</dt><dd className="break-all">{origin.binding.client_call_id}</dd></div>
            <div><dt className="text-muted">Conferencia</dt><dd className="break-all">{origin.binding.conference_request_id}</dd></div>
            <div><dt className="text-muted">Llamada Vapi</dt><dd className="break-all">{origin.binding.vapi_call_id}</dd></div>
            <div><dt className="text-muted">Vinculada</dt><dd>{fmtDateTime(origin.binding.bound_at)}</dd></div>
          </dl>
          {inspection && (
            <>
              <p className="mt-4 text-sm text-fg-2">{NETWORK_ORIGIN_UNAVAILABLE}</p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">Fuente</dt><dd>Vapi · consulta de llamada</dd></div>
                <div><dt className="text-muted">Última consulta</dt><dd>{fmtDateTime(inspection.checked_at)}</dd></div>
                <div><dt className="text-muted">Proveedor / transporte</dt><dd>{inspection.call.phoneCallProvider ?? "No informado"} / {inspection.call.phoneCallTransport ?? "No informado"}</dd></div>
                <div><dt className="text-muted">Referencia</dt><dd className="break-all">{inspection.evidence_ref}</dd></div>
                {inspection.call.customer?.number && <div><dt className="text-muted">Número observado por Vapi</dt><dd className="break-all">{inspection.call.customer.number}</dd></div>}
              </dl>
            </>
          )}
          <p className="mt-3 text-xs text-muted">Vapi participa en la segunda llamada de la conferencia. El número que observa puede ser el del usuario protegido; no acredita el número original ni la ubicación del interlocutor.</p>
          <InspectNetworkOriginButton incidentId={incident.id} />
        </>
      )}
    </Card>
  );
}
