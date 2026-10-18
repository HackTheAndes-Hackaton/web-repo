import type { IncidentSummary, LinkView } from "@/lib/repo";
import { pct } from "@/lib/format";
import type { RiskLevel } from "@/lib/types";

const RISK_FILL = { bajo: "var(--good)", medio: "var(--warning)", alto: "var(--critical)" };

/** La forma repite el nivel de riesgo para no depender solo del color. */
function RiskNode({ x, y, level, size = 8 }: { x: number; y: number; level: RiskLevel; size?: number }) {
  const common = { fill: RISK_FILL[level], stroke: "var(--surface)", strokeWidth: 2 };
  if (level === "alto") return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} rx={2} {...common} />;
  if (level === "medio") {
    const h = size * 1.15;
    return <polygon points={`${x},${y - h} ${x + h},${y + h * 0.8} ${x - h},${y + h * 0.8}`} {...common} />;
  }
  return <circle cx={x} cy={y} r={size} {...common} />;
}

/** Red de casos: cada línea es un vínculo detectado por la IA; más gruesa = relación más fuerte. */
export function LinkGraph({
  incidents,
  links,
  compact = false,
}: {
  incidents: IncidentSummary[];
  links: LinkView[];
  /** Lienzo más angosto para columnas laterales: el texto se ve más grande. */
  compact?: boolean;
}) {
  const visible = links.filter((l) => l.status !== "descartado");
  const W = compact ? 400 : 640;
  const H = 380;
  const maxLabel = compact ? 16 : 26;
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) / 2 - (compact ? 95 : 70);
  const nodes = [...incidents]
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((inc, i, arr) => {
      const angle = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
      return { inc, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), angle };
    });
  const pos = new Map(nodes.map((n) => [n.inc.id, n]));

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} overflow="visible" className={`h-auto w-full ${compact ? "mx-auto max-w-md" : ""}`} role="img" aria-label="Red de vínculos entre casos">
        {visible.map((l) => {
          const a = pos.get(l.incident_a);
          const b = pos.get(l.incident_b);
          if (!a || !b) return null;
          const strong = l.score >= 0.7;
          return (
            <line
              key={l.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={strong ? "var(--accent)" : "var(--brand-3)"}
              strokeWidth={1.5 + l.score * 3}
              strokeLinecap="round"
            >
              <title>{`Coincidencia ${pct(l.score)}`}</title>
            </line>
          );
        })}
        {nodes.map(({ inc, x, y, angle }) => {
          const right = Math.cos(angle) >= 0.2;
          const left = Math.cos(angle) <= -0.2;
          const lx = x + Math.cos(angle) * 16;
          const ly = y + Math.sin(angle) * 16 + (Math.abs(Math.cos(angle)) < 0.2 ? (Math.sin(angle) > 0 ? 10 : -4) : 4);
          const label = inc.title.length > maxLabel ? `${inc.title.slice(0, maxLabel - 1)}…` : inc.title;
          return (
            <a key={inc.id} href={`/panel/casos/${inc.id}`}>
              <title>{`${inc.title} · riesgo ${inc.risk_level} (${inc.risk_score})`}</title>
              <circle cx={x} cy={y} r={14} fill="transparent" />
              <RiskNode x={x} y={y} level={inc.risk_level} />
              <text
                x={lx}
                y={ly}
                textAnchor={right ? "start" : left ? "end" : "middle"}
                fontSize={11}
                fill="var(--fg-2)"
              >
                {label}
              </text>
            </a>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-fg-2">
        <span className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden>
            <line x1="1" y1="3" x2="21" y2="3" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
          </svg>
          Relación fuerte (70 % o más)
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden>
            <line x1="1" y1="3" x2="21" y2="3" stroke="var(--brand-3)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          Relación más débil
        </span>
        {(["bajo", "medio", "alto"] as const).map((lvl) => (
          <span key={lvl} className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden>
              <RiskNode x={0} y={0} level={lvl} size={5} />
            </svg>
            Riesgo {lvl}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
