import Link from "next/link";
import { ArrowRight, BellRing, Bot, Download, LayoutDashboard, Network, PhoneIncoming } from "lucide-react";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/format";
import { BrandLogo, buttonCls, PulsingShield } from "@/components/ui";

/** APK publicado en Google Drive: descarga directa, sin la página de aviso de Drive para archivos grandes. APK_URL lo reemplaza. */
const APK_URL = process.env.APK_URL || "https://drive.usercontent.google.com/download?id=1ai_IcjIMNy9Y_RSWWwc6ulf9oaJj3rBn&export=download&confirm=t";

function Step({ n, icon, title, body }: { n: number; icon: ReactNode; title: string; body: string }) {
  return (
    <li className="rounded-3xl bg-surface p-6 shadow-soft">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-wash text-accent-ink">{icon}</span>
        <span className="tabular text-xs font-semibold text-muted">PASO {n}</span>
      </div>
      <h3 className="mt-4 text-lg font-bold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-fg-2">{body}</p>
    </li>
  );
}

function ApkButton({ className = "" }: { className?: string }) {
  if (!APK_URL) {
    return (
      <span
        className={`inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-full bg-white/75 px-6 py-3 text-sm font-semibold text-accent-ink/70 shadow-soft ${className}`}
        aria-disabled="true"
        title="El APK todavía no está publicado"
      >
        <Download size={17} aria-hidden />
        APK disponible pronto
      </span>
    );
  }
  return (
    <a
      href={APK_URL}
      download
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-accent-ink shadow-soft transition hover:bg-accent-wash ${className}`}
    >
      <Download size={17} aria-hidden />
      Descargar APK
    </a>
  );
}

export default function Home() {
  return (
    <main className="flex-1">
      <section className="bg-brand relative overflow-hidden text-white">
        <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-6 sm:px-10">
          <nav className="flex items-center justify-between py-6">
            <span className="flex items-center gap-3 text-xl font-bold">
              <BrandLogo size={40} onDark />
              {APP_NAME}
            </span>
            <Link href="/panel" className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/85 hover:text-white">
              Panel administrativo
              <ArrowRight size={15} aria-hidden />
            </Link>
          </nav>

          <div className="grid items-center gap-10 py-12 lg:grid-cols-[1.2fr_1fr] lg:py-20">
            <div>
              <h1 className="max-w-xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
                Que la IA conteste primero las llamadas que no conoces
              </h1>
              <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-white/85">
                {APP_NAME} atiende los números desconocidos, escucha cómo empieza la conversación y te avisa si suena a
                estafa o extorsión. Tus contactos suenan como siempre.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ApkButton />
                <Link
                  href="/panel"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-accent-ink shadow-soft transition hover:bg-accent-wash"
                >
                  <LayoutDashboard size={17} aria-hidden />
                  Ir al panel administrativo
                </Link>
              </div>
              <p className="mt-4 text-xs text-white/70">App para Android. Al instalarla, elígela como tu app de teléfono.</p>
            </div>
            <div className="hidden justify-center lg:flex">
              <PulsingShield size={240} />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <h2 className="text-2xl font-bold tracking-tight">Cómo funciona</h2>
        <ol className="mt-6 grid gap-5 md:grid-cols-3">
          <Step n={1} icon={<PhoneIncoming size={18} aria-hidden />} title="Llama un número desconocido"
            body="En lugar de sonar directo, la llamada la atiende el asistente de PhoneWard." />
          <Step n={2} icon={<Bot size={18} aria-hidden />} title="La IA escucha"
            body="Detecta señales como presión para pagar, pedidos de claves, amenazas o suplantación." />
          <Step n={3} icon={<BellRing size={18} aria-hidden />} title="Tú decides"
            body="Ves el riesgo en pantalla y decides si contestar, colgar o bloquear." />
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16 sm:px-10">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl bg-surface p-8 shadow-soft">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-wash text-accent-ink">
              <Network size={22} aria-hidden />
            </span>
            <div>
              <h2 className="text-xl font-bold">Para organizaciones</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-fg-2">
                Las llamadas que cada persona decide compartir llegan al panel: casos, señales de riesgo y grupos de
                llamadas que podrían venir del mismo estafador.
              </p>
            </div>
          </div>
          <Link href="/panel" className={buttonCls.primary}>
            Ir al panel administrativo
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          El riesgo es una estimación a partir de lo que se dice en la llamada, nunca una acusación.
        </p>
      </section>
    </main>
  );
}
