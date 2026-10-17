import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { requireSession } from "@/lib/session";

// Los datos son en vivo (Supabase + SSE): la navegación espera datos frescos a propósito.
export const instant = false;

async function Shell({ children }: { children: React.ReactNode }) {
  const session = await requireSession("usuario");
  return (
    <AppShell
      session={session}
      workspace="Protección personal"
      pollMs={4000}
      groups={[
        {
          title: "Mi protección",
          items: [
            { href: "/app", label: "Inicio", icon: "house", exact: true },
            { href: "/app/incidentes", label: "Mis reportes", icon: "report" },
          ],
        },
      ]}
    >
      {children}
    </AppShell>
  );
}

export default function UserLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">Cargando…</div>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
