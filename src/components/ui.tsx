import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Circle, Square, Triangle } from "lucide-react";
import { SIGNAL_LABELS, type RiskLevel, type SignalType } from "@/lib/types";

const RISK_STYLE: Record<RiskLevel, { label: string; Icon: typeof Circle; cls: string; dot: string; ink: string }> = {
  bajo: { label: "Riesgo bajo", Icon: Circle, cls: "bg-good-wash text-good-ink", dot: "bg-good", ink: "text-good" },
  medio: { label: "Riesgo medio", Icon: Triangle, cls: "bg-warning-wash text-warning-ink", dot: "bg-warning", ink: "text-warning" },
  alto: { label: "Riesgo alto", Icon: Square, cls: "bg-critical-wash text-critical-ink", dot: "bg-critical", ink: "text-critical" },
};

/** Forma + color del nivel de riesgo (nunca solo color). */
export function RiskIcon({ level, size = 10 }: { level: RiskLevel; size?: number }) {
  const { Icon, ink } = RISK_STYLE[level];
  return <Icon size={size} className={`shrink-0 ${ink}`} fill="currentColor" strokeWidth={0} aria-hidden />;
}

/** Nivel de riesgo: color + forma + texto, nunca solo color. */
export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  const s = RISK_STYLE[level];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      <s.Icon size={9} fill="currentColor" strokeWidth={0} aria-hidden />
      {s.label}
      {score !== undefined && <span className="tabular opacity-80">· {score}</span>}
    </span>
  );
}

export function SignalChip({ type }: { type: SignalType }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-md border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-2">
      {SIGNAL_LABELS[type] ?? type}
    </span>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "warning" | "critical" }) {
  const cls = {
    neutral: "bg-surface-2 text-fg-2",
    accent: "bg-accent-wash text-accent-ink",
    good: "bg-good-wash text-good-ink",
    warning: "bg-warning-wash text-warning-ink",
    critical: "bg-critical-wash text-critical-ink",
  }[tone];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export const buttonCls = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-critical px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50",
  ghost: "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-fg-2 hover:bg-surface-2",
};

export function PageHeader({
  crumbs = [],
  title,
  description,
  actions,
  meta,
}: {
  crumbs?: { href: string; label: string }[];
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {crumbs.length > 0 && (
        <nav aria-label="Ruta" className="no-print mb-2 flex flex-wrap items-center gap-1 text-xs text-muted">
          {crumbs.map((c, i) => (
            <span key={c.href} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} aria-hidden />}
              <Link href={c.href} className="hover:text-fg">
                {c.label}
              </Link>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-fg-2">{description}</p>}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-2">{meta}</div>}
        </div>
        {actions && <div className="no-print flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Pastilla de metadatos (estado, duración, canal) al estilo de las barras de incidentes. */
export function Pill({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg-2">
      {icon}
      {children}
    </span>
  );
}
