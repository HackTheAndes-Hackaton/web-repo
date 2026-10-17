import Link from "next/link";
import { Activity, Fingerprint, Network } from "lucide-react";
import type { ReactNode } from "react";
import { selectDemoUser, resetDemo } from "./actions";
import { APP_NAME } from "@/lib/format";
import { BrandLogo, buttonCls, PulsingShield } from "@/components/ui";

function Feature({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="bg-glass grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ring-white/25">{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-sm text-white/75">{body}</span>
      </span>
    </li>
  );
}

export default function Home() {
  return (
    <main className="grid flex-1 lg:grid-cols-[1.1fr_1fr]">
      <section className="bg-brand relative overflow-hidden px-6 py-10 text-white sm:px-12 lg:py-16">
        <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="relative flex h-full flex-col">
          <div className="flex items-center gap-3 text-xl font-bold">
            <BrandLogo size={40} onDark />
            {APP_NAME}
          </div>

          <div className="my-10 flex flex-1 flex-col items-center justify-center text-center lg:my-0">
            <PulsingShield size={176} />
            <h1 className="mt-6 max-w-md text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Panel de análisis de incidentes
            </h1>
            <p className="mt-3 max-w-md text-sm text-white/80">
              Reportes, transcripciones, gráficas y posibles vínculos entre casos de estafa y extorsión.
            </p>
          </div>

          <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <Feature icon={<Activity size={18} aria-hidden />} title="Riesgo en vivo" body="Señales observadas en cada llamada." />
            <Feature icon={<Network size={18} aria-hidden />} title="Vínculos entre casos" body="Datos y guiones que se repiten." />
            <Feature icon={<Fingerprint size={18} aria-hidden />} title="Huella de voz" body="Similitud como pista, no identidad." />
          </ul>
        </div>
      </section>

      <section className="flex flex-col justify-center gap-6 px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <form action={selectDemoUser} className="rounded-3xl bg-surface p-6 shadow-soft">
            <input type="hidden" name="userId" value="usr_analista" />
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">Acceso de demostración</div>
            <div className="mt-4 flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-wash text-sm font-bold text-accent-ink">AD</span>
              <div>
                <div className="font-bold">Analista demo</div>
                <div className="text-sm text-fg-2">Unidad de Atención a Víctimas (demo)</div>
              </div>
            </div>
            <button className={`${buttonCls.primary} mt-6 w-full py-3`}>Entrar al panel</button>
          </form>

          <p className="mt-5 text-center text-xs text-muted">
            El riesgo es una estimación a partir de señales observadas, nunca una acusación.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <Link href="/api/v1/openapi.json" prefetch={false} className="font-medium hover:text-accent">
              API: /api/v1 (OpenAPI)
            </Link>
            <form action={resetDemo}>
              <button className={buttonCls.ghost}>Restablecer datos de demo</button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
