import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { CallerNumber, Empty, PageHeader, RiskBadge, ScamTypeChip } from "@/components/ui";
import { fmtDateTime, fmtPhone } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { caseCode, listSharedIncidents, type IncidentSummary } from "@/lib/repo";
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

const RISK_ORDER = { alto: 3, medio: 2, bajo: 1 } as const;

/** Llamadas de un mismo número: en la lista se ven como una sola fila que se despliega. */
interface CallerBucket {
  key: string;
  number: string | null;
  cases: IncidentSummary[];
}

function bucketByCaller(incidents: IncidentSummary[]) {
  const buckets = new Map<string, CallerBucket>();
  for (const i of incidents) {
    const raw = i.caller_e164 ?? i.caller_number_raw;
    const digits = raw?.replace(/\D/g, "") ?? "";
    // Sin número (u oculto) cada caso va solo.
    const key = digits.length >= 7 ? `n:${digits}` : `c:${i.id}`;
    const b = buckets.get(key) ?? { key, number: digits.length >= 7 ? raw : null, cases: [] };
    b.cases.push(i);
    buckets.set(key, b);
  }
  // Los casos llegan ordenados del más reciente al más antiguo: el grupo toma la posición de su último caso.
  return [...buckets.values()];
}

const COLS = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem] items-center gap-4";

function TypeCell({ cases }: { cases: IncidentSummary[] }) {
  const types = [...new Set(cases.map((c) => c.scam_type).filter((t): t is string => Boolean(t)))];
  if (!types.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {types.slice(0, 2).map((t) => <ScamTypeChip key={t} type={t} />)}
      {types.length > 2 && <span className="text-xs text-muted">+{types.length - 2}</span>}
    </span>
  );
}

function CaseRow({ i }: { i: IncidentSummary }) {
  return (
    <li>
      <Link href={`/panel/casos/${i.id}`} className={`${COLS} px-5 py-3.5 hover:bg-accent-wash/50`}>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{i.title}</span>
          <span className="tabular block text-xs text-muted">{caseCode(i.id)} · {fmtDateTime(i.started_at)}</span>
        </span>
        <span className="min-w-0 truncate text-sm text-fg-2"><CallerNumber incident={i} /></span>
        <TypeCell cases={[i]} />
        <RiskBadge level={i.risk_level} score={i.risk_score} />
      </Link>
    </li>
  );
}

function BucketRow({ b }: { b: CallerBucket }) {
  const worst = [...b.cases].sort((x, y) => RISK_ORDER[y.risk_level] - RISK_ORDER[x.risk_level] || y.risk_score - x.risk_score)[0];
  return (
    <li>
      <details className="group">
        <summary className={`${COLS} cursor-pointer list-none px-5 py-3.5 hover:bg-accent-wash/50 [&::-webkit-details-marker]:hidden`}>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-semibold">
              <ChevronRight size={15} className="shrink-0 text-muted transition group-open:rotate-90" aria-hidden />
              {b.cases.length} llamadas del mismo número
            </span>
            <span className="block pl-5 text-xs text-muted">Última: {fmtDateTime(b.cases[0].started_at)}</span>
          </span>
          <span className="tabular min-w-0 truncate text-sm font-medium">{fmtPhone(b.number) ?? b.number}</span>
          <TypeCell cases={b.cases} />
          <span title="El riesgo más alto entre estas llamadas"><RiskBadge level={worst.risk_level} score={worst.risk_score} /></span>
        </summary>
        <ul className="border-t border-line bg-surface-2/50">
          {b.cases.map((i) => (
            <li key={i.id}>
              <Link href={`/panel/casos/${i.id}`} className={`${COLS} py-2 pr-5 pl-11 text-sm hover:bg-accent-wash/50`}>
                <span className="tabular min-w-0 truncate">
                  <span className="font-semibold">{caseCode(i.id)}</span> <span className="text-muted">· {fmtDateTime(i.started_at)}</span>
                </span>
                <span className="min-w-0 truncate text-fg-2">{i.title}</span>
                <TypeCell cases={[i]} />
                <RiskBadge level={i.risk_level} score={i.risk_score} />
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}


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

  const all = await listSharedIncidents(orgId);
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
          <div className="min-w-[760px]">
            <div className={`${COLS} bg-surface-2/70 px-5 py-3 text-[11px] font-medium uppercase tracking-wider text-muted`}>
              <span>Caso</span>
              <span>Número que llamó</span>
              <span>Tipo de estafa</span>
              <span>Riesgo</span>
            </div>
            <ul className="divide-y divide-line">
              {bucketByCaller(incidents).map((b) =>
                b.cases.length > 1 ? <BucketRow key={b.key} b={b} /> : <CaseRow key={b.key} i={b.cases[0]} />,
              )}
            </ul>
          </div>
        </div>
      ) : (
        <Empty>No hay casos con esos filtros.</Empty>
      )}
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
