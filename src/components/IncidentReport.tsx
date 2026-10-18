import Link from "next/link";
import type { ReactNode } from "react";
import { Clock, Hash, ShieldAlert, UserRound, UserRoundSearch } from "lucide-react";
import { fmtDateTime, fmtDuration, fmtPhone, pct } from "@/lib/format";
import { caseCode, type IncidentDetail } from "@/lib/repo";
import { scamTypeLabel } from "@/lib/types";
import { ComplaintSheet, Conversation, EntityTable, RiskMeter, SignalList } from "./incident-parts";
import { commonTrait } from "./LinkGraph";
import { NetworkOriginPanel } from "./NetworkOriginPanel";
import { CallerNumber, Card, IconBubble, PageHeader, Pill, RiskBadge, ScamTypeChip, VerdictBadge } from "./ui";

export type ReportTab = "conversacion" | "ia" | "datos";

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

/** Lo justo para entender el caso de un vistazo: el resto está en Vínculos. */
const RELATED_SHOWN = 3;
const LOG_SHOWN = 5;

export function IncidentReport({ detail, tab = "ia" }: { detail: IncidentDetail; tab?: ReportTab }) {
  const { incident, transcript, signals, entities, actions, voiceSamples, owner, links, relatedGroup, relatedCases, suspect } = detail;
  const generation = incident.analysis_meta.report_generation as { status?: string } | undefined;
  const here = `/panel/casos/${incident.id}`;
  const number = fmtPhone(incident.caller_e164 ?? incident.caller_number_raw);
  const reasons = Array.isArray(incident.risk_reasons) ? incident.risk_reasons.filter((r) => typeof r === "string") : [];

  const tabs: { id: ReportTab; label: string; count: number }[] = [
    { id: "conversacion", label: "Conversación", count: transcript.length },
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
            {suspect && (
              <Link
                href={`/panel/vinculos#${suspect.id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-navy px-2.5 py-0.5 text-xs font-semibold text-white hover:brightness-125"
                title="Alias de registro: no identifica a una persona"
              >
                <UserRoundSearch size={12} aria-hidden />
                Presunto: {suspect.alias}
              </Link>
            )}
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
        actions={relatedGroup && relatedGroup.incidentIds.length >= 2 ?
          <Link href={`/panel/informes#${relatedGroup.anchor}`}
            className="inline-flex rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-2">
            Informe PDF del conjunto
          </Link> : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-3xl bg-surface p-6 shadow-soft">
            <h2 className="text-[17px] font-semibold">Resumen de la IA</h2>
            {(scamTypeLabel(incident.scam_type) || incident.impersonating) && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {scamTypeLabel(incident.scam_type) && (
                  <Fact icon={<ShieldAlert size={17} aria-hidden />} tone="critical" label="Tipo de estafa">
                    {scamTypeLabel(incident.scam_type)}
                  </Fact>
                )}
                {incident.impersonating && (
                  <Fact icon={<UserRound size={17} aria-hidden />} tone="warning" label="Se hace pasar por">
                    {incident.impersonating}
                  </Fact>
                )}
              </div>
            )}
            {generation?.status === "running" && <p className="mt-4 text-sm text-muted" role="status">Preparando el resumen automático.</p>}
            {generation?.status === "completed" && <p className="mt-4 text-xs text-muted">Resumen automático · pendiente de revisión humana.</p>}
            {generation?.status === "failed" && <p className="mt-4 text-sm text-warning-ink" role="status">No se pudo elaborar el resumen automático. El fallo no indica que la llamada sea segura.</p>}
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
            <p className="mt-4 text-xs text-muted">Análisis de la IA. El número o un nombre pueden ser falsos: no es una denuncia ni una identificación.</p>
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
            <>
            <Card title="Números, cuentas y nombres">
              <EntityTable entities={entities} />
            </Card>
            <NetworkOriginPanel incident={incident} />
            </>
          )}

          {tab === "ia" && <SignalList signals={signals} />}

          {tab === "conversacion" && (
            <Card title="Lo que se habló en la llamada">
              <Conversation lines={transcript} />
            </Card>
          )}
        </div>

        <aside className="space-y-0 lg:border-l lg:border-line lg:pl-6">
          <SideSection>
            <RiskMeter score={incident.risk_score} level={incident.risk_level} />
          </SideSection>

          <SideSection title="Para la denuncia (PNP)">
            <ComplaintSheet
              caller={number}
              startedAt={fmtDateTime(incident.started_at)}
              duration={fmtDuration(incident.started_at, incident.ended_at)}
              impersonating={incident.impersonating}
              entities={entities}
              keyLines={[
                ...transcript.filter((l) => l.flagged && l.speaker === "caller").map((l) => l.text),
                ...signals.map((s) => s.evidence).filter(Boolean),
              ]
                // Sin repetir: se omite un fragmento si ya aparece dentro de una frase elegida.
                .reduce<string[]>((kept, line) => (kept.some((k) => k.includes(line)) ? kept : [...kept, line]), [])
                .slice(0, 4)}
            />
          </SideSection>

          {(owner || incident.external_id || voiceSamples > 0 || incident.status === "en_curso") && (
            <SideSection title="Propiedades">
              <dl className="divide-y divide-line">
                {owner && <Property label="Persona">{owner.name}</Property>}
                {incident.status === "en_curso" && <Property label="Estado">En curso</Property>}
                {incident.external_id && (
                  <Property label="ID externo"><span className="tabular break-all">{incident.external_id}</span></Property>
                )}
                {voiceSamples > 0 && <Property label="Muestras de voz">{voiceSamples} · solo como pista</Property>}
              </dl>
            </SideSection>
          )}

          <SideSection title={`Red de casos (${relatedGroup?.incidentIds.length ?? 0})`}>
            {relatedGroup ? (
              <>
              {(() => {
                const trait = commonTrait(relatedGroup.links);
                return trait && <p className="mb-3 rounded-xl bg-accent-wash px-3 py-2 text-sm font-medium text-accent-ink">{trait}</p>;
              })()}
              <ul className="divide-y divide-line">
                {[...links].sort((a, b) => b.score - a.score).slice(0, RELATED_SHOWN).map((l) => {
                  const otherId = l.incident_a === incident.id ? l.incident_b : l.incident_a;
                  const other = relatedCases.find((c) => c.id === otherId);
                  return (
                    <li key={l.id}>
                      <Link href={`/panel/casos/${otherId}`} className="flex items-center gap-2 py-2 text-sm hover:text-accent-ink">
                        <span className="tabular shrink-0 font-semibold">{caseCode(otherId)}</span>
                        <span className="min-w-0 flex-1 truncate text-fg-2">{other?.title}</span>
                        <span className="tabular shrink-0 font-bold text-accent-ink">{pct(l.score)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <Link href={`/panel/vinculos#${relatedGroup.anchor}`} className="mt-2 inline-block text-sm font-semibold text-accent-ink hover:underline">
                {relatedCases.length > RELATED_SHOWN ? `Ver los ${relatedGroup.incidentIds.length} casos del grupo` : "Ver el grupo"} →
              </Link>
              </>
            ) : (
              <p className="text-sm text-muted">La IA no encontró casos relacionados.</p>
            )}
          </SideSection>

          <SideSection title="Registro">
            <ol className="space-y-2.5">
              {actions
                .filter((a) => a.kind !== "link_review")
                .slice(-LOG_SHOWN)
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
