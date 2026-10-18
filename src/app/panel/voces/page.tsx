import Link from "next/link";
import { AudioLines, Check, Phone, X } from "lucide-react";
import { reviewVoiceAction } from "@/app/actions";
import { buttonCls, Empty, IconBubble, PageHeader, ScamTypeChip } from "@/components/ui";
import { fmtDateTime, fmtPhone, pct } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { caseCode } from "@/lib/repo";
import { listScamVoices, SAME_VOICE, type ScamVoice } from "@/lib/voices";

const STATUS = {
  pendiente: { label: "Por revisar", cls: "bg-warning-wash text-warning-ink" },
  confirmada: { label: "Confirmada", cls: "bg-critical-wash text-critical-ink" },
  descartada: { label: "Descartada", cls: "bg-surface-2 text-fg-2" },
} as const;

function VoiceCard({ voice, number }: { voice: ScamVoice; number: number }) {
  const s = STATUS[voice.status];
  const ids = voice.calls.map((c) => c.id);
  return (
    <li className={`rounded-3xl bg-surface p-6 shadow-soft ${voice.status === "descartada" ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconBubble tone={voice.status === "descartada" ? "neutral" : "critical"}>
            <AudioLines size={18} aria-hidden />
          </IconBubble>
          <div>
            <h3 className="text-lg font-bold leading-tight">Voz {number}</h3>
            <p className="mt-0.5 text-sm text-fg-2">
              {voice.calls.length} {voice.calls.length === 1 ? "llamada" : "llamadas"}
              {voice.similarity !== null && <> · parecido {pct(voice.similarity)}</>}
              {voice.calls.some((c) => c.audio.length > 0) && <> · con audio</>}
              {" · "}última {fmtDateTime(voice.last_seen)}
            </p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${s.cls}`}>{s.label}</span>
      </div>

      {(voice.numbers.length > 0 || voice.scam_types.length > 0 || voice.impersonating.length > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          {voice.numbers.map((n) => (
            <span key={n} className="tabular inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1">
              <Phone size={12} className="text-muted" aria-hidden />
              {fmtPhone(n) ?? n}
            </span>
          ))}
          {voice.scam_types.map((t) => <ScamTypeChip key={t} type={t} />)}
          {voice.impersonating.map((p) => (
            <span key={p} className="rounded-full bg-warning-wash px-3 py-1 text-xs font-medium text-warning-ink">Se hace pasar por {p}</span>
          ))}
        </div>
      )}

      <ul className="mt-4 divide-y divide-line text-sm">
        {voice.calls.map((c) => (
          <li key={c.id}>
            <Link href={`/panel/casos/${c.id}`} className="flex items-center gap-3 py-2 hover:text-accent-ink">
              <span className="tabular w-16 shrink-0 font-semibold">{caseCode(c.id)}</span>
              <span className="min-w-0 flex-1 truncate text-fg-2">{c.title}</span>
              <span className="tabular shrink-0 text-xs text-muted">{fmtDateTime(c.seen_at)}</span>
            </Link>
            {c.audio.map((a) => (
              <div key={a.id} className="mb-2 flex items-center gap-3 pl-[4.75rem]">
                {/* preload="none": el WAV solo se descarga si se reproduce. */}
                <audio controls preload="none" src={`/panel/voces/audio/${a.id}`} className="h-9 w-full max-w-sm">
                  Tu navegador no puede reproducir este audio.
                </audio>
                <span className="tabular shrink-0 text-xs text-muted">{Math.round(a.duration_s)} s</span>
              </div>
            ))}
          </li>
        ))}
      </ul>

      {voice.status !== "descartada" && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {voice.status === "pendiente" && (
            <form action={reviewVoiceAction.bind(null, "confirmar")}>
              {ids.map((id) => <input key={id} type="hidden" name="incidentId" value={id} />)}
              <button className={buttonCls.primary}>
                <Check size={15} aria-hidden />
                Confirmar voz
              </button>
            </form>
          )}
          <form action={reviewVoiceAction.bind(null, "descartar")}>
            {ids.map((id) => <input key={id} type="hidden" name="incidentId" value={id} />)}
            <button className={buttonCls.secondary}>
              <X size={15} aria-hidden />
              Descartar
            </button>
          </form>
        </div>
      )}
    </li>
  );
}

export default async function ScammerVoices() {
  const { orgId } = await requireAnalyst();
  const voices = await listScamVoices(orgId);
  const pending = voices.filter((v) => v.status === "pendiente").length;
  // El número de cada voz no cambia al revisarla: sigue el orden en que apareció.
  const numbers = new Map([...voices].sort((a, b) => a.first_seen.localeCompare(b.first_seen)).map((v, i) => [v.key, i + 1]));

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/panel", label: "Análisis" },
          { href: "/panel/voces", label: "Voces de estafadores" },
        ]}
        title="Voces de estafadores"
        description={`Voces de quienes llamaron en estafas confirmadas por la IA. Las llamadas con voces parecidas (${pct(SAME_VOICE)} o más) se agrupan como una misma voz.`}
      />

      {voices.length ? (
        <>
          <p className="mb-4 text-sm text-muted">
            {voices.length} {voices.length === 1 ? "voz" : "voces"}
            {pending > 0 && <> · <span className="font-semibold text-warning-ink">{pending} por revisar</span></>}
            {" · "}Confirmar una voz la usa para reconocerla en otras llamadas; descartarla deja de usarla. Es una pista, no
            identifica a la persona.
          </p>
          <ul className="grid gap-6 lg:grid-cols-2">
            {voices.map((v) => <VoiceCard key={v.key} voice={v} number={numbers.get(v.key)!} />)}
          </ul>
        </>
      ) : (
        <Empty>
          Todavía no hay voces. Aparecen cuando la IA confirma una estafa y guarda la voz de quien llamó.
        </Empty>
      )}
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
