import Link from "next/link";
import { CalendarDays, Hash, Link2, Mic, Phone, Sparkles, UserRound, UserRoundSearch } from "lucide-react";
import type { ReactNode } from "react";
import { unassignCaseAction } from "@/app/actions";
import { LinkGraph } from "@/components/LinkGraph";
import { AddMissingForm, EditSuspectForm, NameGroupForm } from "@/components/SuspectForms";
import { CallerNumber, Card, Empty, IconBubble, PageHeader, RiskBadge, RiskIcon, ScamTypeChip } from "@/components/ui";
import { fmtDateTime, fmtPhone, pct } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { caseCode, listLinks, listSharedIncidents, type LinkView, type IncidentSummary } from "@/lib/repo";
import { buildLinkGroups, type LinkGroup } from "@/lib/link-groups";
import { listSuspects, type SuspectSummary } from "@/lib/suspects";
import { scamTypeLabel, type LinkReason, type RiskLevel } from "@/lib/types";
import { explainLinkAction } from "./actions";

type AiExplanation = {status?:string;behavior_similarity?:"similar"|"unclear"|"different";evidence_a?:string|null;
  evidence_b?:string|null;supporting_reason_indexes?:number[];limitations?:string[];model_id?:string};
const similarityLabel={similar:"Comportamiento parecido",unclear:"Similitud no determinada",different:"Comportamiento diferente"};

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
  alias?: string | null;
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
        {props.alias && (
          <span className="inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-0.5 text-xs font-semibold text-white">
            <UserRoundSearch size={12} aria-hidden />
            {props.alias}
          </span>
        )}
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
  const snapshot = l.status === "pendiente" ? l.evidence_snapshot :
    (l.reviewed_evidence?.evidence_snapshot as Record<string,unknown> | undefined) ?? l.evidence_snapshot;
  const ai = snapshot?.ai_explanation as AiExplanation | undefined;
  const canExplain = l.status === "pendiente" && l.explanation_eligible;
  return (
    <li id={`vinculo-${l.id}`} className="scroll-mt-6 rounded-2xl border border-line p-4 sm:p-5">
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
                <ReasonRow key={i} icon={meta.icon} tone={meta.tone} title={r.detail.includes(":") ? r.detail.split(":")[0] : meta.title}>
                  {r.detail.replace(/^[^:]+:\s*/, "")}
                </ReasonRow>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">Sin razones detalladas.</p>
        )}
      </div>
      {(ai?.status === "completed" || canExplain) && (
        <section className="mt-5 border-t border-line pt-5" aria-label="Comparación de comportamiento">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={16} aria-hidden />Comparación de Maritime</h3>
              <p className="mt-1 text-xs text-muted">Compara dos resúmenes de prueba. No identifica personas ni confirma una estafa.</p>
            </div>
            {canExplain && ai?.status !== "running" && (
              <form action={explainLinkAction}>
                <input type="hidden" name="link_id" value={l.id} />
                <button type="submit" className="rounded-full bg-accent-wash px-4 py-2 text-xs font-semibold text-accent-ink hover:underline">
                  {ai?.status === "failed" ? "Reintentar comparación" : "Explicar con Maritime"}
                </button>
              </form>
            )}
          </div>
          {ai?.status === "running" && l.status === "pendiente" && <p className="mt-3 text-sm text-muted">Comparación en curso.</p>}
          {ai?.status === "failed" && <p className="mt-3 text-sm text-warning-ink">No se pudo completar la comparación. El vínculo sigue pendiente de revisión.</p>}
          {ai?.status === "completed" && ai.behavior_similarity && (
            <div className="mt-4 space-y-3 text-sm text-fg-2">
              <p className="font-semibold text-fg">{similarityLabel[ai.behavior_similarity]} <span className="font-normal text-muted">· inferencia del modelo, pendiente de revisión humana</span></p>
              {(ai.evidence_a || ai.evidence_b) && <dl className="grid gap-3 md:grid-cols-2">
                {ai.evidence_a && <div className="rounded-xl bg-surface-2 p-3"><dt className="text-xs font-semibold text-muted">Resumen del primer caso</dt><dd className="mt-1">{ai.evidence_a}</dd></div>}
                {ai.evidence_b && <div className="rounded-xl bg-surface-2 p-3"><dt className="text-xs font-semibold text-muted">Resumen del segundo caso</dt><dd className="mt-1">{ai.evidence_b}</dd></div>}
              </dl>}
              {!!ai.supporting_reason_indexes?.length && <p>Razones existentes consideradas: {ai.supporting_reason_indexes
                .filter((index) => Number.isInteger(index) && index >= 0 && index < l.reasons.length)
                .map((index) => l.reasons[index].detail).join(" · ")}</p>}
              {!!ai.limitations?.length && <p className="text-xs text-muted">Límites: {ai.limitations.join(" · ")}</p>}
            </div>
          )}
        </section>
      )}
    </li>
  );
}

