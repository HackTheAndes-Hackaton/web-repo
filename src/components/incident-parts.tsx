import { Sparkles, TriangleAlert } from "lucide-react";
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
import { Empty, ShieldWaves } from "./ui";

const RISK_COLOR = { bajo: "var(--good)", medio: "var(--warning)", alto: "var(--critical)" };
const RISK_HEADLINE = { bajo: "Riesgo bajo", medio: "Verifica antes de actuar", alto: "Posible estafa" };

/** Tarjeta de riesgo como RiskBar de la app: titular, porcentaje grande y barra de color. */
export function RiskMeter({ score, level }: { score: number; level: RiskLevel }) {
  const color = RISK_COLOR[level];
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold tracking-widest text-muted">RIESGO DE ESTAFA</div>
          <div className="mt-0.5 text-[22px] font-bold leading-tight" style={{ color }}>
            {RISK_HEADLINE[level]}
          </div>
        </div>
        <div className="tabular text-[34px] font-bold leading-none" style={{ color }}>
          {score}%
        </div>
      </div>
      <div
        className="mt-3 h-3 w-full overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label="Riesgo estimado"
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 55%, transparent), ${color})` }}
        />
      </div>
      <p className="mt-2.5 text-sm text-muted">
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
          <li key={s.id} className="rounded-2xl bg-surface p-4 shadow-soft">
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

const AGENT_SPEAKERS = new Set(["agent", "agente", "ia", "tiskz"]);
const USER_SPEAKERS = new Set(["user", "usuario"]);

/**
 * Cronología como la transcripción de la app: burbujas de chat. El agente de
 * Tiskz va a la derecha en azul; quien llama a la izquierda en blanco, y en
 * rojo cuando el fragmento es sospechoso. Debajo, las señales que infirió la IA.
 */
export function Timeline({
  segments,
  signals,
  callerLabel = "Llamante",
}: {
  segments: Segment[];
  signals: Signal[];
  callerLabel?: string;
}) {
  if (!segments.length) return <Empty>Aún no hay fragmentos transcritos.</Empty>;
  const bySegment = new Map<string, Signal[]>();
  for (const s of signals) {
    if (!s.segment_id) continue;
    bySegment.set(s.segment_id, [...(bySegment.get(s.segment_id) ?? []), s]);
  }
  return (
    <ol className="space-y-4">
      {segments.map((seg) => {
        const flags = bySegment.get(seg.id) ?? [];
        const speaker = (seg.speaker ?? "").toLowerCase();
        const fromAgent = AGENT_SPEAKERS.has(speaker);
        const fromUser = USER_SPEAKERS.has(speaker);
        const flagged = !fromAgent && (seg.flagged || flags.length > 0);
        const note = seg.text.startsWith("(");
        return (
          <li
            key={seg.id}
            id={`seg-${seg.id}`}
            className={`flex scroll-mt-24 flex-col ${fromAgent ? "items-end" : "items-start"}`}
          >
            <div className="flex items-center gap-1.5 px-2 pb-1 text-[13px] font-semibold">
              {fromAgent ? (
                <span className="flex items-center gap-1 text-accent">
                  <ShieldWaves size={15} />
                  Tiskz IA
                </span>
              ) : flagged ? (
                <span className="flex items-center gap-1 text-critical">
                  <TriangleAlert size={14} aria-hidden />
                  {callerLabel} · sospechoso
                </span>
              ) : (
                <span className="text-muted">{fromUser ? "Usuario" : callerLabel}</span>
              )}
              <span className="tabular font-normal text-muted">· {fmtOffset(seg.t_offset)}</span>
            </div>
            <div
              className={`max-w-[34rem] px-4 py-3 text-[15px] leading-relaxed ${
                fromAgent
                  ? "rounded-[22px] rounded-br-md bg-agent text-white"
                  : flagged
                    ? "rounded-[22px] rounded-bl-md border-[1.5px] border-critical/50 bg-critical-wash text-critical-ink"
                    : "rounded-[22px] rounded-bl-md bg-surface text-fg shadow-soft"
              } ${note ? "italic opacity-80" : ""}`}
            >
              {seg.text}
            </div>
            {flags.length > 0 && (
              <ul className="mt-2 max-w-[34rem] space-y-1.5 px-2">
                {flags.map((f) => (
                  <li key={f.id} className="flex gap-2 text-xs">
                    <Sparkles size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden />
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
