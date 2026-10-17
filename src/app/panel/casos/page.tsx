import Link from "next/link";
import { CircleCheck, CircleDot, Inbox, Network, Search } from "lucide-react";
import { Empty, PageHeader, RiskBadge, SignalChip } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { caseCode, listLinks, listSharedIncidents } from "@/lib/repo";
import { CHANNEL_LABELS, type AnalystStatus, type SignalType } from "@/lib/types";
import { normalizeText } from "@/lib/heuristics";

const RISK_FILTERS = [
  { value: "", label: "Todos" },
  { value: "alto", label: "Alto" },
  { value: "medio", label: "Medio" },
  { value: "bajo", label: "Bajo" },
];
const STATUS_FILTERS = [
  { value: "", label: "Todos" },
  { value: "nuevo", label: "Nuevos" },
  { value: "en_revision", label: "En revisión" },
  { value: "cerrado", label: "Cerrados" },
];
const STATUS: Record<AnalystStatus, { label: string; Icon: typeof Inbox; cls: string }> = {
  nuevo: { label: "Nuevo", Icon: Inbox, cls: "text-accent" },
  en_revision: { label: "En revisión", Icon: CircleDot, cls: "text-warning-ink" },
  cerrado: { label: "Cerrado", Icon: CircleCheck, cls: "text-good-ink" },
};

type Params = { riesgo: string; estado: string; q: string };

function filterHref(current: Params, k: keyof Params, v: string) {
  const p = new URLSearchParams(Object.entries(current).filter(([, val]) => val));
  if (v) p.set(k, v);
  else p.delete(k);
  const q = p.toString();
  return q ? `/panel/casos?${q}` : "/panel/casos";
}

function FilterGroup({
  label,
  k,
  all,
  options,
}: {
  label: string;
  k: keyof Params;
  all: Params;
  options: typeof RISK_FILTERS;
}) {
  return (
    <div className="flex items-center rounded-full bg-surface p-1 text-xs shadow-soft ring-1 ring-line">
      <span className="px-2 font-medium text-muted">{label}</span>
      {options.map((o) => {
        const active = all[k] === o.value;
        return (
          <Link
            key={o.value}
            href={filterHref(all, k, o.value)}
            aria-current={active ? "true" : undefined}
            className={`rounded-full px-3 py-1 ${active ? "bg-brand font-semibold text-white shadow-glow" : "text-fg-2 hover:bg-surface-2"}`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

export default async function Cases({ searchParams }: PageProps<"/panel/casos">) {
  const { orgId } = await requireAnalyst();
  const sp = await searchParams;
  const params: Params = {
    riesgo: typeof sp.riesgo === "string" ? sp.riesgo : "",
    estado: typeof sp.estado === "string" ? sp.estado : "",
    q: typeof sp.q === "string" ? sp.q.trim() : "",
  };

  const linkCount = new Map<string, number>();
  const [links, all] = await Promise.all([listLinks(orgId), listSharedIncidents(orgId)]);
  for (const l of links) {
    if (l.status === "descartado") continue;
    linkCount.set(l.incident_a, (linkCount.get(l.incident_a) ?? 0) + 1);
    linkCount.set(l.incident_b, (linkCount.get(l.incident_b) ?? 0) + 1);
  }
  const needle = normalizeText(params.q);
  const incidents = all.filter(
    (i) =>
      (!params.riesgo || i.risk_level === params.riesgo) &&
      (!params.estado || i.analyst_status === params.estado) &&
      (!needle || normalizeText(`${i.title} ${i.user_name} ${caseCode(i.id)}`).includes(needle)),
  );
  const filtered = Boolean(params.riesgo || params.estado || params.q);

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/panel", label: "Análisis" },
          { href: "/panel/casos", label: "Casos" },
        ]}
        title="Casos compartidos"
        description="Cada caso llega solo cuando su titular autoriza compartirlo. Usa los filtros para priorizar la revisión."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form action="/panel/casos" className="relative min-w-56 flex-1 sm:max-w-xs">
          {params.riesgo && <input type="hidden" name="riesgo" value={params.riesgo} />}
          {params.estado && <input type="hidden" name="estado" value={params.estado} />}
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-accent" aria-hidden />
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Buscar por título, persona o código"
            aria-label="Buscar casos"
            className="w-full rounded-full bg-surface py-2 pr-4 pl-10 text-sm shadow-soft ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
          />
        </form>
        <FilterGroup label="Riesgo" k="riesgo" all={params} options={RISK_FILTERS} />
        <FilterGroup label="Estado" k="estado" all={params} options={STATUS_FILTERS} />
        {filtered && (
          <Link href="/panel/casos" className="px-2 text-xs font-medium text-accent-ink hover:underline">
            Limpiar
          </Link>
        )}
        <span className="tabular ml-auto text-xs text-muted">
          {incidents.length} de {all.length} casos
        </span>
      </div>

      {incidents.length ? (
        <div className="overflow-x-auto rounded-3xl bg-surface shadow-soft">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-surface-2/70 text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Caso</th>
                <th className="px-4 py-2.5 font-medium">Reportado por</th>
                <th className="px-4 py-2.5 font-medium">Señales</th>
                <th className="px-4 py-2.5 font-medium">Riesgo</th>
                <th className="px-4 py-2.5 text-right font-medium">Vínculos</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => {
                const st = STATUS[i.analyst_status];
                const links = linkCount.get(i.id) ?? 0;
                return (
                  <tr key={i.id} className="border-b border-line last:border-0 hover:bg-accent-wash/50">
                    <td className="min-w-64 px-4 py-3">
                      <Link href={`/panel/casos/${i.id}`} className="font-semibold hover:text-accent">
                        {i.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted">
                        <span className="tabular">{caseCode(i.id)}</span> · {fmtDateTime(i.started_at)} ·{" "}
                        {CHANNEL_LABELS[i.channel]}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-fg-2">{i.user_name}</td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-60 flex-wrap gap-1">
                        {i.signal_types
                          ?.split(",")
                          .slice(0, 2)
                          .map((t) => <SignalChip key={t} type={t as SignalType} />)}
                        {(i.signal_types?.split(",").length ?? 0) > 2 && (
                          <span className="px-1 text-xs text-muted">+{i.signal_types!.split(",").length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge level={i.risk_level} score={i.risk_score} />
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {links ? (
                        <span className="inline-flex items-center gap-1 text-fg-2">
                          <Network size={13} aria-hidden />
                          {links}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg-2">
                        <st.Icon size={14} className={st.cls} aria-hidden />
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No hay casos con esos filtros.</Empty>
      )}
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