/** Si el grupo ya está registrado, muestra el alias; si no, permite registrarlo. */
function GroupRecord({ members, suspects }: { members: IncidentSummary[]; suspects: Map<string, SuspectSummary> }) {
  const assigned = [...new Set(members.map((m) => m.suspect_id).filter((id): id is string => Boolean(id && suspects.has(id))))];
  const missing = members.filter((m) => !m.suspect_id || !suspects.has(m.suspect_id)).map((m) => m.id);
  if (!assigned.length) {
    const open = [...suspects.values()].filter((s) => s.status === "en_investigacion").map((s) => ({ id: s.id, alias: s.alias }));
    return <NameGroupForm incidentIds={members.map((m) => m.id)} existing={open} />;
  }
  return (
    <div className="w-full space-y-3 rounded-2xl bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <UserRoundSearch size={16} className="text-critical-ink" aria-hidden />
        <span className="font-semibold">{assigned.length === 1 ? "Registrado como presunto estafador:" : "Casos repartidos entre registros:"}</span>
        {assigned.map((id) => (
          <a key={id} href={`#${id}`} className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white hover:brightness-125">
            {suspects.get(id)!.alias}
          </a>
        ))}
      </div>
      {assigned.length === 1 && missing.length > 0 && (
        <AddMissingForm suspectId={assigned[0]} alias={suspects.get(assigned[0])!.alias} incidentIds={missing} />
      )}
      {assigned.length > 1 && (
        <p className="text-xs text-muted">Revisa si son el mismo estafador antes de unificarlos; cada caso solo puede estar en un registro.</p>
      )}
    </div>
  );
}

/** Desde este tamaño el grupo se muestra como lista compacta (igual que el gráfico, que pasa a un centro con radios). */
const BIG_GROUP = 7;
const TOP_CONNECTIONS = 10;

