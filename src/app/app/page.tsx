import Link from "next/link";
import { analysisEngine } from "@/lib/analysis";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { getActiveIncident, getIncidentDetail, listIncidentsForUser } from "@/lib/repo";
import { requireSession } from "@/lib/session";
import { CHANNEL_LABELS } from "@/lib/types";
import { RiskMeter, SignalList, Transcript } from "@/components/incident-parts";
import { Card, Empty, PageHeader, RiskBadge, Tag } from "@/components/ui";
import { Mic, Sparkles } from "lucide-react";
import { CaptureControls } from "./CaptureControls";

export default async function UserHome() {
  const session = await requireSession("usuario");
  const [active, all] = await Promise.all([getActiveIncident(session.userId), listIncidentsForUser(session.userId)]);
  const detail = active ? await getIncidentDetail(active.id, session) : null;
  const recent = all.filter((i) => i.status === "finalizado").slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hola, ${session.name.replace(/\s*\(.*\)/, "")}`}
        description="Activa la captura cuando una conversación te genere dudas. Tú decides qué se guarda y qué se comparte."
      />
      <div className="-mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Cómo funciona">
          <ul className="space-y-3 text-sm text-fg-2">
            <li className="flex gap-2.5">
              <Mic size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>
                Pon la llamada en altavoz cerca del teléfono y activa el micrófono. En el celular funciona mejor con Chrome.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>
                Análisis: <strong className="font-medium text-fg">{analysisEngine()}</strong>. Verás las señales y el
                motivo de cada alerta.
              </span>
            </li>
          </ul>
          <div className="mt-3">
            {active ? <Tag tone="accent">Captura en curso</Tag> : <Tag>En espera</Tag>}
          </div>
        </Card>

        <Card title={active ? "Captura en curso" : "Iniciar captura"} className="lg:col-span-2">
          <CaptureControls activeIncidentId={active?.id ?? null} activeChannel={active?.channel ?? null} />
        </Card>
      </div>

      {detail ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <RiskMeter score={detail.incident.risk_score} level={detail.incident.risk_level} />
              {detail.incident.risk_level !== "bajo" && detail.incident.recommendation && (
                <div
                  role="alert"
                  className={`mt-4 rounded-lg p-3 text-sm ${
                    detail.incident.risk_level === "alto"
                      ? "bg-critical-wash text-critical-ink"
                      : "bg-warning-wash text-warning-ink"
                  }`}
                >
                  <div className="font-semibold">
                    {detail.incident.risk_level === "alto" ? "■ Pausa y verifica" : "▲ Verifica antes de actuar"}
                  </div>
                  <p className="mt-1">{detail.incident.recommendation}</p>
                </div>
              )}
              {detail.incident.summary && <p className="mt-4 text-sm text-fg-2">{detail.incident.summary}</p>}
              <div className="mt-3 text-xs text-muted">
                {CHANNEL_LABELS[detail.incident.channel]} · {fmtDuration(detail.incident.started_at, null)}
              </div>
            </Card>
            <Card title={`Señales observadas (${detail.signals.length})`}>
              <SignalList signals={detail.signals} segments={detail.segments} />
            </Card>
          </div>
          <Card title="Transcripción en vivo" className="lg:col-span-3">
            <p className="mb-3 text-xs text-muted">La transcripción automática puede contener errores.</p>
            <Transcript segments={detail.segments} signals={detail.signals} />
          </Card>
        </div>
      ) : (
        <Card
          title="Reportes recientes"
          action={
            <Link href="/app/incidentes" className="text-xs font-medium text-accent-ink hover:underline">
              Ver todos →
            </Link>
          }
        >
          {recent.length ? (
            <ul className="divide-y divide-line">
              {recent.map((i) => (
                <li key={i.id}>
                  <Link href={`/app/incidentes/${i.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{i.title}</div>
                      <div className="text-xs text-muted">
                        {fmtDateTime(i.started_at)} · {i.signal_count} señales ·{" "}
                        {i.shared_org_id ? "Compartido" : "Privado"}
                      </div>
                    </div>
                    <RiskBadge level={i.risk_level} score={i.risk_score} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Todavía no tienes reportes.</Empty>
          )}
        </Card>
      )}
    </div>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
