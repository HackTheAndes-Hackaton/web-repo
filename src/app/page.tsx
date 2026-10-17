import Link from "next/link";
import { selectDemoUser, resetDemo } from "./actions";
import { APP_NAME } from "@/lib/format";
import { buttonCls, TiskzLogo } from "@/components/ui";

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-brand px-4 py-12 text-white">
      <div aria-hidden className="pointer-events-none absolute -top-40 -left-32 h-[28rem] w-[28rem] rounded-full bg-white/10" />
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <TiskzLogo size={84} onDark />
          <div className="mt-4 text-[34px] font-bold tracking-tight">{APP_NAME}</div>
          <h1 className="mt-1 text-lg font-semibold text-white/90">Panel de análisis de incidentes</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-white/80">
            Reportes, transcripciones, gráficas y posibles vínculos entre casos de estafa y extorsión. El riesgo es una
            estimación a partir de señales observadas, nunca una acusación.
          </p>
        </div>

        <form action={selectDemoUser} className="mt-8 rounded-3xl bg-surface p-6 text-fg shadow-soft">
          <input type="hidden" name="userId" value="usr_analista" />
          <div className="text-xs font-semibold tracking-widest text-muted">ACCESO DE DEMOSTRACIÓN</div>
          <div className="mt-1 text-[17px] font-semibold">Analista demo</div>
          <div className="text-sm text-muted">Unidad de Atención a Víctimas (demo)</div>
          <button className={`${buttonCls.primary} mt-5 w-full py-3 text-[15px]`}>Entrar al panel</button>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-white/80">
          <Link href="/api/v1/openapi.json" prefetch={false} className="hover:text-white">
            API: /api/v1 (OpenAPI)
          </Link>
          <form action={resetDemo}>
            <button className="rounded-full px-3 py-1.5 font-medium hover:bg-white/15 hover:text-white">
              Restablecer datos de demo
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
