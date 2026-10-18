import { notFound } from "next/navigation";
import { IncidentReport, type ReportTab } from "@/components/IncidentReport";
import { requireAnalyst } from "@/lib/panel";
import { getIncidentDetail } from "@/lib/repo";

const TABS: ReportTab[] = ["conversacion", "ia", "datos"];

export default async function CaseDetail({ params, searchParams }: PageProps<"/panel/casos/[id]">) {
  const { session } = await requireAnalyst();
  const { id } = await params;
  const { tab } = await searchParams;
  // getIncidentDetail devuelve null si el caso no está compartido con esta organización.
  const detail = await getIncidentDetail(id, session);
  if (!detail) notFound();
  // Si la llamada trae conversación, es lo primero que se muestra.
  const fallback: ReportTab = detail.transcript.length > 0 ? "conversacion" : "ia";
  return (
    <IncidentReport
      detail={detail}
      tab={TABS.includes(tab as ReportTab) ? (tab as ReportTab) : fallback}
    />
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
