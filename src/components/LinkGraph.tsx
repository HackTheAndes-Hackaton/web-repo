import type { IncidentSummary, LinkView } from "@/lib/repo";
import { caseCode } from "@/lib/repo";
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

/** Componentes conectados: cada grupo se dibuja aparte para que sus líneas no crucen otros grupos. */
function components(incidents: IncidentSummary[], links: LinkView[]) {
  const ids = new Set(incidents.map((i) => i.id));
  const next = new Map<string, string[]>();
  for (const l of links) {
    if (!ids.has(l.incident_a) || !ids.has(l.incident_b)) continue;
    next.set(l.incident_a, [...(next.get(l.incident_a) ?? []), l.incident_b]);
    next.set(l.incident_b, [...(next.get(l.incident_b) ?? []), l.incident_a]);
  }
  const seen = new Set<string>();
  const groups: string[][] = [];
  const byDate = [...incidents].sort((a, b) => a.started_at.localeCompare(b.started_at));
  for (const start of byDate) {
    if (seen.has(start.id)) continue;
    const queue = [start.id];
    seen.add(start.id);
    for (let i = 0; i < queue.length; i++) {
      for (const n of next.get(queue[i]) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    groups.push(queue);
  }
  return groups.sort((a, b) => b.length - a.length);
}

/** Una red puede contener N casos. Cada línea conserva la revisión de su propia conexión. */
export function LinkGraph({
  incidents,
  links,
  compact = false,
  suspects = {},
}: {
  incidents: IncidentSummary[];
  links: LinkView[];
  /** Lienzo más angosto para columnas laterales: el texto se ve más grande. */
  compact?: boolean;
  /** Alias registrados (id → alias) para titular el grupo al que pertenecen sus casos. */
  suspects?: Record<string, string>;
}) {
  const visible = links.filter((l) => l.status !== "descartado");
  const byId = new Map(incidents.map((i) => [i.id, i]));
  const groups = components(incidents, visible);
  const W = compact ? 400 : 680;
  const cols = compact || groups.length === 1 ? 1 : 2;
  const cellW = W / cols;
  const maxLabel = cols === 1 && !compact ? 30 : 20;

  // Alto de cada fila según el grupo más grande que contiene.
  const cellH = (size: number) => (size <= 2 ? 190 : size <= 4 ? 260 : 320);
  const rows: string[][][] = [];
  for (let i = 0; i < groups.length; i += cols) rows.push(groups.slice(i, i + cols));
  let top = 0;
  const nodes: { inc: IncidentSummary; x: number; y: number; angle: number }[] = [];
  const captions: { x: number; y: number; text: string; alias: boolean }[] = [];
  rows.forEach((row) => {
    const h = Math.max(...row.map((g) => cellH(g.length)));
    row.forEach((group, col) => {
      const cx = cellW * col + cellW / 2;
      const cy = top + 22 + (h - 22) / 2;
      const ids = group.map((id) => byId.get(id)!).sort((a, b) => a.started_at.localeCompare(b.started_at));
      const r = group.length <= 2 ? (h - 22) / 2 - 42 : Math.min(cellW / 2 - 70, (h - 22) / 2 - 40);
      ids.forEach((inc, i) => {
        // Las parejas van en vertical para que las etiquetas no se salgan de su celda.
        const angle = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
        nodes.push({ inc, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), angle });
      });
      const alias = ids.map((i) => i.suspect_id && suspects[i.suspect_id]).find(Boolean);
      captions.push({
        x: cx,
        y: top + 14,
        text: alias ? `Presunto: ${alias}` : `Grupo de ${group.length} ${group.length === 1 ? "caso" : "casos"}`,
        alias: Boolean(alias),
      });
    });
    top += h + 36; // Separa la etiqueta inferior de un grupo del título del siguiente.
  });
  const H = Math.max(top - 36, 120);
  const pos = new Map(nodes.map((n) => [n.inc.id, n]));

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} overflow="visible" className={`h-auto w-full ${compact ? "mx-auto max-w-md" : ""}`} role="img" aria-label="Red de vínculos entre casos">
        {captions.map((c, i) => (
          <text key={i} x={c.x} y={c.y} textAnchor="middle" fontSize={12} fontWeight={600}
            fill={c.alias ? "var(--critical-ink)" : "var(--muted)"}>
            {c.text}
          </text>
        ))}
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
              strokeDasharray={l.status === "pendiente" ? "5 5" : undefined}
            >
              <title>{`${caseCode(a.inc.id)} ↔ ${caseCode(b.inc.id)} · coincidencia ${pct(l.score)} · ${l.status === "confirmado" ? "conexión confirmada por analista" : "pendiente de revisión"}`}</title>
            </line>
          );
        })}
        {nodes.map(({ inc, x, y, angle }) => {
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const side = cos >= 0.3 ? "start" : cos <= -0.3 ? "end" : "middle";
          const lx = x + cos * 16;
          // Arriba: el texto sube; abajo: baja una línea para no tapar el nodo.
          const ly = side === "middle" ? (sin < 0 ? y - 30 : y + 24) : y - 6;
          const title = inc.title.length > maxLabel ? `${inc.title.slice(0, maxLabel - 1)}…` : inc.title;
          return (
            <a key={inc.id} href={`/panel/casos/${inc.id}`}>
              <title>{`Caso ${caseCode(inc.id)} · ${inc.title} · riesgo ${inc.risk_level} (${inc.risk_score})`}</title>
              <circle cx={x} cy={y} r={14} fill="transparent" />
              <RiskNode x={x} y={y} level={inc.risk_level} />
              <text x={lx} y={ly} textAnchor={side} fontSize={11} fill="var(--fg-2)">
                <tspan x={lx} fontWeight={700} fill="var(--fg)">{caseCode(inc.id)}</tspan>
                <tspan x={lx} dy={13}>{title}</tspan>
              </text>
            </a>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-fg-2">
        <span>Discontinua: pendiente · Continua: confirmada por analista</span>
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
