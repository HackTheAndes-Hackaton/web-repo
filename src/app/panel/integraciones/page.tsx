import { headers } from "next/headers";
import { revokeApiKeyAction } from "@/app/actions";
import { Card, Empty, PageHeader, Tag } from "@/components/ui";
import { listApiKeys } from "@/lib/api-keys";
import { RESOURCES } from "@/lib/api/resources";
import { fmtDateTime } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { CreateKeyForm } from "./CreateKeyForm";

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 text-xs leading-relaxed text-fg">
      <code>{children}</code>
    </pre>
  );
}

const FLOW = (base: string) => [
  {
    title: "1. Crear el incidente cuando empieza la llamada",
    code: `curl -X POST ${base}/incidents \\
  -H "Authorization: Bearer $CENTINELA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"external_id":"llamada-8841","org_id":"org_uav","title":"Llamada entrante","channel":"llamada"}'`,
  },
  {
    title: "2. Enviar la transcripción (uno o varios fragmentos)",
    code: `curl -X POST ${base}/incidents/{id}/segments \\
  -H "Authorization: Bearer $CENTINELA_API_KEY" -H "Content-Type: application/json" \\
  -d '[{"speaker":"interlocutor","t_offset":4,"text":"Soy tu sobrino, cambié de número."}]'`,
  },
  {
    title: "3. Registrar señales y datos detectados por la IA",
    code: `curl -X POST ${base}/incidents/{id}/signals \\
  -H "Authorization: Bearer $CENTINELA_API_KEY" -H "Content-Type: application/json" \\
  -d '[{"type":"suplantacion","evidence":"Soy tu sobrino","explanation":"Se presenta como familiar sin forma de verificarlo.","confidence":0.8}]'

curl -X POST ${base}/incidents/{id}/entities \\
  -H "Authorization: Bearer $CENTINELA_API_KEY" -H "Content-Type: application/json" \\
  -d '[{"kind":"telefono","value":"55 2841 7730","provenance":"mostrado"}]'`,
  },
  {
    title: "4. Cerrar el incidente con el riesgo final",
    code: `curl -X PATCH ${base}/incidents/{id} \\
  -H "Authorization: Bearer $CENTINELA_API_KEY" -H "Content-Type: application/json" \\
  -d '{"status":"finalizado","ended_at":"2026-10-17T19:05:00Z","risk_score":82,"summary":"Posible suplantación con solicitud de dinero."}'`,
  },
];

export default async function Integrations() {
  await requireAnalyst();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const base = `${origin}/api/v1`;
  const keys = await listApiKeys();

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/panel", label: "Análisis" },
          { href: "/panel/integraciones", label: "Integraciones" },
        ]}
        title="Integraciones"
        description="El servidor de llamadas y el servicio de IA envían sus datos a esta API. Cada servicio usa su propia clave."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Claves de API">
            <CreateKeyForm />
            <div className="mt-5 overflow-x-auto">
              {keys.length ? (
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Nombre</th>
                      <th className="py-2 pr-3 font-medium">Clave</th>
                      <th className="py-2 pr-3 font-medium">Último uso</th>
                      <th className="py-2 pr-3 font-medium">Estado</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id} className="border-b border-line last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{k.name}</td>
                        <td className="tabular py-2.5 pr-3 text-fg-2">{k.prefix}…</td>
                        <td className="py-2.5 pr-3 text-fg-2">{k.last_used_at ? fmtDateTime(k.last_used_at) : "Nunca"}</td>
                        <td className="py-2.5 pr-3">
                          {k.revoked_at ? <Tag>Revocada</Tag> : <Tag tone="good">Activa</Tag>}
                        </td>
                        <td className="py-2.5 text-right">
                          {!k.revoked_at && (
                            <form action={revokeApiKeyAction.bind(null, k.id)}>
                              <button className="rounded-md px-2 py-1 text-xs text-critical-ink hover:bg-critical-wash">
                                Revocar
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>Aún no hay claves. Crea una para cada servicio que enviará datos.</Empty>
              )}
            </div>
          </Card>

          <Card title="Flujo típico desde el servidor de llamadas o la IA">
            <div className="space-y-4">
              {FLOW(base).map((step) => (
                <div key={step.title}>
                  <h3 className="mb-1.5 text-sm font-medium">{step.title}</h3>
                  <Code>{step.code}</Code>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted">
              Cada envío actualiza el panel en vivo y recalcula los vínculos del incidente. Los POST aceptan un objeto o un
              arreglo de hasta 500 elementos.
            </p>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Conexión">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted">URL base</dt>
                <dd className="tabular break-all font-medium">{base}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Autenticación</dt>
                <dd className="text-fg-2">
                  <code className="text-xs">Authorization: Bearer cen_…</code> o <code className="text-xs">X-API-Key: cen_…</code>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Especificación</dt>
                <dd>
                  <a href="/api/v1/openapi.json" className="font-medium text-accent-ink hover:underline">
                    openapi.json
                  </a>{" "}
                  <span className="text-xs text-muted">(importable en Postman o Swagger)</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Errores</dt>
                <dd className="text-xs text-fg-2">
                  <code>{`{ "error": { "code", "message", "details" } }`}</code> con 401, 404, 409 o 422.
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Recursos">
            <ul className="divide-y divide-line text-sm">
              {RESOURCES.map((r) => (
                <li key={r.name} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{r.title}</span>
                    <code className="text-xs text-muted">/{r.name}</code>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-2">{r.description}</p>
                  {r.childOfIncident && (
                    <code className="mt-1 block text-[11px] text-muted">/incidents/{"{id}"}/{r.name}</code>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
