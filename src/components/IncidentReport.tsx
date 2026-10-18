import Link from "next/link";
import type { ReactNode } from "react";
import { Clock, FolderOpen, Hash, Mic, PhoneIncoming, PhoneOutgoing, ShieldAlert, UserRound } from "lucide-react";
import { fmtDateTime, fmtDuration, fmtPhone, pct } from "@/lib/format";
import { caseCode, type IncidentDetail } from "@/lib/repo";
import { channelLabel, scamTypeLabel } from "@/lib/types";
import { EntityTable, RiskMeter, SignalList } from "./incident-parts";
import { LinkReasons } from "./links-ui";
import { PrintButton } from "./PrintButton";
import { CallerNumber, Card, IconBubble, PageHeader, Pill, RiskBadge, ScamTypeChip, VerdictBadge } from "./ui";

export type ReportTab = "ia" | "datos";

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-start gap-3 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function SideSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-0">
      {title && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>}
      {children}
    </section>
  );
}

/** Dato clave de la llamada, en una ficha con ícono. */
function Fact({
  icon,
  tone,
  label,
  children,
}: {
  icon: ReactNode;
  tone: "accent" | "critical" | "warning" | "good";
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[20px] bg-surface-2 p-4">
      <IconBubble tone={tone}>{icon}</IconBubble>
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="mt-0.5 text-[15px] font-semibold leading-snug">{children}</div>
      </div>
    </div>
  );
}

const DIRECTION = { incoming: "Llamada entrante", outgoing: "Llamada saliente" };

