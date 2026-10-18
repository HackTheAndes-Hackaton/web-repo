import Link from "next/link";
import type { ReactNode } from "react";
import { Check, Clock, FolderOpen, Hash, Mic, ShieldAlert } from "lucide-react";
import { addNoteAction, reviewLink, setAnalystStatus } from "@/app/actions";
import { fmtDateTime, fmtDuration, pct } from "@/lib/format";
import { caseCode, type IncidentDetail } from "@/lib/repo";
import { channelLabel, type AnalystStatus } from "@/lib/types";
import { EntityTable, RiskMeter, SignalList, Timeline } from "./incident-parts";
import { LinkReasons, LinkStatusTag } from "./links-ui";
import { PrintButton } from "./PrintButton";
import { buttonCls, Card, Empty, PageHeader, Pill, RiskBadge, Tag, VerdictBadge } from "./ui";

const NOTE_KIND = { correccion: "Corrección", observacion: "Observación", conclusion: "Conclusión revisada" };
const STEPS: { value: AnalystStatus; label: string }[] = [
  { value: "nuevo", label: "Nuevo" },
  { value: "en_revision", label: "En revisión" },
  { value: "cerrado", label: "Cerrado" },
];

export type ReportTab = "cronologia" | "datos" | "ia" | "revision";

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-start gap-3 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** Barra de estados del caso, al estilo de los gestores de incidentes. */
function StatusStepper({ incidentId, current }: { incidentId: string; current: AnalystStatus }) {
  const idx = STEPS.findIndex((s) => s.value === current);
  return (
    <ol className="flex flex-wrap items-center rounded-full bg-surface p-1 text-xs shadow-soft ring-1 ring-line">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s.value} className="flex items-center">
            {i > 0 && <span className="mx-0.5 text-muted" aria-hidden>›</span>}
            <form action={setAnalystStatus.bind(null, incidentId, s.value)}>
              <button
                aria-current={active ? "step" : undefined}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${
                  active
                    ? "bg-brand font-semibold text-white shadow-glow"
                    : done
                      ? "text-fg-2 hover:bg-surface-2"
                      : "text-muted hover:bg-surface-2"
                }`}
              >
                {done && <Check size={12} aria-hidden />}
                {s.label}
              </button>
            </form>
          </li>
        );
      })}
    </ol>
  );
}

export function IncidentReport({ detail, tab = "cronologia" }: { detail: IncidentDetail; tab?: ReportTab }) {
  const { incident, segments, signals, entities, actions, notes, voiceSamples, owner, sharedOrg, links } = detail;
  const here = `/panel/casos/${incident.id}`;

  const tabs: { id: ReportTab; label: string; count?: number }[] = [
    { id: "cronologia", label: "Cronología", count: segments.length },
    { id: "datos", label: "Datos observados", count: entities.length },
    { id: "ia", label: "Inferencias de la IA", count: signals.length },
    { id: "revision", label: "Revisión humana", count: notes.length },
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
              className={`mt-1 grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white ${
                incident.risk_level === "alto"
                  ? "bg-danger shadow-glow-critical"
                  : incident.risk_level === "medio"
                    ? "bg-warning"
                    : "bg-safe"
              }`}
            >
              <ShieldAlert size={24} aria-hidden />
            </span>
            <span>
              <span className="tabular block text-xs font-medium text-muted">Caso {caseCode(incident.id)}</span>
              {incident.title}
            </span>
          </span>
        }
        meta={
          <>
            <StatusStepper incidentId={incident.id} current={incident.analyst_status} />
            <RiskBadge level={incident.risk_level} score={incident.risk_score} />
            <VerdictBadge verdict={incident.verdict} />
            <Pill icon={<Clock size={12} aria-hidden />}>
              {incident.status === "en_curso" ? "En curso · " : ""}
              {fmtDuration(incident.started_at, incident.ended_at)}
            </Pill>
            <Pill icon={<Mic size={12} aria-hidden />}>{channelLabel(incident.channel)}</Pill>
            {incident.external_id && <Pill icon={<Hash size={12} aria-hidden />}>{incident.external_id}</Pill>}
          </>
        }
        actions={<PrintButton />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-3xl bg-surface p-5 shadow-soft sm:p-6">
            {incident.summary && <p className="text-[15px] leading-relaxed text-fg">{incident.summary}</p>}
            {incident.recommendation && (
              <p className="mt-4 rounded-2xl bg-accent-wash px-4 py-3 text-sm text-accent-ink">
                <strong>Recomendación mostrada:</strong> {incident.recommendation}
              </p>
            )}
            <p className="mt-3 text-xs text-muted">
              El reporte separa datos observados, inferencias de la IA y conclusiones revisadas. Puede apoyar la
              preparación de una denuncia; no es una denuncia presentada ni una atribución verificada de identidad.
            </p>
          </section>

          <nav
            className="no-print flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-soft ring-1 ring-line"
            aria-label="Secciones del reporte"
          >
            {tabs.map((t) => (
              <Link
                key={t.id}
                href={`${here}?tab=${t.id}`}
                scroll={false}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm ${
                  tab === t.id ? "bg-brand font-semibold text-white shadow-glow" : "text-fg-2 hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span
                    className={`tabular rounded-full px-1.5 text-[11px] font-bold ${
                      tab === t.id ? "bg-white/25 text-white" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          {tab === "cronologia" && (
            <div>
              <p className="mb-4 text-xs text-muted">
                Transcripción automática (puede contener errores). Debajo de cada fragmento, las señales que infirió la IA.
              </p>
              <Timeline segments={segments} signals={signals} />
            </div>
          )}

          {tab === "datos" && (
            <Card title="Números, cuentas y nombres">
              <EntityTable entities={entities} />
            </Card>
          )}

          {tab === "ia" && (
            <SignalList signals={signals} segments={segments} segmentHref={(id) => `${here}?tab=cronologia#seg-${id}`} />
          )}

          {tab === "revision" && (
            <Card title="Correcciones y conclusiones revisadas">
              {notes.length ? (
                <ul className="mb-4 space-y-3">
                  {notes.map((n) => (
                    <li key={n.id} className="rounded-2xl bg-surface-2/70 p-4 text-sm">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Tag tone={n.kind === "conclusion" ? "accent" : "neutral"}>{NOTE_KIND[n.kind]}</Tag>
                        {n.author_name} · {fmtDateTime(n.created_at)}
                      </div>
                      <p className="whitespace-pre-wrap">{n.text}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mb-4">
                  <Empty>Sin correcciones ni conclusiones todavía.</Empty>
                </div>
              )}
              <form action={addNoteAction.bind(null, incident.id)} className="no-print space-y-2">
                <div className="flex flex-wrap gap-3 text-sm">
                  {(["observacion", "conclusion", "correccion"] as const).map(
                    (k, i) => (
                      <label key={k} className="flex items-center gap-1.5">
                        <input type="radio" name="kind" value={k} defaultChecked={i === 0} />
                        {NOTE_KIND[k]}
                      </label>
                    ),
                  )}
                </div>
                <textarea
                  name="text"
                  required
                  rows={3}
                  placeholder="Ej.: se corroboró con el banco que la cuenta fue reportada."
                  className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
                <button className={buttonCls.secondary}>Agregar</button>
              </form>
            </Card>
          )}
        </div>

        <aside className="h-fit space-y-0 rounded-3xl bg-surface p-5 shadow-soft sm:p-6">
          <section className="pb-4">
            <RiskMeter score={incident.risk_score} level={incident.risk_level} />
          </section>

          <SideSection title="Propiedades">
            <dl className="divide-y divide-line">
              <Property label="Persona">{owner?.name ?? "Sin registrar"}</Property>
              <Property label="Inicio">{fmtDateTime(incident.started_at)}</Property>
              <Property label="Fin">{incident.ended_at ? fmtDateTime(incident.ended_at) : "En curso"}</Property>
              <Property label="Canal">{channelLabel(incident.channel)}</Property>
              <Property label="Organización">{sharedOrg?.name ?? "—"}</Property>
              <Property label="ID externo">
                <span className="tabular break-all">{incident.external_id ?? "—"}</span>
              </Property>
              <Property label="Actualizado">{fmtDateTime(incident.updated_at)}</Property>
              <Property label="Muestras de voz">
                {voiceSamples}
                <span className="block text-xs text-muted">Dato biométrico sensible; similitud = pista, no identificación.</span>
              </Property>
            </dl>
          </SideSection>

            <SideSection title={`Casos relacionados (${links.length})`}>
              {links.length ? (
                <ul className="space-y-2">
                  {links.map((l) => {
                    const otherId = l.incident_a === incident.id ? l.incident_b : l.incident_a;
                    const otherTitle = l.incident_a === incident.id ? l.b_title : l.a_title;
                    return (
                      <li key={l.id} className="rounded-2xl bg-surface-2/70 p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/panel/casos/${otherId}`} className="flex gap-1.5 text-sm font-medium hover:underline">
                            <FolderOpen size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                            {otherTitle}
                          </Link>
                          <LinkStatusTag status={l.status} />
                        </div>
                        <div className="tabular mt-1 text-xs text-muted">Puntaje {pct(l.score)}</div>
                        <LinkReasons reasons={l.reasons} />
                        {l.status === "pendiente" && (
                          <div className="no-print mt-2 flex gap-2">
                            <form action={reviewLink.bind(null, l.id, "confirmado")}>
                              <button className="bg-brand rounded-full px-3 py-1 text-xs font-semibold text-white">
                                Confirmar
                              </button>
                            </form>
                            <form action={reviewLink.bind(null, l.id, "descartado")}>
                              <button className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-fg-2 ring-1 ring-line hover:bg-surface-2">
                                Descartar
                              </button>
                            </form>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted">No hay vínculos propuestos.</p>
              )}
            </SideSection>

          <SideSection title="Acciones y permisos">
            <ol className="space-y-2.5">
              {actions.map((a) => (
                <li key={a.id} className="relative border-l border-line pl-3 text-sm">
                  <span className="absolute top-1.5 -left-[4px] h-2 w-2 rounded-full bg-accent" aria-hidden />
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
