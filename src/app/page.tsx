import { selectDemoUser, resetDemo } from "./actions";
import { APP_NAME } from "@/lib/format";
import { buttonCls } from "@/components/ui";

const PROFILES = [
  {
    userId: "usr_ana",
    title: "Usuario de la aplicación",
    who: "Ana (usuaria demo)",
    points: [
      "Activa o detiene la captura desde el celular",
      "Ve las señales de riesgo explicadas en vivo",
      "Revisa su reporte y decide qué comparte",
    ],
  },
  {
    userId: "usr_analista",
    title: "Analista autorizado",
    who: "Unidad de Atención a Víctimas (demo)",
    points: [
      "Revisa solo los casos compartidos con su organización",
      "Explora vínculos por voz, datos y contenido",
      "Confirma o descarta vínculos y documenta conclusiones",
    ],
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-8 px-4 py-12">
      <div>
        <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white">
            ◆
          </span>
          {APP_NAME}
          <span className="text-xs font-normal text-muted">(nombre provisional)</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Apoyo durante conversaciones de riesgo y reportes listos para revisar
        </h1>
        <p className="mt-3 max-w-2xl text-fg-2">
          Desde el celular o la computadora, el micrófono capta la conversación autorizada, la IA señala posibles señales
          de engaño y la persona decide qué hacer y qué compartir. El resultado es un <strong>riesgo estimado con señales observadas</strong>, nunca una acusación.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PROFILES.map((p) => (
          <form key={p.userId} action={selectDemoUser} className="flex flex-col rounded-xl border border-line bg-surface p-5">
            <input type="hidden" name="userId" value={p.userId} />
            <div className="text-xs font-medium uppercase tracking-wide text-muted">{p.title}</div>
            <div className="mt-1 text-lg font-semibold">{p.who}</div>
            <ul className="mt-3 flex-1 space-y-1.5 text-sm text-fg-2">
              {p.points.map((pt) => (
                <li key={pt} className="flex gap-2">
                  <span aria-hidden className="text-accent">
                    ✓
                  </span>
                  {pt}
                </li>
              ))}
            </ul>
            <button className={`${buttonCls.primary} mt-5`}>Entrar como {p.title.toLowerCase()}</button>
          </form>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-muted">
        <p>
          Todos los incidentes de la demo son ficticios y las voces son muestras sintéticas o de participantes voluntarios.
        </p>
        <form action={resetDemo}>
          <button className={buttonCls.ghost}>Restablecer datos de demo</button>
        </form>
      </div>
    </main>
  );
}
