import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, FolderOpen, Minus, Network, ShieldAlert, ShieldX, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { IncidentsByDayChart, SignalBarChart } from "@/components/charts";
import { LinkGraph } from "@/components/LinkGraph";
import { CallerNumber, Card, Empty, IconBubble, PulsingShield, RiskBadge, ScamTypeChip } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { bucketByCaller } from "@/lib/caller-buckets";
import { caseCode, dashboardData } from "@/lib/repo";
import { ENTITY_LABELS, SIGNAL_LABELS, scamTypeLabel, type EntityKind, type SignalType } from "@/lib/types";

function Delta({ now, prev }: { now: number; prev: number }) {
  const diff = now - prev;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-2">
      <Icon size={13} aria-hidden />
      <span className="tabular font-medium text-fg">
        {diff > 0 ? "+" : ""}
        {diff}
      </span>
      vs. 7 días anteriores
    </span>
  );
}

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
    <div className="rounded-3xl bg-surface p-5 shadow-soft">
      <IconBubble tone={tone}>{icon}</IconBubble>
      <div className="mt-4 text-4xl font-bold tracking-tight">{value}</div>
      <div className="mt-0.5 text-sm font-medium text-fg-2">{label}</div>
      <div className="mt-2">{footer}</div>
    </div>
  );
}

/** Lista con barra proporcional, como la distribución por riesgo. */
function CountList({
  items,
  total,
  empty,
  label,
}: {
  items: { value: string; n: number }[];
  total: number;
  empty: string;
  label?: (v: string) => string;
}) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-3">
      {items.slice(0, 6).map((it) => (
        <li key={it.value}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-fg">{label ? label(it.value) : it.value}</span>
            <span className="tabular shrink-0 font-semibold">{it.n}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand" style={{ width: `${(it.n / total) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function Dashboard() {
  const { orgId } = await requireAnalyst();
  const data = await dashboardData(orgId);
  const byDay = data.byDay.map((d) => ({ ...d, label: fmtDay(d.day) }));
  const signals = data.signalCounts.map((s) => ({ label: SIGNAL_LABELS[s.type as SignalType] ?? s.type, n: s.n }));
  const total = data.kpis.total || 1;
  // La red solo muestra casos con al menos una conexión; los casos sueltos no aportan al gráfico.
  const linkedIds = new Set(data.links.flatMap((l) => [l.incident_a, l.incident_b]));
  const linked = data.incidents.filter((i) => linkedIds.has(i.id));

  return (
    <>
      <section className="bg-brand relative overflow-hidden rounded-[2rem] px-6 pt-7 pb-20 text-white shadow-glow sm:px-9">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0 max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-widest text-white/70">Análisis</div>
            <h1 className="mt-1 text-4xl font-bold tracking-tight">Resumen</h1>
            <p className="mt-2 text-sm text-white/85">
              Incidentes que sus titulares decidieron compartir con esta organización, analizados por la IA. Los vínculos
              son hipótesis de la IA, no atribuciones de identidad.
            </p>
            <div className="no-print mt-5 flex flex-wrap items-center gap-2">
              <span className="bg-glass inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 ring-white/25">
                Últimos 14 días
              </span>
              <Link
                href="/panel/vinculos"
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-accent-ink shadow-soft hover:bg-accent-wash"
              >
                <Network size={15} aria-hidden />
                Ver vínculos
              </Link>
            </div>
          </div>
          <div className="hidden sm:block">
            <PulsingShield size={150} />
          </div>
        </div>
      </section>

      <section aria-label="Indicadores" className="relative -mt-14 grid grid-cols-2 gap-4 px-2 sm:px-4 lg:grid-cols-4">
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
          icon={<ShieldX size={18} aria-hidden />}
          tone="warning"
          label="Estafas detectadas"
          value={data.kpis.scams}
          footer={<span className="text-xs text-muted">Veredicto de la IA</span>}
        />
        <Kpi
          icon={<Network size={18} aria-hidden />}
          tone="good"
          label="Grupos de casos"
          value={data.kpis.groups}
          footer={<span className="text-xs text-muted">{data.kpis.links} conexiones entre casos</span>}
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

        <Card title="Tipos de estafa">
          <CountList
            items={data.scamTypes}
            total={total}
            empty="La IA todavía no clasificó tipos de estafa."
            label={(v) => scamTypeLabel(v) ?? v}
          />
          {data.impersonated.length > 0 && (
            <>
              <h3 className="mt-6 mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-widest text-muted">
                <UserRound size={13} aria-hidden />
                SE HACEN PASAR POR
              </h3>
              <CountList items={data.impersonated} total={total} empty="" />
            </>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Señales más frecuentes" className="lg:col-span-2">
          {signals.length ? <SignalBarChart data={signals} /> : <Empty>Sin señales todavía.</Empty>}
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

      <div className="mt-6">
        <Card
          title="Red de posibles vínculos"
          action={
            <Link href="/panel/vinculos" className="text-xs font-medium text-accent-ink hover:underline">
              Ver todos →
            </Link>
          }
        >
          {linked.length ? (
            <LinkGraph incidents={linked} links={data.links} />
          ) : (
            <Empty>La IA todavía no detectó vínculos entre casos.</Empty>
          )}
        </Card>
      </div>

      <section className="mt-6 overflow-hidden rounded-3xl bg-surface shadow-soft">
        <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <h2 className="text-[15px] font-bold">Casos recientes</h2>
          <Link href="/panel/casos" className="text-xs font-medium text-accent-ink hover:underline">
            Ver todos →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-surface-2/70 text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium sm:px-5">Caso</th>
                <th className="px-4 py-2.5 font-medium">Tipo de estafa</th>
                <th className="px-4 py-2.5 font-medium">Número</th>
                <th className="px-4 py-2.5 font-medium">Riesgo</th>
              </tr>
            </thead>
            <tbody>
              {bucketByCaller(data.incidents).slice(0, 5).map((b) => {
                const i = b.worst;
                const many = b.cases.length > 1;
                const types = [...new Set(b.cases.map((c) => c.scam_type).filter((t): t is string => Boolean(t)))];
                return (
                  <tr key={b.key} className="border-b border-line last:border-0 hover:bg-accent-wash/50">
                    <td className="px-4 py-3 sm:px-5">
                      {many ? (
                        <Link href={`/panel/casos?q=${b.digits}`} className="font-medium hover:underline">
                          {b.cases.length} llamadas del mismo número
                        </Link>
                      ) : (
                        <Link href={`/panel/casos/${i.id}`} className="font-medium hover:underline">
                          <span className="tabular mr-2 text-xs text-muted">{caseCode(i.id)}</span>
                          {i.title}
                        </Link>
                      )}
                      <div className="text-xs text-muted">{many ? "Última: " : ""}{fmtDateTime(b.cases[0].started_at)}</div>
                    </td>
                    <td className="px-4 py-3">
                      {types.length ? <ScamTypeChip type={types[0]} /> : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <CallerNumber incident={i} />
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge level={i.risk_level} score={i.risk_score} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