function GroupCard({ group, cases, suspects }: { group: LinkGroup<LinkView>; cases: Map<string, IncidentSummary>; suspects: Map<string, SuspectSummary> }) {
  const members = group.incidentIds.map((id) => cases.get(id)!).sort((a, b) => a.started_at.localeCompare(b.started_at));
  // En grupos grandes las tarjetas y las N×(N−1)/2 conexiones no se pueden leer: lista compacta y las más fuertes.
  const big = members.length >= BIG_GROUP;
  const strongest = [...group.links].sort((a, b) => b.score - a.score).slice(0, big ? TOP_CONNECTIONS : undefined);
  return (
    <li id={group.anchor} className="scroll-mt-6 rounded-3xl bg-surface p-6 shadow-soft sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold"><Link2 size={20} aria-hidden />Grupo de {members.length} casos</h3>
          <p className="mt-1 text-sm text-muted">{group.links.length} {group.links.length === 1 ? "conexión" : "conexiones"} · {group.confirmedCount} {group.confirmedCount === 1 ? "confirmada" : "confirmadas"} · {group.pendingCount} {group.pendingCount === 1 ? "pendiente" : "pendientes"}</p>
        </div>
        <span className="rounded-full bg-accent-wash px-3 py-1 text-xs font-semibold text-accent-ink">Red para investigar</span>
      </div>
      <div className="mt-4"><GroupRecord members={members} suspects={suspects} /></div>
      {members.every((item) => item.simulated === true && !item.sharing_revoked_at) && <Link
        href={`/panel/informes#${group.anchor}`}
        className="mt-4 inline-flex rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-2">
        Preparar informe PDF de todo el grupo
      </Link>}
      {big ? (
        <ul className="mt-5 grid gap-x-6 gap-y-0.5 md:grid-cols-2">
          {members.map((incident) => {
            const alias = incident.suspect_id ? suspects.get(incident.suspect_id)?.alias : null;
            return (
              <li key={incident.id}>
                <Link href={`/panel/casos/${incident.id}`}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-accent-wash">
                  <RiskIcon level={incident.risk_level} />
                  <span className="tabular w-16 shrink-0 font-semibold">{caseCode(incident.id)}</span>
                  <span className="min-w-0 flex-1 truncate">{incident.title}</span>
                  {alias && <UserRoundSearch size={13} className="shrink-0 text-critical-ink" aria-label={`Registrado en ${alias}`} />}
                  <span className="tabular shrink-0 text-xs text-muted">{fmtDateTime(incident.started_at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {members.map((incident) => (
          <CaseSide key={incident.id} id={incident.id} title={incident.title} started={incident.started_at}
            risk={incident.risk_level} scamType={incident.scam_type} impersonating={incident.impersonating}
            caller={incident.caller_e164 ?? incident.caller_number_raw}
            alias={incident.suspect_id ? suspects.get(incident.suspect_id)?.alias : null} />
        ))}
      </div>
      )}
      <details className="mt-5 border-t border-line pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-accent-ink">
          {group.links.length === 1
            ? "Ver la conexión y su evidencia"
            : big
              ? `Ver las ${strongest.length} conexiones más fuertes de ${group.links.length}`
              : `Ver las ${group.links.length} conexiones y su evidencia`}
        </summary>
        <ol className="mt-4 space-y-4">{strongest.map((link) => <ConnectionEvidence key={link.id} l={link} />)}</ol>
        {big && group.links.length > strongest.length && (
          <p className="mt-3 text-xs text-muted">
            Las otras {group.links.length - strongest.length} conexiones repiten la misma evidencia entre otros pares del grupo.
          </p>
        )}
      </details>
    </li>
  );
}

function SuspectRecord({ suspect, cases }: { suspect: SuspectSummary; cases: IncidentSummary[] }) {
  const discarded = suspect.status === "descartado";
  return (
    <li id={suspect.id} className={`scroll-mt-6 rounded-3xl bg-surface p-6 shadow-soft ${discarded ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconBubble tone={discarded ? "neutral" : "critical"}><UserRoundSearch size={18} aria-hidden /></IconBubble>
          <div>
            <h3 className="text-lg font-bold leading-tight">{suspect.alias}</h3>
            <p className="mt-0.5 text-xs text-muted">
              Registrado por {suspect.created_by ?? "un analista"} · {fmtDateTime(suspect.created_at)}
            </p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${discarded ? "bg-surface-2 text-fg-2" : "bg-critical-wash text-critical-ink"}`}>
          {discarded ? "Descartado" : "En investigación"}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-xs text-muted">Casos</dt>
          <dd className="tabular text-xl font-bold">{suspect.case_count}</dd>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-xs text-muted">Primera y última llamada</dt>
          <dd className="font-medium">
            {suspect.first_call ? `${fmtDateTime(suspect.first_call)} — ${fmtDateTime(suspect.last_call!)}` : "—"}
          </dd>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-xs text-muted">Tipos de estafa</dt>
          <dd className="font-medium">{suspect.scam_types.map((t) => scamTypeLabel(t)).join(", ") || "Sin clasificar"}</dd>
        </div>
      </dl>
      {suspect.numbers.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-2">
          <Phone size={13} className="text-muted" aria-hidden />
          Números usados:
          {suspect.numbers.map((n) => (
            <span key={n} className="tabular rounded-full bg-surface-2 px-2.5 py-0.5 font-medium text-fg">{fmtPhone(n) ?? n}</span>
          ))}
        </div>
      )}
      {suspect.notes && <p className="mt-3 whitespace-pre-line rounded-2xl bg-accent-wash px-4 py-3 text-sm text-accent-ink">{suspect.notes}</p>}

      {cases.length > 0 && (
        <ul className="mt-4 divide-y divide-line text-sm">
          {cases.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-2">
              <Link href={`/panel/casos/${c.id}`} className="min-w-0 flex-1 hover:text-accent-ink">
                <span className="tabular font-semibold">{caseCode(c.id)}</span> · {c.title}
                <span className="ml-2 text-xs text-muted">{fmtDateTime(c.started_at)}</span>
              </Link>
              <form action={unassignCaseAction.bind(null, c.id)}>
                <button className="rounded-full px-3 py-1 text-xs text-fg-2 hover:bg-critical-wash hover:text-critical-ink">Quitar</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <EditSuspectForm suspect={{ id: suspect.id, alias: suspect.alias, notes: suspect.notes, status: suspect.status }} />
      <p className="mt-3 text-xs text-muted">Alias de registro: no identifica a una persona ni prueba que todos los casos tengan el mismo autor.</p>
    </li>
  );
}

export default async function LinksPage({searchParams}:{searchParams:Promise<{informe?:string}>}) {
  const { orgId } = await requireAnalyst();
  const [links, incidents, suspectList] = await Promise.all([listLinks(orgId), listSharedIncidents(orgId), listSuspects(orgId)]);
  const {informe} = await searchParams;
  const suspects = new Map(suspectList.map((s) => [s.id, s]));
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
        description="Explora grupos de casos conectados por voz, el número que llamó, datos repetidos o patrones de señales. Si crees que un grupo es obra del mismo estafador, regístralo con un alias para darle seguimiento."
      />

      {informe && <p role="alert" className="mb-5 rounded-2xl bg-warning-wash p-4 text-sm text-warning-ink">
        No se guardó el informe. Revisa la selección: todos los casos deben ser ficticios, compartidos y unidos por los vínculos elegidos.
      </p>}

      <Card title={`Red de casos · ${groups.length} ${groups.length === 1 ? "grupo" : "grupos"} · ${groupedLinks.length} ${groupedLinks.length === 1 ? "conexión" : "conexiones"}`}>
        <LinkGraph
          incidents={incidents.filter((incident) => connectedIds.has(incident.id))}
          links={groupedLinks}
          suspects={Object.fromEntries(suspectList.map((s) => [s.id, s.alias]))}
        />
      </Card>

      <h2 className="mt-8 mb-1 text-[17px] font-semibold">Grupos de casos relacionados</h2>
      <p className="mb-4 text-sm text-muted">Estar en el mismo grupo no confirma una conexión entre todos sus casos ni una misma persona.</p>
      {groups.length ? (
        <ul className="space-y-6">
          {groups.map((group) => (
            <GroupCard key={group.anchor} group={group} cases={cases} suspects={suspects} />
          ))}
        </ul>
      ) : (
        <Empty>La IA todavía no detectó vínculos entre casos.</Empty>
      )}

      <h2 className="mt-10 mb-1 text-[17px] font-semibold">Registro de presuntos estafadores</h2>
      <p className="mb-4 text-sm text-muted">Alias que el equipo puso a grupos de casos que cree obra de la misma persona o banda.</p>
      {suspectList.length ? (
        <ul className="grid gap-6 lg:grid-cols-2">
          {suspectList.map((s) => (
            <SuspectRecord
              key={s.id}
              suspect={s}
              cases={incidents.filter((i) => i.suspect_id === s.id).sort((a, b) => a.started_at.localeCompare(b.started_at))}
            />
          ))}
        </ul>
      ) : (
        <Empty>Todavía no hay registros. Usa «Registrar como posible mismo estafador» en un grupo de casos.</Empty>
      )}
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
