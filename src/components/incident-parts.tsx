import { AudioLines, Sparkles, TriangleAlert } from "lucide-react";
import { fmtOffset, pct } from "@/lib/format";
import {
  ENTITY_LABELS,
  PROVENANCE_LABELS,
  SIGNAL_LABELS,
  type Entity,
  type RiskLevel,
  type Segment,
  type Signal,
} from "@/lib/types";
import { Empty, RiskBadge } from "./ui";

const METER = {
  bajo: { fill: "bg-good", track: "bg-good-wash" },
  medio: { fill: "bg-warning", track: "bg-warning-wash" },
  alto: { fill: "bg-critical", track: "bg-critical-wash" },
};

export function RiskMeter({ score, level }: { score: number; level: RiskLevel }) {
  const m = METER[level];
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted">Riesgo estimado</div>
          <div className="text-5xl font-semibold leading-none">{score}</div>
        </div>
        <RiskBadge level={level} />
      </div>
      <div
        className={`mt-3 h-2.5 w-full overflow-hidden rounded-full ${m.track}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label="Riesgo estimado"
      >
        <div className={`h-full rounded-full ${m.fill} transition-all duration-500`} style={{ width: `${score}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">
        Estimación a partir de señales observadas. Una señal aislada no confirma un engaño.
      </p>
    </div>
  );
}

export function SignalList({
  signals,
  segments,
  segmentHref = (id) => `#seg-${id}`,
}: {
  signals: Signal[];
  segments: Segment[];
  segmentHref?: (segmentId: string) => string;
}) {
  if (!signals.length) return <Empty>Sin señales de riesgo por ahora.</Empty>;
  const segIdx = new Map(segments.map((s) => [s.id, s]));
  return (
    <ul className="space-y-3">
      {[...signals].reverse().map((s) => {
        const seg = s.segment_id ? segIdx.get(s.segment_id) : undefined;
        return (
          <li key={s.id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{SIGNAL_LABELS[s.type] ?? s.type}</span>
              <span className="text-xs text-muted">
                {s.source === "ia" ? "IA" : "Reglas"} · confianza {pct(s.confidence)}
              </span>
            </div>
            <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-sm italic text-fg-2">
              “{s.evidence}”
            </blockquote>
            <p className="mt-2 text-sm text-fg-2">{s.explanation}</p>
            {seg && (
              <a href={segmentHref(seg.id)} className="mt-2 inline-block text-xs font-medium text-accent-ink hover:underline">
                Ver fragmento {fmtOffset(seg.t_offset)} →
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Transcript({ segments, signals }: { segments: Segment[]; signals: Signal[] }) {
  if (!segments.length) return <Empty>Aún no hay fragmentos transcritos.</Empty>;
  const flagged = new Map<string, string[]>();
  for (const s of signals) {
    if (!s.segment_id) continue;
    flagged.set(s.segment_id, [...(flagged.get(s.segment_id) ?? []), SIGNAL_LABELS[s.type] ?? s.type]);
  }
  return (
    <ol className="space-y-2">
      {segments.map((seg) => {
        const flags = flagged.get(seg.id);
        return (
          <li
            key={seg.id}
            id={`seg-${seg.id}`}
            className={`scroll-mt-24 rounded-lg px-3 py-2 target:ring-2 target:ring-accent ${
              flags ? "bg-warning-wash" : "bg-surface-2"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="tabular">{fmtOffset(seg.t_offset)}</span>
              {flags && <span className="font-medium text-warning-ink">▲ {[...new Set(flags)].join(" · ")}</span>}
            </div>
            <p className={`mt-0.5 text-sm ${seg.text.startsWith("(") ? "italic text-muted" : "text-fg"}`}>{seg.text}</p>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Cronología: cada fragmento transcrito (dato observado) con las señales que la
 * IA infirió de él justo debajo, marcadas como inferencia.
 */
export function Timeline({ segments, signals }: { segments: Segment[]; signals: Signal[] }) {
  if (!segments.length) return <Empty>Aún no hay fragmentos transcritos.</Empty>;
  const bySegment = new Map<string, Signal[]>();
  for (const s of signals) {
    if (!s.segment_id) continue;
    bySegment.set(s.segment_id, [...(bySegment.get(s.segment_id) ?? []), s]);
  }
  return (
    <ol className="relative">
      {segments.map((seg, i) => {
        const flags = bySegment.get(seg.id) ?? [];
        const flagged = flags.length > 0;
        const last = i === segments.length - 1;
        return (
          <li key={seg.id} id={`seg-${seg.id}`} className="relative grid scroll-mt-24 grid-cols-[3rem_1.5rem_1fr] gap-x-2">
            <span className="tabular pt-2 text-right text-xs text-muted">{fmtOffset(seg.t_offset)}</span>
            <span className="relative flex justify-center">
              {!last && <span className="absolute top-7 bottom-0 w-px bg-line" aria-hidden />}
              <span
                className={`relative mt-1.5 grid h-6 w-6 place-items-center rounded-full border ${
                  flagged ? "border-warning bg-warning-wash text-warning-ink" : "border-line bg-surface text-muted"
                }`}
              >
                {flagged ? <TriangleAlert size={12} aria-hidden /> : <AudioLines size={12} aria-hidden />}
              </span>
            </span>
            <div className={`min-w-0 ${last ? "" : "pb-5"}`}>
              <div className="rounded-lg border border-line bg-surface px-3 py-2">
                <p className={`text-sm ${seg.text.startsWith("(") ? "italic text-muted" : "text-fg"}`}>{seg.text}</p>
              </div>
              {flags.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {flags.map((f) => (
                    <li key={f.id} className="flex gap-2 text-xs">
                      <Sparkles size={13} className="mt-0.5 shrink-0 text-warning-ink" aria-hidden />
                      <span className="text-fg-2">
                        <span className="font-medium text-fg">{SIGNAL_LABELS[f.type] ?? f.type}</span>
                        <span className="text-muted">
                          {" "}
                          · {f.source === "ia" ? "IA" : "Reglas"} {pct(f.confidence)}
                        </span>
                        <span className="block">{f.explanation}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function EntityTable({ entities }: { entities: Entity[] }) {
  if (!entities.length) return <Empty>No se detectaron números, cuentas ni nombres.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-medium">Tipo</th>
            <th className="py-2 pr-3 font-medium">Valor</th>
            <th className="py-2 font-medium">Procedencia</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => (
            <tr key={e.id} className="border-b border-line last:border-0">
              <td className="py-2 pr-3 text-fg-2">{ENTITY_LABELS[e.kind] ?? e.kind}</td>
              <td className="tabular py-2 pr-3 font-medium">{e.value}</td>
              <td className="py-2 text-fg-2">{PROVENANCE_LABELS[e.provenance] ?? e.provenance}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">
        Un número mostrado o un nombre pronunciado pueden ser falsos y no acreditan quién está detrás.
      </p>
    </div>
  );
}
