import Link from 'next/link';
import {Card,Empty,PageHeader} from '@/components/ui';
import {fmtDateTime} from '@/lib/format';
import {requireAnalyst} from '@/lib/panel';
import {listLatestReportVersions} from '@/lib/reports/versions';

export default async function ReportsPage() {
  const {orgId}=await requireAnalyst();
  const reports=await listLatestReportVersions(orgId);
  return <>
    <PageHeader crumbs={[{href:'/panel',label:'Análisis'},{href:'/panel/informes',label:'Informes'}]}
      title="Informes de investigación" description="Versiones guardadas por analistas a partir de casos ficticios y hallazgos de Maritime." />
    <Card title="Informes guardados">
      {reports.length?<ul className="divide-y divide-line">{reports.map(report=><li key={report.id} className="py-4">
        <Link href={`/panel/informes/${report.id}`} className="font-semibold text-accent-ink hover:underline">{report.title}</Link>
        <p className="mt-1 text-sm text-fg-2">Versión {report.version} · {report.snapshot.cases.length} casos · {report.snapshot.links.length} vínculos · {fmtDateTime(report.created_at)}</p>
        <p className="mt-1 text-xs text-muted">Preparó {report.created_by_name}</p>
      </li>)}</ul>:<Empty>Prepara el primer informe desde un grupo de la página Vínculos.</Empty>}
    </Card>
  </>;
}

export const instant=false;
