import Link from "next/link";
import { Network, Search } from "lucide-react";
import { CallerNumber, Empty, PageHeader, RiskBadge, ScamTypeChip } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { caseCode, listLinks, listSharedIncidents } from "@/lib/repo";
import { scamTypeLabel } from "@/lib/types";
import { normalizeText } from "@/lib/heuristics";

const RISK_FILTERS = [
  { value: "", label: "Todos" },
  { value: "alto", label: "Alto" },
  { value: "medio", label: "Medio" },
  { value: "bajo", label: "Bajo" },
];
const VERDICT_FILTERS = [
  { value: "", label: "Todos" },
  { value: "scam", label: "Estafa" },
  { value: "suspicious", label: "Sospechosa" },
  { value: "safe", label: "Segura" },
];

type Params = { riesgo: string; veredicto: string; q: string };

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
    veredicto: typeof sp.veredicto === "string" ? sp.veredicto : "",
    q: typeof sp.q === "string" ? sp.q.trim() : "",
  };

  const linkCount = new Map<string, number>();
  const [links, all] = await Promise.all([listLinks(orgId), listSharedIncidents(orgId)]);
  for (const l of links) {
    linkCount.set(l.incident_a, (linkCount.get(l.incident_a) ?? 0) + 1);
    linkCount.set(l.incident_b, (linkCount.get(l.incident_b) ?? 0) + 1);
  }
  const needle = normalizeText(params.q);
  const incidents = all.filter(
    (i) =>
      (!params.riesgo || i.risk_level === params.riesgo) &&
      (!params.veredicto || i.verdict === params.veredicto) &&
      (!needle ||
        normalizeText(
          `${i.title} ${i.user_name ?? ""} ${caseCode(i.id)} ${scamTypeLabel(i.scam_type) ?? ""} ${i.impersonating ?? ""} ${i.caller_e164 ?? ""} ${i.caller_number_raw ?? ""}`,
        ).includes(needle) ||
        (needle.replace(/\D/g, "").length >= 4 &&
          `${i.caller_e164 ?? ""}${i.caller_number_raw ?? ""}`.replace(/\D/g, "").includes(needle.replace(/\D/g, "")))),
  );
  const filtered = Boolean(params.riesgo || params.veredicto || params.q);

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/panel", label: "Análisis" },
          { href: "/panel/casos", label: "Casos" },
        ]}
        title="Casos compartidos"
        description="Cada caso llega solo cuando su titular autoriza compartirlo. La IA clasifica el tipo de estafa y registra el número que llamó."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form action="/panel/casos" className="relative min-w-56 flex-1 sm:max-w-xs">
          {params.riesgo && <input type="hidden" name="riesgo" value={params.riesgo} />}
          {params.veredicto && <input type="hidden" name="veredicto" value={params.veredicto} />}
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-accent" aria-hidden />
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Buscar por número, tipo de estafa o título"
            aria-label="Buscar casos"
            className="w-full rounded-full bg-surface py-2 pr-4 pl-10 text-sm shadow-soft ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
          />
        </form>
        <FilterGroup label="Riesgo" k="riesgo" all={params} options={RISK_FILTERS} />
        <FilterGroup label="Veredicto" k="veredicto" all={params} options={VERDICT_FILTERS} />
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
                <th className="px-5 py-3 font-medium">Caso</th>
                <th className="px-5 py-3 font-medium">Tipo de estafa</th>
                <th className="px-5 py-3 font-medium">Número que llamó</th>
                <th className="px-5 py-3 font-medium">Riesgo</th>
                <th className="px-5 py-3 text-right font-medium">Vínculos</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => {
                const links = linkCount.get(i.id) ?? 0;
                return (
                  <tr key={i.id} className="border-b border-line last:border-0 hover:bg-accent-wash/50">
                    <td className="min-w-64 px-5 py-4">
                      <Link href={`/panel/casos/${i.id}`} className="font-semibold hover:text-accent">
                        {i.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted">
                        <span className="tabular">{caseCode(i.id)}</span> · {fmtDateTime(i.started_at)}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {i.scam_type ? <ScamTypeChip type={i.scam_type} /> : <span className="text-xs text-muted">Sin clasificar</span>}
                      {i.impersonating && <div className="mt-1 text-xs text-fg-2">Se hace pasar por {i.impersonating}</div>}
                    </td>
                    <td className="px-5 py-4">
                      <CallerNumber incident={i} />
                    </td>
                    <td className="px-5 py-4">
                      <RiskBadge level={i.risk_level} score={i.risk_score} />
                    </td>
                    <td className="tabular px-5 py-4 text-right">
                      {links ? (
                        <span className="inline-flex items-center gap-1 text-fg-2">
                          <Network size={13} aria-hidden />
                          {links}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
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
