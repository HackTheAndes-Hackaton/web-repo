import type { ReactNode } from "react";
import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";
import { logout } from "@/app/actions";
import { APP_NAME } from "@/lib/format";
import type { Session } from "@/lib/types";
import { LiveRefresh } from "./LiveRefresh";
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
 */
export function AppShell({
  session,
  workspace,
  groups,
  pollMs,
  children,
}: {
  session: Session;
  workspace: string;
  groups: NavGroup[];
  pollMs?: number;
  children: ReactNode;
}) {
  const home = session.role === "analista" ? "/panel" : "/app";
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="no-print border-b border-line bg-sidebar lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center gap-3 px-4 py-3 lg:py-4">
          <Link href={home} className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-white">
              <ShieldCheck size={18} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight">{APP_NAME}</span>
              <span className="block truncate text-xs leading-tight text-muted">{workspace}</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            <LiveRefresh pollMs={pollMs} />
            <form action={logout}>
              <button
                className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface hover:text-fg"
                aria-label="Cambiar perfil"
              >
                <LogOut size={16} aria-hidden />
              </button>
            </form>
          </div>
        </div>

        <div className="px-2 pb-2 lg:flex-1 lg:px-3 lg:pt-2">
          <SidebarNav groups={groups} />
        </div>

        <div className="hidden border-t border-line p-3 lg:block">
          <div className="mb-3 px-1">
            <LiveRefresh pollMs={pollMs} />
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-1">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-wash text-xs font-semibold text-accent-ink">
              {initials(session.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{session.name}</div>
              <div className="truncate text-xs text-muted">{session.role === "analista" ? "Analista" : "Usuario"}</div>
            </div>
            <form action={logout}>
              <button
                className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface hover:text-fg"
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
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
