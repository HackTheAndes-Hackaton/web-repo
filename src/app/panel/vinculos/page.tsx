import Link from "next/link";
import { reviewLink } from "@/app/actions";
import { LinkGraph } from "@/components/LinkGraph";
import { LinkReasons, LinkStatusTag } from "@/components/links-ui";
import { buttonCls, Card, Empty, PageHeader, RiskBadge } from "@/components/ui";
import { fmtDateTime, pct } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { listLinks, listSharedIncidents, type LinkView } from "@/lib/repo";

function Similarity({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular font-medium">{value === null ? "Sin datos" : pct(value)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-accent-wash">
        {value !== null && <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, value) * 100}%` }} />}
      </div>
    </div>
  );
}

function LinkCard({ l }: { l: LinkView }) {
  const side = (id: string, title: string, started: string, risk: LinkView["a_risk"]) => (
    <Link href={`/panel/casos/${id}`} className="block min-w-0 flex-1 rounded-2xl bg-surface-2 p-3.5 hover:bg-accent-wash">
      <div className="truncate text-sm font-medium">{title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        {fmtDateTime(started)} <RiskBadge level={risk} />
      </div>
    </Link>
  );
  return (
    <li className="rounded-3xl bg-surface p-5 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LinkStatusTag status={l.status} />
          <span className="text-xs text-muted">Puntaje combinado {pct(l.score)}</span>
          <span className="text-xs text-muted">Evidencia v{l.evidence_version}{l.status !== "pendiente" ? " · conservada al revisar" : ""}</span>
        </div>
        {l.reviewed_by && l.reviewed_at && (
          <span className="text-xs text-muted">
            Revisado por {l.reviewed_by} · {fmtDateTime(l.reviewed_at)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {side(l.incident_a, l.a_title, l.a_started, l.a_risk)}
        <span className="self-center text-muted" aria-hidden>
          ↔
        </span>
        {side(l.incident_b, l.b_title, l.b_started, l.b_risk)}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Por qué se propone</h3>
          <LinkReasons reasons={l.reasons} />
        </div>
        <div className="space-y-2">
          <Similarity label="Similitud de voz (pista, no identificación)" value={l.voice_sim} />
          <Similarity label="Similitud de contenido" value={l.content_sim} />
        </div>
      </div>
      {l.note && <p className="mt-3 rounded-2xl bg-accent-wash px-4 py-2.5 text-sm text-accent-ink">{l.note}</p>}
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" action={reviewLink.bind(null, l.id, l.status === "pendiente" ? "confirmado" : "pendiente")}>
        {l.status === "pendiente" ? (
          <>
            <input
              name="note"
              placeholder="Nota de revisión (opcional)"
              className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
            />
            <button className={buttonCls.primary}>Confirmar vínculo</button>
            <button formAction={reviewLink.bind(null, l.id, "descartado")} className={buttonCls.secondary}>
              Descartar
            </button>
          </>
        ) : (
          <button className={buttonCls.ghost}>Volver a pendiente para recalcular</button>
        )}
      </form>
    </li>
  );
}

const TABS = [
  { id: "pendiente", label: "Pendientes" },
  { id: "confirmado", label: "Confirmados" },
  { id: "descartado", label: "Descartados" },
] as const;

export default async function LinksPage({ searchParams }: PageProps<"/panel/vinculos">) {
  const { orgId } = await requireAnalyst();
  const { estado } = await searchParams;
  const current = TABS.find((t) => t.id === estado)?.id ?? "pendiente";
  const [links, incidents] = await Promise.all([listLinks(orgId), listSharedIncidents(orgId)]);
  const items = links.filter((l) => l.status === current);

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/panel", label: "Análisis" },
          { href: "/panel/vinculos", label: "Vínculos" },
        ]}
        title="Vínculos entre casos"
        description="El sistema propone vínculos combinando similitud de voz, datos repetidos y parecido del guion. Confirmar un vínculo documenta una posible campaña; atribuirla a una persona exige corroboración independiente."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0">
          <nav className="mb-4 flex flex-wrap gap-2" aria-label="Estado de los vínculos">
            {TABS.map((t) => {
              const n = links.filter((l) => l.status === t.id).length;
              return (
                <Link
                  key={t.id}
                  href={`/panel/vinculos?estado=${t.id}`}
                  aria-current={current === t.id ? "page" : undefined}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm shadow-soft ${
                    current === t.id ? "bg-accent font-semibold text-white" : "bg-surface text-fg-2 hover:text-accent-ink"
                  }`}
                >
                  {t.label}
                  <span className={`tabular rounded-full px-1.5 text-[11px] font-bold ${current === t.id ? "bg-white/25 text-white" : "bg-accent-wash text-accent-ink"}`}>{n}</span>
                </Link>
              );
            })}
          </nav>
          {items.length ? (
            <ul className="space-y-3">
              {items.map((l) => (
                <LinkCard key={l.id} l={l} />
              ))}
            </ul>
          ) : (
            <Empty>No hay vínculos en este estado.</Empty>
          )}
        </div>
        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card title="Red de casos">
            <LinkGraph incidents={incidents} links={links} compact />
          </Card>
        </div>
      </div>
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
