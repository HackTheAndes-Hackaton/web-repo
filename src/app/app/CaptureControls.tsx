"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { sendTranscript, startCapture, stopCapture } from "@/app/actions";
import { buttonCls } from "@/components/ui";
import type { Channel } from "@/lib/types";

const SCRIPTS: Record<string, { label: string; lines: string[] }> = {
  legitima: {
    label: "Conversación legítima",
    lines: [
      "Hola, soy yo, tu hermana. ¿Cómo sigues de la gripa?",
      "Oye, ¿me podrías prestar 1500 pesos para el dentista? Te los regreso la próxima quincena.",
      "No hay prisa, si quieres lo platicamos el domingo en casa de mamá.",
    ],
  },
  familiar: {
    label: "Falso familiar en problemas",
    lines: [
      "Hola tía, soy tu sobrino, ¿no me reconoces? Cambié de número.",
      "Tuve un accidente y me detuvieron, el licenciado Ramírez dice que necesito pagar ahora mismo.",
      "Deposita 12 mil pesos a la cuenta 4152 3138 0011 2233, es urgente.",
      "Por favor no le digas a mi mamá y no cuelgues, el licenciado te va a dar instrucciones.",
    ],
  },
  banco: {
    label: "Falso banco",
    lines: [
      "Buenas tardes, le hablamos del departamento de fraudes de su banco.",
      "Detectamos un cargo de 9 mil pesos. Para cancelarlo necesito el código que le acaba de llegar por mensaje.",
      "Es urgente, en 3 minutos se procesa. No cuelgue por favor.",
    ],
  },
};

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

function getRecognition(): SpeechRec | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function CaptureControls({
  activeIncidentId,
  activeChannel,
}: {
  activeIncidentId: string | null;
  activeChannel: Channel | null;
}) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [scriptRunning, setScriptRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const wantListening = useRef(false);
  const scriptCancel = useRef(false);

  const send = async (incidentId: string, value: string, channel: Channel) => {
    const res = await sendTranscript(incidentId, value, channel);
    if (res.ok && res.error) setNotice(res.error);
  };

  useEffect(() => {
    return () => {
      wantListening.current = false;
      recRef.current?.stop();
      scriptCancel.current = true;
    };
  }, []);

  // Si termina la captura en otro lado, se apaga el micrófono.
  useEffect(() => {
    if (!activeIncidentId) {
      wantListening.current = false;
      recRef.current?.stop();
      scriptCancel.current = true;
    }
  }, [activeIncidentId]);

  const startListening = (incidentId: string) => {
    const rec = getRecognition();
    if (!rec) {
      setSpeechError("Este navegador no tiene reconocimiento de voz. Usa Chrome o Edge, o escribe las frases.");
      return;
    }
    rec.lang = "es-MX";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const finalText = r[0].transcript.trim();
          if (finalText) void send(incidentId, finalText, "navegador");
        } else partial += r[0].transcript;
      }
      setInterim(partial);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        wantListening.current = false;
        setSpeechError("No se dio permiso para usar el micrófono.");
      }
    };
    rec.onend = () => {
      // El reconocimiento se corta solo tras silencios; se reanuda mientras siga activo.
      if (wantListening.current) {
        try {
          rec.start();
        } catch {}
      } else {
        setListening(false);
        setInterim("");
      }
    };
    recRef.current = rec;
    wantListening.current = true;
    setSpeechError(null);
    rec.start();
    setListening(true);
  };

  const stopListening = () => {
    wantListening.current = false;
    recRef.current?.stop();
    setListening(false);
  };

  const begin = (channel: Channel) =>
    startTransition(async () => {
      setNotice(null);
      const id = await startCapture(channel);
      if (channel === "navegador") startListening(id);
    });

  const end = () =>
    startTransition(async () => {
      stopListening();
      scriptCancel.current = true;
      if (activeIncidentId) await stopCapture(activeIncidentId);
    });

  const runScript = async (key: string) => {
    if (!activeIncidentId) return;
    scriptCancel.current = false;
    setScriptRunning(key);
    for (const line of SCRIPTS[key].lines) {
      if (scriptCancel.current) break;
      await send(activeIncidentId, line, "manual");
      await new Promise((r) => setTimeout(r, 2500));
    }
    setScriptRunning(null);
  };

  if (!activeIncidentId) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-fg-2">
          Al iniciar autorizas capturar y analizar esta conversación. Compartirla con una organización es una decisión
          aparte que tomas después.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className={buttonCls.primary} disabled={pending} onClick={() => begin("navegador")}>
            ● Escuchar con el micrófono
          </button>
          <button className={buttonCls.secondary} disabled={pending} onClick={() => begin("manual")}>
            Captura manual / guion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={buttonCls.danger} disabled={pending} onClick={end}>
          ■ Detener captura
        </button>
        {activeChannel === "navegador" &&
          (listening ? (
            <button className={buttonCls.secondary} onClick={stopListening}>
              Pausar micrófono
            </button>
          ) : (
            <button className={buttonCls.secondary} onClick={() => startListening(activeIncidentId)}>
              Reanudar micrófono
            </button>
          ))}
        <span className="text-xs text-muted">
          {activeChannel === "navegador"
              ? listening
                ? "Escuchando con el micrófono del navegador…"
                : "Micrófono en pausa."
              : "Agrega frases a mano o reproduce un guion."}
        </span>
      </div>

      {listening && (
        <p className="min-h-6 rounded-md bg-surface-2 px-3 py-1.5 text-sm italic text-muted">{interim || "…"}</p>
      )}
      {speechError && <p className="text-xs text-critical-ink">{speechError}</p>}
      {notice && <p className="text-xs text-warning-ink">▲ {notice}</p>}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value) return;
          setText("");
          startTransition(() => send(activeIncidentId, value, "manual"));
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe lo que dice el interlocutor…"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button className={buttonCls.secondary} disabled={pending || !text.trim()}>
          Analizar
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Guion de demo:</span>
        {Object.entries(SCRIPTS).map(([key, s]) => (
          <button
            key={key}
            className="rounded-md border border-line px-2 py-1 text-fg-2 hover:bg-surface-2 disabled:opacity-50"
            disabled={scriptRunning !== null}
            onClick={() => void runScript(key)}
          >
            {scriptRunning === key ? "Reproduciendo…" : s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
