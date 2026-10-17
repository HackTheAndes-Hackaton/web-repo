import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  FolderOpen,
  Inbox,
  Minus,
  Network,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { IncidentsByDayChart, SignalBarChart } from "@/components/charts";
import { LinkGraph } from "@/components/LinkGraph";
import { LinkReasons } from "@/components/links-ui";
import { Card, Empty, IconBubble, RiskBadge, RiskIcon, SignalChip } from "@/components/ui";
import { fmtDateTime, fmtDay, pct } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { caseCode, dashboardData } from "@/lib/repo";
import { ENTITY_LABELS, SIGNAL_LABELS, type AnalystStatus, type EntityKind, type SignalType } from "@/lib/types";

const RISK_NAME = { alto: "Alto", medio: "Medio", bajo: "Bajo" };
const STATUS_LABEL: Record<AnalystStatus, string> = { nuevo: "Nuevo", en_revision: "En revisión", cerrado: "Cerrado" };

function Delta({ now, prev }: { now: number; prev: number }) {
  const diff = now - prev;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <Icon size={13} aria-hidden />
      <span className="tabular font-semibold text-fg">
        {diff > 0 ? "+" : ""}
        {diff}
      </span>
      vs. 7 días anteriores
    </span>
  );
}

/** Tarjeta de indicador como StatCard de la app: ícono en círculo, número grande y etiqueta. */
function Kpi({
  icon,
  tone,
  label,
  value,
  footer,
}: {
  icon: ReactNode;
  tone: "accent" | "good" | "warning" | "critical";
  label: string;
  value: number;
  footer: ReactNode;
}) {
  return (
    <div className="rounded-[22px] bg-surface p-4 shadow-soft sm:p-5">
      <IconBubble tone={tone}>{icon}</IconBubble>
      <div className="mt-3 text-[28px] font-bold leading-none tracking-tight">{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
      <div className="mt-2">{footer}</div>
    </div>
  );
}

function AttentionRow({ href, icon, label, count }: { href: string; icon: ReactNode; label: string; count: number }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 text-sm hover:bg-accent-wash">
        {icon}
        <span className="flex-1 text-fg-2">{label}</span>
        <span className="tabular font-medium">{count}</span>
        <ArrowRight size={14} className="text-muted" aria-hidden />
      </Link>
    </li>
  );
}

