import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { selectDemoUser, resetDemo } from "./actions";
import { APP_NAME } from "@/lib/format";
import { buttonCls } from "@/components/ui";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-12">
      <div>
        <div className="mb-4 flex items-center gap-2.5 text-lg font-semibold">
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-white">
            <ShieldCheck size={20} />
          </span>
          {APP_NAME}
          <span className="text-xs font-normal text-muted">(nombre provisional)</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Panel de análisis de incidentes</h1>
        <p className="mt-2 text-sm text-fg-2">
          Reportes, transcripciones, gráficas y posibles vínculos entre casos de estafa y extorsión. El riesgo es una
          estimación a partir de señales observadas, nunca una acusación.
        </p>
      </div>

      <form action={selectDemoUser} className="rounded-xl border border-line bg-surface p-5">
        <input type="hidden" name="userId" value="usr_analista" />
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Acceso de demostración</div>
        <div className="mt-1 font-semibold">Analista demo</div>
        <div className="text-sm text-fg-2">Unidad de Atención a Víctimas (demo)</div>
        <button className={`${buttonCls.primary} mt-4 w-full`}>Entrar al panel</button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-muted">
        <Link href="/api/v1/openapi.json" prefetch={false} className="hover:text-fg">
          API: /api/v1 (OpenAPI)
        </Link>
        <form action={resetDemo}>
          <button className={buttonCls.ghost}>Restablecer datos de demo</button>
        </form>
      </div>
    </main>
  );
}
