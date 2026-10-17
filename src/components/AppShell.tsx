import type { ReactNode } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { logout } from "@/app/actions";
import { APP_NAME } from "@/lib/format";
import type { Session } from "@/lib/types";
import { LiveRefresh } from "./LiveRefresh";
import { TiskzLogo } from "./ui";
import { SidebarNav, type NavGroup } from "./SidebarNav";

function initials(name: string) {
  return name
    .replace(/\(.*\)/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/**
 * Marco de la aplicación: barra lateral con navegación agrupada y contadores,
 * y el contenido a la derecha. En pantallas chicas la barra pasa arriba.
 * Usa el degradado azul marino del encabezado de la app Android.
 */
export function AppShell({
  session,
  workspace,
  groups,
  children,
}: {
  session: Session;
  workspace: string;
  groups: NavGroup[];
  children: ReactNode;
}) {
  // En Vercel cada función es efímera: se consulta periódicamente en vez de usar SSE.
  const liveMode = process.env.VERCEL ? "poll" : "sse";
  const home = "/panel";
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="no-print bg-navy-gradient text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col">
        <div className="flex items-center gap-3 px-4 py-3 lg:px-5 lg:py-6">
          <Link href={home} className="flex min-w-0 items-center gap-3">
            <TiskzLogo size={38} onDark />
            <span className="min-w-0">
              <span className="block truncate text-xl font-bold leading-tight">{APP_NAME}</span>
              <span className="block truncate text-xs leading-tight text-white/70">{workspace}</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            <LiveRefresh mode={liveMode} />
            <form action={logout}>
              <button
                className="grid h-9 w-9 place-items-center rounded-full text-white/80 hover:bg-white/15 hover:text-white"
                aria-label="Cambiar perfil"
              >
                <LogOut size={16} aria-hidden />
              </button>
            </form>
          </div>
        </div>

        <div className="px-3 pb-3 lg:flex-1 lg:px-4 lg:pt-1">
          <SidebarNav groups={groups} />
        </div>

        <div className="hidden p-4 lg:block">
          <div className="mb-3 px-1">
            <LiveRefresh mode={liveMode} />
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-100 to-white text-sm font-bold text-accent-ink">
              {initials(session.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{session.name}</div>
              <div className="truncate text-xs text-white/70">Analista</div>
            </div>
            <form action={logout}>
              <button
                className="grid h-9 w-9 place-items-center rounded-full text-white/80 hover:bg-white/15 hover:text-white"
                title="Cambiar perfil"
                aria-label="Cambiar perfil"
              >
                <LogOut size={16} aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</div>
      </main>
    </div>
  );
}
