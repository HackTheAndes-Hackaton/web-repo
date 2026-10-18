import Link from "next/link";
import { CalendarDays, Hash, Link2, Mic, Sparkles, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { LinkGraph } from "@/components/LinkGraph";
import { CallerNumber, Card, Empty, IconBubble, PageHeader, RiskBadge, ScamTypeChip } from "@/components/ui";
import { fmtDateTime, pct } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { caseCode, listLinks, listSharedIncidents, type LinkView, type IncidentSummary } from "@/lib/repo";
import { buildLinkGroups, type LinkGroup } from "@/lib/link-groups";
import type { LinkReason, RiskLevel } from "@/lib/types";

/** Las razones antiguas basadas en el guion de la transcripción ya no se muestran. */
const visibleReasons = (reasons: LinkReason[]) => reasons.filter((r) => !/guion/i.test(r.detail));

function strength(score: number) {
  if (score >= 0.7) return { label: "Relación fuerte", cls: "bg-critical-wash text-critical-ink" };
  if (score >= 0.45) return { label: "Relación probable", cls: "bg-warning-wash text-warning-ink" };
  return { label: "Relación posible", cls: "bg-accent-wash text-accent-ink" };
}

const REASON = {
  voz: { icon: <Mic size={16} aria-hidden />, tone: "accent", title: "Voz parecida" },
  dato_compartido: { icon: <Hash size={16} aria-hidden />, tone: "critical", title: "Dato repetido" },
  contenido: { icon: <Sparkles size={16} aria-hidden />, tone: "warning", title: "Mismo patrón de señales" },
} as const;

function CaseSide(props: {
  id: string;
  title: string;
  started: string;
  risk: RiskLevel;
  scamType: string | null;
  impersonating: string | null;
  caller: string | null;
}) {
  return (
    <Link
      href={`/panel/casos/${props.id}`}
      className="flex min-w-0 flex-1 flex-col gap-3 rounded-[22px] bg-surface-2 p-5 transition-colors hover:bg-accent-wash"
    >
      <div>
        <div className="tabular text-xs font-medium text-muted">Caso {caseCode(props.id)}</div>
        <div className="mt-0.5 text-[15px] font-semibold leading-snug">{props.title}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge level={props.risk} />
        <ScamTypeChip type={props.scamType} />
      </div>
      <dl className="space-y-1.5 text-xs text-fg-2">
        <div className="flex items-center gap-1.5">
          <CalendarDays size={12} className="text-muted" aria-hidden />
          {fmtDateTime(props.started)}
        </div>
        <CallerNumber incident={{ caller_e164: props.caller, caller_number_raw: null }} />
        {props.impersonating && (
          <div className="flex items-center gap-1.5">
            <UserRound size={12} className="text-muted" aria-hidden />
            Se hace pasar por: <span className="font-medium text-fg">{props.impersonating}</span>
          </div>
        )}
      </dl>
    </Link>
  );
}

function ReasonRow({ icon, tone, title, children }: { icon: ReactNode; tone: "accent" | "critical" | "warning"; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <IconBubble tone={tone}>{icon}</IconBubble>
      <div className="min-w-0 pt-0.5">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-sm text-fg-2">{children}</div>
      </div>
    </li>
  );
}

function ConnectionEvidence({ l }: { l: LinkView }) {
  const s = strength(l.score);
  const reasons = visibleReasons(l.reasons);
  return (
    <li className="rounded-2xl border border-line p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="tabular text-[30px] font-bold leading-none text-accent-ink">{pct(l.score)}</span>
          <div>
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${s.cls}`}>{s.label}</span>
            <div className="mt-1 text-xs text-muted">Puntuación de esta conexión</div>
          </div>
        </div>
        <div className="text-right text-xs text-muted">
          <div className={l.status === "confirmado" ? "font-semibold text-good-ink" : "text-warning-ink"}>
            {l.status === "confirmado" ? "Confirmada por analista" : "Pendiente de revisión"}
          </div>
          Detectado {fmtDateTime(l.created_at)}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
        <Link href={`/panel/casos/${l.incident_a}`} className="text-accent-ink hover:underline">{caseCode(l.incident_a)} · {l.a_title}</Link>
        <Link2 size={16} className="shrink-0 text-muted" aria-label="Conexión directa" />
        <Link href={`/panel/casos/${l.incident_b}`} className="text-accent-ink hover:underline">{caseCode(l.incident_b)} · {l.b_title}</Link>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <h3 className="text-xs font-semibold tracking-widest text-muted">EVIDENCIA DE ESTA CONEXIÓN</h3>
        {reasons.length ? (
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {reasons.map((r, i) => {
              const meta = REASON[r.kind as keyof typeof REASON] ?? REASON.contenido;
              return (
                <ReasonRow key={i} icon={meta.icon} tone={meta.tone} title={meta.title}>
                  {r.detail.replace(/^[^:]+:\s*/, "")}
                </ReasonRow>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">Sin razones detalladas.</p>
        )}
      </div>
    </li>
  );
}

function GroupCard({ group, cases }: { group: LinkGroup<LinkView>; cases: Map<string, IncidentSummary> }) {
  const members = group.incidentIds.map((id) => cases.get(id)!).sort((a, b) => a.started_at.localeCompare(b.started_at));
  return (
    <li id={group.anchor} className="scroll-mt-6 rounded-3xl bg-surface p-6 shadow-soft sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold"><Link2 size={20} aria-hidden />Grupo de {members.length} casos</h3>
          <p className="mt-1 text-sm text-muted">{group.links.length} {group.links.length === 1 ? "conexión" : "conexiones"} · {group.confirmedCount} {group.confirmedCount === 1 ? "confirmada" : "confirmadas"} · {group.pendingCount} {group.pendingCount === 1 ? "pendiente" : "pendientes"}</p>
        </div>
        <span className="rounded-full bg-accent-wash px-3 py-1 text-xs font-semibold text-accent-ink">Red para investigar</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {members.map((incident) => (
          <CaseSide key={incident.id} id={incident.id} title={incident.title} started={incident.started_at}
            risk={incident.risk_level} scamType={incident.scam_type} impersonating={incident.impersonating}
            caller={incident.caller_e164 ?? incident.caller_number_raw} />
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">El grupo reúne conexiones directas e indirectas. Pertenecer a la misma red no confirma una conexión entre todos sus casos ni una misma persona.</p>
      <details className="mt-5 border-t border-line pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-accent-ink">{group.links.length === 1 ? "Ver la conexión y su evidencia" : `Ver las ${group.links.length} conexiones y su evidencia`}</summary>
        <ol className="mt-4 space-y-4">{group.links.map((link) => <ConnectionEvidence key={link.id} l={link} />)}</ol>
      </details>
    </li>
  );
}

export default async function LinksPage() {
  const { orgId } = await requireAnalyst();
  const [links, incidents] = await Promise.all([listLinks(orgId), listSharedIncidents(orgId)]);
  const groups = buildLinkGroups(incidents, links);
  const groupedLinks = groups.flatMap((group) => group.links);
  const connectedIds = new Set(groups.flatMap((group) => group.incidentIds));
  const cases = new Map(incidents.map((incident) => [incident.id, incident]));

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/panel", label: "Análisis" },
          { href: "/panel/vinculos", label: "Vínculos" },
        ]}
        title="Vínculos entre casos"
        description="Explora grupos de dos o más casos conectados por voz, datos repetidos o patrones de señales. Cada conexión conserva su propia evidencia y revisión."
      />

      <Card title={`Red de casos · ${groups.length} ${groups.length === 1 ? "grupo" : "grupos"} · ${groupedLinks.length} ${groupedLinks.length === 1 ? "conexión" : "conexiones"}`}>
        <LinkGraph incidents={incidents.filter((incident) => connectedIds.has(incident.id))} links={groupedLinks} />
      </Card>

      <h2 className="mt-8 mb-4 text-[17px] font-semibold">Grupos de casos relacionados</h2>
      {groups.length ? (
        <ul className="space-y-6">
          {groups.map((group) => (
            <GroupCard key={group.anchor} group={group} cases={cases} />
          ))}
        </ul>
      ) : (
        <Empty>La IA todavía no detectó vínculos entre casos.</Empty>
      )}
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
