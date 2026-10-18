import Link from 'next/link';
import {ReportSelectionForm} from '@/components/ReportSelectionForm';
import {Card,Empty,PageHeader} from '@/components/ui';
import {fmtDateTime} from '@/lib/format';
import {buildLinkGroups} from '@/lib/link-groups';
import {requireAnalyst} from '@/lib/panel';
import {listLinks,listSharedIncidents} from '@/lib/repo';
import {listLatestReportVersions} from '@/lib/reports/versions';

export default async function ReportsPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const {orgId}=await requireAnalyst();
  const [reports,incidents,links]=await Promise.all([
    listLatestReportVersions(orgId),listSharedIncidents(orgId),listLinks(orgId),
  ]);
  const {error}=await searchParams;
  const ready=incidents.filter(item=>item.simulated===true&&item.status==='finalizado'&&
    !item.sharing_revoked_at&&item.consent_snapshot?.report_storage===true&&
    item.consent_snapshot?.report_sharing===true&&
    (item.analysis_meta?.report_generation as {status?:string;provider?:string}|undefined)?.status==='completed'&&
    (item.analysis_meta?.report_generation as {status?:string;provider?:string}|undefined)?.provider==='maritime'&&
    Boolean(item.summary?.trim()));
  const eligible=new Set(ready.map(item=>item.id));
  const groups=buildLinkGroups(ready,links.filter(link=>eligible.has(link.incident_a)&&eligible.has(link.incident_b)));
  const byId=new Map(ready.map(item=>[item.id,item]));
  return <>
    <PageHeader crumbs={[{href:'/panel',label:'Análisis'},{href:'/panel/informes',label:'Informes'}]}
      title="Informes de investigación" description="Versiones guardadas por analistas a partir de casos ficticios y hallazgos de Maritime." />
    {error&&<p role="alert" className="mb-5 rounded-2xl bg-warning-wash p-4 text-sm text-warning-ink">
      No se guardó el informe. El conjunto debe conservar todos sus casos ficticios autorizados y vínculos vigentes.
    </p>}
    <Card title="Preparar informe" className="mb-6">
      <p className="text-sm text-fg-2">Prepara una versión para cada conjunto identificado. El informe fija todos sus casos, coincidencias y decisiones actuales para revisión humana.</p>
      {groups.length?<div className="mt-4 space-y-4">{groups.map((group,index)=><div key={group.anchor} id={group.anchor} className="scroll-mt-6 rounded-2xl border border-line p-4">
        <h2 className="text-sm font-semibold">Grupo {index+1} · {group.incidentIds.length} casos · {group.links.length} vínculos</h2>
        <ReportSelectionForm cases={group.incidentIds.map(id=>({id,title:byId.get(id)!.title}))}
          links={group.links.map(link=>({id:link.id,a:link.incident_a,b:link.incident_b,title:link.reasons.map(reason=>reason.detail).join(' · ')||'Conexión propuesta'}))}
          series={reports.filter(report=>report.snapshot.selected_case_ids.length===group.incidentIds.length&&
            report.snapshot.selected_case_ids.every(id=>group.incidentIds.includes(id)))} />
      </div>)}</div>:<Empty>Aún no hay un grupo de dos casos ficticios finalizados y autorizados para el informe.</Empty>}
    </Card>
    <Card title="Informes guardados">
      {reports.length?<ul className="divide-y divide-line">{reports.map(report=><li key={report.id} className="py-4">
        <Link href={`/panel/informes/${report.id}`} className="font-semibold text-accent-ink hover:underline">{report.title}</Link>
        <p className="mt-1 text-sm text-fg-2">Versión {report.version} · {report.snapshot.cases.length} casos · {report.snapshot.links.length} vínculos · {fmtDateTime(report.created_at)}</p>
        <p className="mt-2 line-clamp-2 text-sm text-fg-2">{report.summary}</p>
        <a href={`/panel/informes/${report.id}/pdf`} className="mt-2 inline-block text-sm font-semibold text-accent-ink hover:underline">Descargar PDF</a>
        <p className="mt-1 text-xs text-muted">Preparó {report.created_by_name}</p>
      </li>)}</ul>:<Empty>Prepara el primer informe con uno de los grupos anteriores.</Empty>}
    </Card>
  </>;
}

export const instant=false;