export function IncidentReport({ detail, tab = "ia" }: { detail: IncidentDetail; tab?: ReportTab }) {
  const { incident, signals, entities, actions, voiceSamples, owner, sharedOrg, links } = detail;
  const here = `/panel/casos/${incident.id}`;
  const number = fmtPhone(incident.caller_e164 ?? incident.caller_number_raw);
  const reasons = Array.isArray(incident.risk_reasons) ? incident.risk_reasons.filter((r) => typeof r === "string") : [];

  const tabs: { id: ReportTab; label: string; count: number }[] = [
    { id: "ia", label: "Señales de la IA", count: signals.length },
    { id: "datos", label: "Datos observados", count: entities.length },
  ];

  return (
    <article>
      <PageHeader
        crumbs={[
          { href: "/panel", label: "Análisis" },
          { href: "/panel/casos", label: "Casos" },
        ]}
        title={
          <span className="flex items-start gap-3">
            <span
              className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${
                incident.risk_level === "alto"
                  ? "bg-critical-wash text-critical"
                  : incident.risk_level === "medio"
                    ? "bg-warning-wash text-warning-ink"
                    : "bg-good-wash text-good-ink"
              }`}
            >
              <ShieldAlert size={20} aria-hidden />
            </span>
            <span>
              <span className="tabular block text-xs font-medium text-muted">Caso {caseCode(incident.id)}</span>
              {incident.title}
            </span>
          </span>
        }
        meta={
          <>
            <RiskBadge level={incident.risk_level} score={incident.risk_score} />
            <VerdictBadge verdict={incident.verdict} />
            <ScamTypeChip type={incident.scam_type} />
            <Pill>
              <CallerNumber incident={incident} />
            </Pill>
            <Pill icon={<Clock size={12} aria-hidden />}>
              {incident.status === "en_curso" ? "En curso · " : ""}
              {fmtDuration(incident.started_at, incident.ended_at)}
            </Pill>
            {incident.external_id && <Pill icon={<Hash size={12} aria-hidden />}>{incident.external_id}</Pill>}
          </>
        }
        actions={<PrintButton />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-3xl bg-surface p-6 shadow-soft">
            <h2 className="text-[17px] font-semibold">Resumen de la IA</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Fact icon={<ShieldAlert size={17} aria-hidden />} tone="critical" label="Tipo de estafa">
                {scamTypeLabel(incident.scam_type) ?? <span className="font-normal text-muted">Sin clasificar</span>}
              </Fact>
              <Fact icon={<UserRound size={17} aria-hidden />} tone="warning" label="Se hace pasar por">
                {incident.impersonating ?? <span className="font-normal text-muted">No identificado</span>}
              </Fact>
              <Fact
                icon={incident.direction === "outgoing" ? <PhoneOutgoing size={17} aria-hidden /> : <PhoneIncoming size={17} aria-hidden />}
                tone="accent"
                label={incident.direction ? DIRECTION[incident.direction] : "Número que llamó"}
              >
                {number ? <span className="tabular">{number}</span> : <span className="font-normal text-muted">No registrado</span>}
                {incident.caller_name && <span className="block text-sm font-normal text-fg-2">{incident.caller_name}</span>}
              </Fact>
              <Fact icon={<Mic size={17} aria-hidden />} tone="good" label="Canal">
                {channelLabel(incident.channel)}
              </Fact>
            </div>
            {incident.summary && <p className="mt-5 text-[15px] leading-relaxed text-fg">{incident.summary}</p>}
            {reasons.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {reasons.map((r) => (
                  <li key={r} className="rounded-full bg-critical-wash px-3 py-1 text-xs font-medium text-critical-ink">
                    {r}
                  </li>
                ))}
              </ul>
            )}
            {incident.recommendation && (
              <p className="mt-4 rounded-2xl bg-accent-wash px-4 py-3 text-sm text-accent-ink">
                <strong>Recomendación mostrada:</strong> {incident.recommendation}
              </p>
            )}
            <p className="mt-4 text-xs text-muted">
              Todo lo de este reporte lo generó la IA. El número mostrado o un nombre pueden ser falsos: puede apoyar la
              preparación de una denuncia, pero no es una denuncia ni una identificación verificada.
            </p>
          </section>

          <nav className="no-print flex gap-2 overflow-x-auto pb-1" aria-label="Secciones del reporte">
            {tabs.map((t) => (
              <Link
                key={t.id}
                href={`${here}?tab=${t.id}`}
                scroll={false}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm ${
                  tab === t.id
                    ? "bg-accent font-semibold text-white shadow-soft"
                    : "bg-surface text-fg-2 shadow-soft hover:text-accent-ink"
                }`}
              >
                {t.label}
                <span
                  className={`tabular rounded-full px-1.5 text-[11px] font-bold ${tab === t.id ? "bg-white/25 text-white" : "bg-accent-wash text-accent-ink"}`}
                >
                  {t.count}
                </span>
              </Link>
            ))}
          </nav>

          {tab === "datos" && (
            <Card title="Números, cuentas y nombres">
              <EntityTable entities={entities} />
            </Card>
          )}

          {tab === "ia" && <SignalList signals={signals} />}
        </div>

        <aside className="space-y-0 lg:border-l lg:border-line lg:pl-6">
          <SideSection>
            <RiskMeter score={incident.risk_score} level={incident.risk_level} />
          </SideSection>

          <SideSection title="Propiedades">
            <dl className="divide-y divide-line">
              <Property label="Persona">{owner?.name ?? "Sin registrar"}</Property>
              <Property label="Inicio">{fmtDateTime(incident.started_at)}</Property>
              <Property label="Fin">{incident.ended_at ? fmtDateTime(incident.ended_at) : "En curso"}</Property>
              <Property label="Organización">{sharedOrg?.name ?? "—"}</Property>
              <Property label="ID externo">
                <span className="tabular break-all">{incident.external_id ?? "—"}</span>
              </Property>
              <Property label="Muestras de voz">
                {voiceSamples}
                <span className="block text-xs text-muted">Dato biométrico sensible; similitud = pista, no identificación.</span>
              </Property>
            </dl>
          </SideSection>

          <SideSection title={`Casos relacionados (${links.length})`}>
            {links.length ? (
              <ul className="space-y-3">
                {links.map((l) => {
                  const isA = l.incident_a === incident.id;
                  const otherId = isA ? l.incident_b : l.incident_a;
                  return (
                    <li key={l.id}>
                      <Link href={`/panel/casos/${otherId}`} className="block rounded-2xl bg-surface-2 p-4 hover:bg-accent-wash">
                        <div className="flex items-start justify-between gap-2">
                          <span className="flex gap-1.5 text-sm font-semibold">
                            <FolderOpen size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                            {isA ? l.b_title : l.a_title}
                          </span>
                          <span className="tabular shrink-0 text-sm font-bold text-accent-ink">{pct(l.score)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <ScamTypeChip type={isA ? l.b_scam_type : l.a_scam_type} />
                        </div>
                        <LinkReasons reasons={l.reasons.filter((r) => !/guion/i.test(r.detail))} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">La IA no encontró casos relacionados.</p>
            )}
          </SideSection>

          <SideSection title="Registro">
            <ol className="space-y-2.5">
              {actions
                .filter((a) => a.kind !== "link_review")
                .map((a) => (
                  <li key={a.id} className="relative border-l border-line pl-3 text-sm">
                    <span className="absolute top-1.5 -left-[3px] h-1.5 w-1.5 rounded-full bg-line-strong" aria-hidden />
                    <div className="text-xs text-muted">{fmtDateTime(a.created_at)}</div>
                    <div className="text-fg-2">{a.detail}</div>
                  </li>
                ))}
            </ol>
          </SideSection>
        </aside>
      </div>
    </article>
  );
}
