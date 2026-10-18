import Link from "next/link";
import { CalendarDays, Hash, Link2, Mic, Sparkles, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { LinkGraph } from "@/components/LinkGraph";
import { CallerNumber, Card, Empty, IconBubble, PageHeader, RiskBadge, ScamTypeChip } from "@/components/ui";
import { fmtDateTime, pct } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { caseCode, listLinks, listSharedIncidents, type LinkView } from "@/lib/repo";
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

function LinkCard({ l }: { l: LinkView }) {
  const s = strength(l.score);
  const reasons = visibleReasons(l.reasons);
  return (
    <li className="rounded-3xl bg-surface p-6 shadow-soft sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="tabular text-[30px] font-bold leading-none text-accent-ink">{pct(l.score)}</span>
          <div>
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${s.cls}`}>{s.label}</span>
            <div className="mt-1 text-xs text-muted">Coincidencia calculada por la IA</div>
          </div>
        </div>
        <div className="text-xs text-muted">Detectado {fmtDateTime(l.created_at)}</div>
      </div>

      <div className="mt-6 grid items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <CaseSide
          id={l.incident_a}
          title={l.a_title}
          started={l.a_started}
          risk={l.a_risk}
          scamType={l.a_scam_type}
          impersonating={l.a_impersonating}
          caller={l.a_caller}
        />
        <div className="flex items-center justify-center" aria-hidden>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-brand text-white shadow-soft">
            <Link2 size={18} />
          </span>
        </div>
        <CaseSide
          id={l.incident_b}
          title={l.b_title}
          started={l.b_started}
          risk={l.b_risk}
          scamType={l.b_scam_type}
          impersonating={l.b_impersonating}
          caller={l.b_caller}
        />
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <h3 className="text-xs font-semibold tracking-widest text-muted">POR QUÉ LA IA LOS RELACIONA</h3>
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

export default async function LinksPage() {
  const { orgId } = await requireAnalyst();
  const [links, incidents] = await Promise.all([listLinks(orgId), listSharedIncidents(orgId)]);

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/panel", label: "Análisis" },
          { href: "/panel/vinculos", label: "Vínculos" },
        ]}
        title="Vínculos entre casos"
        description="La IA relaciona casos por voz parecida, datos repetidos (números, cuentas, nombres) y el mismo patrón de señales. Indica una posible campaña; atribuirla a una persona exige corroboración independiente."
      />

      <Card title={`Red de casos · ${links.length} vínculos detectados`}>
        <LinkGraph incidents={incidents} links={links} />
      </Card>

      <h2 className="mt-8 mb-4 text-[17px] font-semibold">Vínculos detectados por la IA</h2>
      {links.length ? (
        <ul className="space-y-6">
          {links.map((l) => (
            <LinkCard key={l.id} l={l} />
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
