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
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
      <s.Icon size={9} fill="currentColor" strokeWidth={0} aria-hidden />
      {s.label}
      {score !== undefined && <span className="tabular opacity-80">· {score}</span>}
    </span>
  );
}

export function SignalChip({ type }: { type: SignalType }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-accent-wash px-2.5 py-0.5 text-xs font-medium text-accent-ink">
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
    <section className={`rounded-3xl bg-surface p-5 shadow-soft sm:p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          {title && <h2 className="text-[17px] font-semibold text-fg">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "warning" | "critical" }) {
  const cls = {
    neutral: "bg-surface-2 text-fg-2",
    accent: "bg-accent-wash text-accent-ink",
    good: "bg-good-wash text-good-ink",
    warning: "bg-warning-wash text-warning-ink",
    critical: "bg-critical-wash text-critical-ink",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

// Botones en forma de píldora, como en la app.
export const buttonCls = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-accent-ink disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-accent-ink hover:bg-accent-wash disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-full bg-critical px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50",
  ghost: "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-fg-2 hover:bg-accent-wash",
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
          <h1 className="text-[26px] font-bold tracking-tight text-balance">{title}</h1>
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
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-medium text-fg-2 shadow-soft">
      {icon}
      {children}
    </span>
  );
}

/** Escudo con ondas de voz: el mismo trazo que ic_tiskz_shield de la app. */
export function ShieldWaves({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="31 26 46 56" className={className} aria-hidden fill="currentColor">
      <path
        fillRule="evenodd"
        d="M54,26C59,29.5 67.5,32 76,33C76.6,34 77,35.5 77,37V51C77,65.5 67.5,76.5 54,82C40.5,76.5 31,65.5 31,51V37C31,35.5 31.4,34 32,33C40.5,32 49,29.5 54,26Z M41.5,48.5A2.5,2.5 0,0 1,46.5 48.5V57.5A2.5,2.5 0,0 1,41.5 57.5Z M51.5,44.5A2.5,2.5 0,0 1,56.5 44.5V61.5A2.5,2.5 0,0 1,51.5 61.5Z M61.5,48.5A2.5,2.5 0,0 1,66.5 48.5V57.5A2.5,2.5 0,0 1,61.5 57.5Z"
      />
    </svg>
  );
}

/** Logo de Tiskz: escudo blanco sobre el degradado de marca (o translúcido sobre fondos oscuros). */
export function TiskzLogo({ size = 40, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center text-white ${onDark ? "bg-white/20" : "bg-brand"}`}
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
    >
      <ShieldWaves size={Math.round(size * 0.56)} />
    </span>
  );
}

/** Ícono dentro de un círculo de color suave, como en las tarjetas de la app. */
export function IconBubble({
  children,
  tone = "accent",
  size = 36,
}: {
  children: ReactNode;
  tone?: "accent" | "good" | "warning" | "critical";
  size?: number;
}) {
  const cls = {
    accent: "bg-accent-wash text-accent",
    good: "bg-good-wash text-good-ink",
    warning: "bg-warning-wash text-warning-ink",
    critical: "bg-critical-wash text-critical",
  }[tone];
  return (
    <span className={`grid shrink-0 place-items-center rounded-full ${cls}`} style={{ width: size, height: size }}>
      {children}
    </span>
  );
}

const VERDICT = {
  safe: { label: "Segura", cls: "bg-good-wash text-good-ink" },
  suspicious: { label: "Sospechosa", cls: "bg-warning-wash text-warning-ink" },
  scam: { label: "Estafa", cls: "bg-critical-wash text-critical" },
} as const;

/** Veredicto del análisis, como VerdictBadge de la app. "none" no se muestra. */
export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  const v = VERDICT[verdict as keyof typeof VERDICT];
  if (!v) return null;
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${v.cls}`}>Veredicto: {v.label}</span>;
}