export default async function Dashboard() {
  const { orgId } = await requireAnalyst();
  const data = await dashboardData(orgId);
  const byDay = data.byDay.map((d) => ({ ...d, label: fmtDay(d.day) }));
  const signals = data.signalCounts.map((s) => ({ label: SIGNAL_LABELS[s.type as SignalType] ?? s.type, n: s.n }));
  const pending = data.links.filter((l) => l.status === "pendiente").slice(0, 3);
  const titleOf = new Map(data.incidents.map((i) => [i.id, i.title]));
  const total = data.kpis.total || 1;
  const reviewedPct = data.attention.closed / total;

  return (
    <>
      <section className="relative overflow-hidden rounded-[36px] bg-brand px-6 pt-7 pb-24 text-white sm:px-9 sm:pt-9">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="text-sm font-medium text-white/80">Panel de análisis</div>
            <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-tight">Resumen</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-white/85">
              Incidentes que sus titulares decidieron compartir con esta organización. Los vínculos son hipótesis para
              revisar, no atribuciones de identidad.
            </p>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/20 px-3.5 py-1.5 text-sm font-semibold">Últimos 14 días</span>
            <Link
              href="/panel/vinculos"
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-blue-100"
            >
              <Network size={16} aria-hidden />
              Revisar vínculos
            </Link>
          </div>
        </div>
      </section>

      <section aria-label="Indicadores" className="relative -mt-16 grid grid-cols-2 gap-3 px-3 sm:px-5 lg:grid-cols-4">
        <Kpi
          icon={<FolderOpen size={18} aria-hidden />}
          tone="accent"
          label="Casos compartidos"
          value={data.kpis.total}
          footer={<Delta now={data.period.cases.now} prev={data.period.cases.prev} />}
        />
        <Kpi
          icon={<ShieldAlert size={18} aria-hidden />}
          tone="critical"
          label="Riesgo alto"
          value={data.kpis.high}
          footer={<Delta now={data.period.high.now} prev={data.period.high.prev} />}
        />
        <Kpi
          icon={<Network size={18} aria-hidden />}
          tone="warning"
          label="Vínculos pendientes"
          value={data.kpis.pendingLinks}
          footer={<span className="text-xs text-muted">Esperan revisión humana</span>}
        />
        <Kpi
          icon={<CircleCheck size={18} aria-hidden />}
          tone="good"
          label="Vínculos confirmados"
          value={data.kpis.confirmedLinks}
          footer={<span className="text-xs text-muted">Posibles campañas</span>}
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Casos por día y nivel de riesgo" className="lg:col-span-2">
          <IncidentsByDayChart data={byDay} />
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted">Ver como tabla</summary>
            <table className="tabular mt-2 w-full text-left">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 font-medium">Día</th>
                  <th className="py-1 font-medium">Bajo</th>
                  <th className="py-1 font-medium">Medio</th>
                  <th className="py-1 font-medium">Alto</th>
                </tr>
              </thead>
              <tbody>
                {byDay
                  .filter((d) => d.bajo + d.medio + d.alto > 0)
                  .map((d) => (
                    <tr key={d.day} className="border-t border-line">
                      <td className="py-1">{d.label}</td>
                      <td>{d.bajo}</td>
                      <td>{d.medio}</td>
                      <td>{d.alto}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        </Card>

        <Card title="Requiere atención">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-fg-2">Casos cerrados</span>
            <span className="tabular text-sm font-medium">
              {data.attention.closed} de {data.kpis.total}
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-accent-wash"
            role="progressbar"
            aria-valuenow={Math.round(reviewedPct * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Casos cerrados"
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${reviewedPct * 100}%` }} />
          </div>
          <ul className="mt-4 space-y-0.5">
            <AttentionRow
              href="/panel/casos?riesgo=alto&estado=nuevo"
              icon={<ShieldAlert size={16} className="text-critical" aria-hidden />}
              label="Riesgo alto sin revisar"
              count={data.attention.newHigh}
            />
            <AttentionRow
              href="/panel/vinculos"
              icon={<Network size={16} className="text-warning-ink" aria-hidden />}
              label="Vínculos por confirmar"
              count={data.kpis.pendingLinks}
            />
            <AttentionRow
              href="/panel/casos?estado=nuevo"
              icon={<Inbox size={16} className="text-accent" aria-hidden />}
              label="Casos nuevos"
              count={data.attention.newCases}
            />
            <AttentionRow
              href="/panel/casos?estado=en_revision"
              icon={<TriangleAlert size={16} className="text-muted" aria-hidden />}
              label="En revisión"
              count={data.attention.inReview}
            />
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Distribución por riesgo">
          <ul className="space-y-3">
            {data.riskDist.map((r) => (
              <li key={r.level} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm">
                <span className="flex items-center gap-2 text-fg-2">
                  <RiskIcon level={r.level} />
                  {RISK_NAME[r.level]}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className={`block h-full rounded-full ${
                      r.level === "alto" ? "bg-critical" : r.level === "medio" ? "bg-warning" : "bg-good"
                    }`}
                    style={{ width: `${(r.n / total) * 100}%` }}
                  />
                </span>
                <span className="tabular w-16 text-right">
                  <span className="font-medium">{r.n}</span> <span className="text-xs text-muted">{pct(r.n / total)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            El riesgo es una estimación a partir de señales observadas, no una confirmación de engaño.
          </p>
        </Card>
        <Card title="Señales más frecuentes" className="lg:col-span-2">
          {signals.length ? <SignalBarChart data={signals} /> : <Empty>Sin señales todavía.</Empty>}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          title="Red de posibles vínculos"
          className="lg:col-span-2"
          action={
            <Link href="/panel/vinculos" className="text-xs font-medium text-accent-ink hover:underline">
              Abrir revisión →
            </Link>
          }
        >
          {data.incidents.length ? <LinkGraph incidents={data.incidents} links={data.links} /> : <Empty>No hay casos.</Empty>}
        </Card>
        <div className="space-y-6">
          <Card title="Pendientes de revisión">
            {pending.length ? (
              <ul className="space-y-3">
                {pending.map((l) => (
                  <li key={l.id}>
                    <Link href="/panel/vinculos" className="block rounded-2xl bg-surface-2 p-3.5 hover:bg-accent-wash">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted">Puntaje</span>
                        <span className="tabular text-xs font-medium">{pct(l.score)}</span>
                      </div>
                      <div className="mt-1 text-sm font-medium leading-snug">
                        {titleOf.get(l.incident_a)} <span className="text-muted">↔</span> {titleOf.get(l.incident_b)}
                      </div>
                      <LinkReasons reasons={l.reasons} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No hay vínculos pendientes.</Empty>
            )}
          </Card>
          <Card title="Datos repetidos entre casos">
            {data.repeatedEntities.length ? (
              <ul className="divide-y divide-line text-sm">
                {data.repeatedEntities.map((e) => (
                  <li key={`${e.kind}-${e.normalized}`} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="tabular truncate font-medium">{e.value}</div>
                      <div className="text-xs text-muted">{ENTITY_LABELS[e.kind as EntityKind] ?? e.kind}</div>
                    </div>
                    <span className="tabular shrink-0 rounded-full bg-accent-wash px-2 py-0.5 text-xs font-medium text-accent-ink">
                      {e.n} casos
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Ningún teléfono, cuenta o nombre se repite.</Empty>
            )}
            <p className="mt-3 text-xs text-muted">Un número o nombre puede ser falso: orienta, no identifica.</p>
          </Card>
        </div>
      </div>

      <section className="mt-6 overflow-hidden rounded-3xl bg-surface shadow-soft">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold">Casos recientes</h2>
          <Link href="/panel/casos" className="text-xs font-medium text-accent-ink hover:underline">
            Ver todos →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-y border-line bg-surface-2/60 text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2 font-medium sm:px-5">Caso</th>
                <th className="px-4 py-2 font-medium">Señales</th>
                <th className="px-4 py-2 font-medium">Riesgo</th>
                <th className="px-4 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.incidents.slice(0, 5).map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3 sm:px-5">
                    <Link href={`/panel/casos/${i.id}`} className="font-medium hover:underline">
                      <span className="tabular mr-2 text-xs text-muted">{caseCode(i.id)}</span>
                      {i.title}
                    </Link>
                    <div className="text-xs text-muted">
                      {fmtDateTime(i.started_at)} · {i.user_name}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {i.signal_types
                        ?.split(",")
                        .slice(0, 2)
                        .map((t) => <SignalChip key={t} type={t as SignalType} />)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <RiskBadge level={i.risk_level} score={i.risk_score} />
                  </td>
                  <td className="px-4 py-3 text-fg-2">{STATUS_LABEL[i.analyst_status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
