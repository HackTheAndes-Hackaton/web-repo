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
import { Empty } from "./ui";

const METER: Record<RiskLevel, { headline: string; ink: string; color: string }> = {
  bajo: { headline: "Riesgo bajo", ink: "text-good-ink", color: "var(--good)" },
  medio: { headline: "Sospechosa", ink: "text-warning-ink", color: "var(--warning)" },
  alto: { headline: "Posible estafa", ink: "text-critical", color: "var(--critical)" },
};

/** Barra de riesgo con el mismo diseño que la pantalla de llamada de la app. */
export function RiskMeter({ score, level }: { score: number; level: RiskLevel }) {
  const m = METER[level];
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">Riesgo de estafa</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className={`text-xl font-bold ${m.ink}`}>{m.headline}</div>
        <div className={`tabular text-5xl font-bold leading-none ${m.ink}`}>{score}%</div>
      </div>
      <div
        className="mt-4 h-3 w-full overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label="Riesgo estimado"
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${score}%`,
            background: `linear-gradient(90deg, color-mix(in srgb, ${m.color} 55%, transparent), ${m.color})`,
          }}
        />
      </div>
      <p className="mt-3 text-xs text-muted">
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
          <li key={s.id} className="rounded-3xl bg-surface p-5 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm font-bold">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-critical-wash text-critical">
                  <TriangleAlert size={14} aria-hidden />
                </span>
                {SIGNAL_LABELS[s.type] ?? s.type}
              </span>
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">
                {s.source === "ia" ? "IA" : "Reglas"} · confianza {pct(s.confidence)}
              </span>
            </div>
            <blockquote className="mt-3 rounded-2xl bg-critical-wash px-4 py-2.5 text-sm text-critical-ink">
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

/**
 * Cronología: cada fragmento transcrito (dato observado) con las señales que la
 * IA infirió de él justo debajo, marcadas como inferencia.
 */
const AGENT_SPEAKER = /^(agent|agente|asistente|tiskz|ia)$/i;

/** Nombre legible del hablante: la API envía valores como "caller", "agent" o "user". */
function speakerLabel(speaker: string | null): string {
  switch ((speaker ?? "").toLowerCase()) {
    case "":
    case "caller":
    case "interlocutor":
      return "Quien llama";
    case "agent":
    case "agente":
    case "asistente":
    case "tiskz":
    case "ia":
      return "Tiskz IA";
    case "user":
    case "usuario":
      return "Usuario";
    default:
      return speaker ?? "Quien llama";
  }
}

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
        const agent = AGENT_SPEAKER.test(seg.speaker ?? "");
        const note = seg.text.startsWith("(");
        return (
          <li key={seg.id} id={`seg-${seg.id}`} className="relative grid scroll-mt-24 grid-cols-[3rem_1.75rem_1fr] gap-x-2">
            <span className="tabular pt-3 text-right text-xs font-medium text-muted">{fmtOffset(seg.t_offset)}</span>
            <span className="relative flex justify-center">
              {!last && <span className="absolute top-9 bottom-0 w-px bg-line" aria-hidden />}
              <span
                className={`relative mt-2 grid h-7 w-7 place-items-center rounded-full ${
                  flagged ? "bg-critical-wash text-critical" : agent ? "bg-brand text-white" : "bg-accent-wash text-accent"
                }`}
              >
                {flagged ? <TriangleAlert size={13} aria-hidden /> : <AudioLines size={13} aria-hidden />}
              </span>
            </span>
            <div className={`flex min-w-0 flex-col ${agent ? "items-end" : "items-start"} ${last ? "" : "pb-5"}`}>
              {(seg.speaker || flagged) && (
                <div className={`mb-1 px-1 text-xs font-semibold ${flagged ? "text-critical" : agent ? "text-accent" : "text-muted"}`}>
                  {speakerLabel(seg.speaker)}
                  {flagged && " · sospechoso"}
                </div>
              )}
              <div
                className={`max-w-xl px-4 py-2.5 ${
                  agent
                    ? "bg-brand rounded-[1.25rem] rounded-br-md text-white"
                    : flagged
                      ? "rounded-[1.25rem] rounded-bl-md bg-critical-wash text-critical-ink ring-1 ring-critical/40"
                      : "rounded-[1.25rem] rounded-bl-md bg-surface text-fg shadow-soft"
                }`}
              >
                <p className={`text-[15px] leading-relaxed ${note ? "italic opacity-70" : ""}`}>{seg.text}</p>
              </div>
              {flags.length > 0 && (
                <ul className="mt-2 w-full max-w-xl space-y-1.5">
                  {flags.map((f) => (
                    <li key={f.id} className="flex gap-2 rounded-2xl bg-surface px-3 py-2 text-xs shadow-soft">
                      <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                      <span className="text-fg-2">
                        <span className="font-semibold text-fg">{SIGNAL_LABELS[f.type] ?? f.type}</span>
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
        <thead className="text-[11px] uppercase tracking-wider text-muted">
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
              <td className="tabular py-2.5 pr-3 font-semibold">{e.value}</td>
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
