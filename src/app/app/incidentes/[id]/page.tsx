import { notFound } from "next/navigation";
import { IncidentReport, type ReportTab } from "@/components/IncidentReport";
import { getIncidentDetail } from "@/lib/repo";
import { requireSession } from "@/lib/session";

const TABS: ReportTab[] = ["cronologia", "datos", "ia", "revision"];

export default async function MyReport({ params, searchParams }: PageProps<"/app/incidentes/[id]">) {
  const session = await requireSession("usuario");
  const { id } = await params;
  const { tab } = await searchParams;
  const detail = await getIncidentDetail(id, session);
  if (!detail) notFound();
  return (
    <IncidentReport
      detail={detail}
      session={session}
      tab={TABS.includes(tab as ReportTab) ? (tab as ReportTab) : "cronologia"}
    />
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
