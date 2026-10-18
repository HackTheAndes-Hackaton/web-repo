import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { getOrg, navCounts } from "@/lib/repo";
import { requireSession } from "@/lib/session";

// Los datos son en vivo (Supabase + SSE): la navegación espera datos frescos a propósito.
export const instant = false;

async function Shell({ children }: { children: React.ReactNode }) {
  const session = await requireSession("analista");
  const [org, counts] = session.orgId
    ? await Promise.all([getOrg(session.orgId), navCounts(session.orgId)])
    : [undefined, { cases: 0, links: 0, groups: 0 }];
  return (
    <AppShell
      session={session}
      workspace={org?.name ?? "Panel de análisis"}
      groups={[
        { title: "Análisis", items: [{ href: "/panel", label: "Resumen", icon: "dashboard", exact: true }] },
        {
          title: "Investigación",
          items: [
            { href: "/panel/casos", label: "Casos", icon: "cases", count: counts.cases },
            { href: "/panel/vinculos", label: "Vínculos", icon: "links", count: counts.groups },
            { href: "/panel/informes", label: "Informes", icon: "reports" },
          ],
        },
        { title: "Configuración", items: [{ href: "/panel/integraciones", label: "Integraciones", icon: "key" }] },
      ]}
    >
      {children}
    </AppShell>
  );
}

export default function PanelLayout({ children }: LayoutProps<"/panel">) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">Cargando…</div>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
