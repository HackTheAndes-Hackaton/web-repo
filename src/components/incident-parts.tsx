import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { pct } from "@/lib/format";
import {
  ENTITY_LABELS,
  PROVENANCE_LABELS,
  SIGNAL_LABELS,
  type Entity,
  type RiskLevel,
  type Signal,
} from "@/lib/types";
import { Empty, IconBubble } from "./ui";

const METER: Record<RiskLevel, { headline: string; ink: string; color: string }> = {
  bajo: { headline: "Riesgo bajo", ink: "text-good-ink", color: "var(--good)" },
  medio: { headline: "Verifica antes de actuar", ink: "text-warning-ink", color: "var(--warning)" },
  alto: { headline: "Posible estafa", ink: "text-critical", color: "var(--critical)" },
};

type ConversationLine = { id: string; speaker: string | null; text: string; flagged: boolean };

const SPEAKER: Record<string, { label: string; mine: boolean; bubble: string; name: string }> = {
  agent: { label: "Asistente Tiskz", mine: true, bubble: "bg-accent text-white", name: "text-accent-ink" },
  user: { label: "Titular", mine: true, bubble: "bg-good-wash text-good-ink", name: "text-good-ink" },
  caller: { label: "Quien llama", mine: false, bubble: "bg-surface-2 text-fg", name: "text-muted" },
};

/** Conversación de la llamada como en la app: el asistente y el titular a la derecha, quien llama a la izquierda. */
export function Conversation({ lines }: { lines: ConversationLine[] }) {
  if (lines.length === 0) {
    return <Empty>Esta llamada no tiene conversación guardada. La app la envía al terminar cada llamada.</Empty>;
  }
  return (
    <ol className="space-y-3">
      {lines.map((line, i) => {
        const who = SPEAKER[line.speaker ?? "caller"] ?? SPEAKER.caller;
        const sameAsBefore = i > 0 && lines[i - 1].speaker === line.speaker;
        return (
          <li key={line.id} className={`flex flex-col ${who.mine ? "items-end" : "items-start"}`}>
            {!sameAsBefore && <span className={`mb-1 px-1 text-xs font-semibold ${who.name}`}>{who.label}</span>}
            <p
              className={`max-w-[85%] rounded-[20px] px-4 py-2.5 text-[15px] leading-relaxed ${who.bubble} ${
                who.mine ? "rounded-br-md" : "rounded-bl-md"
              } ${line.flagged ? "ring-2 ring-critical ring-offset-2 ring-offset-surface" : ""}`}
            >
              {line.text}
            </p>
            {line.flagged && (
              <span className="mt-1 flex items-center gap-1 px-1 text-xs font-medium text-critical">
                <TriangleAlert size={12} aria-hidden /> Señal de riesgo
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SheetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 font-medium text-fg">{children}</dd>
    </div>
  );
}

/**
 * Lo que la PNP pidió para actuar rápido: número, fecha, cuentas o números de Yape,
 * montos, a quién suplantó y las frases clave. Se imprime con "Imprimir / PDF".
 */
export function ComplaintSheet({
  caller,
  startedAt,
  duration,
  impersonating,
  entities,
  keyLines,
}: {
  caller: string | null;
  startedAt: string;
  duration: string;
  impersonating: string | null;
  entities: Entity[];
  keyLines: string[];
}) {
  const mentioned = entities.filter((e) => e.provenance === "mencionado");
  const accounts = mentioned.filter((e) => e.kind === "cuenta" || e.kind === "telefono");
  const amounts = mentioned.filter((e) => e.kind === "monto");
  const none = <span className="font-normal text-muted">No mencionado</span>;
  return (
    <div>
      <dl className="divide-y divide-line">
        <SheetRow label="Número que llamó"><span className="tabular">{caller ?? "Oculto"}</span></SheetRow>
        <SheetRow label="Fecha y hora">{startedAt}</SheetRow>
        <SheetRow label="Duración">{duration}</SheetRow>
        <SheetRow label="Se hizo pasar por">{impersonating ?? none}</SheetRow>
        <SheetRow label="Cuentas / Yape">
          {accounts.length ? (
            <ul className="space-y-0.5">{accounts.map((e) => <li key={e.id} className="tabular">{e.value}</li>)}</ul>
          ) : none}
        </SheetRow>
        <SheetRow label="Montos">{amounts.length ? amounts.map((e) => e.value).join(", ") : none}</SheetRow>
      </dl>
      {keyLines.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Frases clave</div>
          <ul className="space-y-1.5">
            {keyLines.map((line) => (
              <li key={line} className="rounded-xl bg-critical-wash px-3 py-2 text-sm text-critical-ink">“{line}”</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Datos tal como se dijeron en la llamada: pueden ser falsos. Sirven para preparar la denuncia, no la reemplazan.
      </p>
    </div>
  );
}

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

/** Señales que infirió la IA, con su explicación. Sin citas: el panel no guarda la transcripción. */
export function SignalList({ signals }: { signals: Signal[] }) {
  if (!signals.length) return <Empty>Sin señales de riesgo por ahora.</Empty>;
  return (
    <ul className="space-y-3">
      {[...signals].reverse().map((s) => (
        <li key={s.id} className="flex gap-3 rounded-2xl bg-surface p-4 shadow-soft">
          <IconBubble tone="warning">
            <TriangleAlert size={17} aria-hidden />
          </IconBubble>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[15px] font-semibold">{SIGNAL_LABELS[s.type] ?? s.type}</span>
              <span className="text-xs text-muted">
                {s.source === "ia" ? "IA" : "Reglas"} · confianza {pct(s.confidence)}
              </span>
            </div>
            <p className="mt-1 text-sm text-fg-2">{s.explanation}</p>
          </div>
        </li>
      ))}
    </ul>
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
