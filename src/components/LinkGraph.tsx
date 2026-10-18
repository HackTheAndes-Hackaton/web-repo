import type { IncidentSummary, LinkView } from "@/lib/repo";
import { caseCode } from "@/lib/repo";
import { pct } from "@/lib/format";
import type { RiskLevel } from "@/lib/types";

const RISK_FILL = { bajo: "var(--good)", medio: "var(--warning)", alto: "var(--critical)" };
/** Desde este tamaño un grupo se dibuja como centro con radios: todas las líneas entre pares no se pueden leer. */
const HUB_FROM = 7;

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

/** Dato que comparte la mayoría de las conexiones del grupo (número, cuenta, voz…), para rotular el centro. */
export function commonTrait(links: LinkView[]) {
  const counts = new Map<string, number>();
  for (const l of links) {
    const seen = new Set<string>();
    for (const r of l.reasons) {
      let label: string | null = null;
      const origin = /^Mismo número de origen: ([^\s.]+)/.exec(r.detail);
      const repeated = /^([^:]+) repetid[oa]: (\S+)/.exec(r.detail);
      if (origin) label = `Mismo número: ${origin[1]}`;
      else if (repeated) label = `${repeated[1]}: ${repeated[2]}`;
      else if (r.kind === "voz") label = "Voz parecida";
      if (label && !seen.has(label)) {
        seen.add(label);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] >= links.length / 2 ? best[0] : null;
}

interface Placed { inc: IncidentSummary; x: number; y: number; angle: number }
interface Hub {
  key: string;
  x: number;
  y: number;
  r: number;
  count: number;
  href: string;
  mix: string;
  mixY: number;
  members: Placed[];
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
  // Con dos columnas las etiquetas se acortan para que no invadan la celda vecina.
  const maxLabel = cols === 1 && !compact ? 28 : 14;

  const cellH = (size: number) => (size >= HUB_FROM ? 300 : size <= 2 ? 170 : 250);
  const rows: string[][][] = [];
  for (let i = 0; i < groups.length; i += cols) rows.push(groups.slice(i, i + cols));
  let top = 0;
  const nodes: Placed[] = [];
  const hubs: Hub[] = [];
  const captions: { x: number; y: number; text: string; sub: string | null; alias: boolean }[] = [];
  rows.forEach((row) => {
    const h = Math.max(...row.map((g) => cellH(g.length)));
    row.forEach((group, col) => {
      const cx = cellW * col + cellW / 2;
      const cy = top + 40 + (h - 40) / 2;
      const ids = group.map((id) => byId.get(id)!).sort((a, b) => a.started_at.localeCompare(b.started_at));
      const groupLinks = visible.filter((l) => group.includes(l.incident_a));
      const alias = ids.map((i) => i.suspect_id && suspects[i.suspect_id]).find(Boolean);
      const big = group.length >= HUB_FROM;
      captions.push({
        x: cx,
        y: top + 14,
        text: alias ? `Presunto: ${alias}` : `Grupo de ${group.length} ${group.length === 1 ? "caso" : "casos"}`,
        sub: big ? commonTrait(groupLinks) ?? `${groupLinks.length} conexiones` : null,
        alias: Boolean(alias),
      });
      if (big) {
        const R = Math.min(cellW / 2 - 28, (h - 40) / 2 - 26);
        const members = ids.map((inc, i) => {
          const angle = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
          return { inc, x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle), angle };
        });
        const levels = (["alto", "medio", "bajo"] as const)
          .map((lvl) => [lvl, ids.filter((i) => i.risk_level === lvl).length] as const)
          .filter(([, n]) => n > 0);
        hubs.push({
          key: group[0],
          x: cx,
          y: cy,
          r: 30,
          count: group.length,
          // Mismo ancla que buildLinkGroups en la página de Vínculos.
          href: `/panel/vinculos#grupo-${[...group].sort()[0]}`,
          mix: levels.map(([lvl, n]) => `${n} ${lvl}`).join(" · "),
          mixY: cy + R + 22,
          members,
        });
        return;
      }
      // Radio que deja sitio a la etiqueta (≈6 px por carácter) dentro de la celda.
      const room = cellW / 2 - 20 - maxLabel * 6;
      const r = group.length <= 2 ? (h - 40) / 2 - 34 : Math.max(40, Math.min(room, (h - 40) / 2 - 36));
      ids.forEach((inc, i) => {
        // Las parejas van en vertical para que las etiquetas no se salgan de su celda.
        const angle = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
        nodes.push({ inc, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), angle });
      });
    });
    top += h + 28; // Separa la etiqueta inferior de un grupo del título del siguiente.
  });
  const H = Math.max(top - 28, 120);
  const pos = new Map(nodes.map((n) => [n.inc.id, n]));

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} overflow="visible" className={`h-auto w-full ${compact ? "mx-auto max-w-md" : ""}`} role="img" aria-label="Red de vínculos entre casos">
        {captions.map((c, i) => (
          <text key={i} x={c.x} y={c.y} textAnchor="middle" fontSize={12} fontWeight={600}
            fill={c.alias ? "var(--critical-ink)" : "var(--muted)"}>
            {c.text}
            {c.sub && <tspan x={c.x} dy={15} fontSize={11} fontWeight={500} fill="var(--fg-2)">{c.sub}</tspan>}
          </text>
        ))}

        {hubs.map((hub) => (
          <g key={hub.key}>
            {hub.members.map((m) => (
              <line key={m.inc.id} x1={hub.x + Math.cos(m.angle) * hub.r} y1={hub.y + Math.sin(m.angle) * hub.r}
                x2={m.x} y2={m.y} stroke="var(--brand-3)" strokeWidth={1.25} strokeOpacity={0.7} />
            ))}
            <a href={hub.href}>
              <title>{`Grupo de ${hub.count} casos · ver el grupo y su evidencia`}</title>
              <circle cx={hub.x} cy={hub.y} r={hub.r} fill="var(--accent-wash)" stroke="var(--accent)" strokeWidth={2} />
              <text x={hub.x} y={hub.y + 2} textAnchor="middle" fontSize={18} fontWeight={700} fill="var(--accent-ink)">{hub.count}</text>
              <text x={hub.x} y={hub.y + 15} textAnchor="middle" fontSize={9} fill="var(--accent-ink)">casos</text>
            </a>
            {hub.members.map((m) => (
              <a key={m.inc.id} href={`/panel/casos/${m.inc.id}`}>
                <title>{`Caso ${caseCode(m.inc.id)} · ${m.inc.title} · riesgo ${m.inc.risk_level} (${m.inc.risk_score})`}</title>
                <circle cx={m.x} cy={m.y} r={10} fill="transparent" />
                <RiskNode x={m.x} y={m.y} level={m.inc.risk_level} size={6} />
              </a>
            ))}
            <text x={hub.x} y={hub.mixY} textAnchor="middle" fontSize={11} fill="var(--fg-2)">Riesgo: {hub.mix}</text>
          </g>
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
        {hubs.length > 0 && (
          <span className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden>
              <circle r={6} fill="var(--accent-wash)" stroke="var(--accent)" strokeWidth={1.5} />
            </svg>
            Grupo grande ({HUB_FROM}+ casos): el centro resume lo que comparten; cada punto es un caso
          </span>
        )}
      </figcaption>
    </figure>
  );
}
