import Link from 'next/link';
import {notFound} from 'next/navigation';
import {Card,PageHeader} from '@/components/ui';
import {fmtDateTime} from '@/lib/format';
import {requireAnalyst} from '@/lib/panel';
import {caseCode} from '@/lib/repo';
import {getReportVersion,listReportVersions} from '@/lib/reports/versions';

export default async function ReportDetail({params}:PageProps<'/panel/informes/[id]'>) {
  const {orgId}=await requireAnalyst();
  const {id}=await params;
  const report=await getReportVersion(orgId,id);
  if(!report) notFound();
  const history=await listReportVersions(orgId,report.series_id);
  return <>
    <PageHeader crumbs={[{href:'/panel',label:'Análisis'},{href:'/panel/informes',label:'Informes'}]}
      title={report.title} description={`Versión ${report.version} · guardada el ${fmtDateTime(report.created_at)} por ${report.created_by_name}`} />
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <a href={`/panel/informes/${report.id}/pdf`} className="inline-flex rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-90">Descargar PDF de esta versión</a>
      <span className="text-xs text-muted">Solo se genera al solicitarlo; contiene el contenido guardado de esta versión.</span>
    </div>
    <p className="mb-5 rounded-2xl bg-warning-wash p-4 text-sm text-warning-ink">{report.snapshot.caveat}</p>
    <Card title="Resumen de esta versión">
      <p className="whitespace-pre-line text-sm leading-relaxed">{report.summary}</p>
      <p className="mt-3 text-xs text-muted">Contenido fijado el {fmtDateTime(report.snapshot.captured_at)} · SHA-256 {report.content_sha256}</p>
    </Card>
    <h2 className="mb-4 mt-8 text-lg font-semibold">Casos del conjunto identificado</h2>
    <div className="space-y-4">{report.snapshot.cases.map(item=><Card key={item.id} title={`${caseCode(item.id)} · ${item.title}`}>
      <p className="text-xs text-muted">{fmtDateTime(item.started_at)} · Riesgo {item.risk_level} · {item.channel}</p>
      <p className="mt-3 text-sm">{item.summary}</p>
      {item.recommendation && <p className="mt-2 text-sm text-fg-2"><strong>Recomendación:</strong> {item.recommendation}</p>}
      {item.maritime.limitations.length>0 && <p className="mt-2 text-xs text-muted">Limitaciones: {item.maritime.limitations.join(' · ')}</p>}
      {item.signals.length>0 && <div className="mt-4"><h3 className="text-sm font-semibold">Hallazgos</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-2">{item.signals.map((signal,index)=><li key={index}>{signal.explanation}</li>)}</ul>
      </div>}
      {item.entities.length>0 && <div className="mt-4"><h3 className="text-sm font-semibold">Datos mencionados</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-2">{item.entities.map((entity,index)=><li key={index}>{entity.kind}: {entity.value} ({entity.provenance})</li>)}</ul>
      </div>}
      <Link href={`/panel/casos/${item.id}`} className="mt-4 inline-block text-sm font-semibold text-accent-ink hover:underline">Ver caso actual</Link>
    </Card>)}</div>
    <h2 className="mb-4 mt-8 text-lg font-semibold">Vínculos del conjunto identificado</h2>
    <div className="space-y-4">{report.snapshot.links.map(link=><Card key={link.id} title={`${caseCode(link.incident_a)} ↔ ${caseCode(link.incident_b)}`}>
      <p className="text-sm">Estado al guardar: <strong>{link.status}</strong> · Puntuación {Math.round(link.score*100)}% · Evidencia v{link.evidence_version}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-2">{link.reasons.map((reason,index)=><li key={index}>{reason.detail}</li>)}</ul>
      {(() => {const ai=link.evidence_snapshot?.ai_explanation as {status?:string;behavior_similarity?:string;evidence_a?:string|null;evidence_b?:string|null;limitations?:string[]}|undefined;
        return ai?.status==='completed'?<div className="mt-3 space-y-1 text-sm"><p>Comparación Maritime: <strong>{ai.behavior_similarity}</strong></p>
          {ai.evidence_a&&<p>Resumen A: “{ai.evidence_a}”</p>}{ai.evidence_b&&<p>Resumen B: “{ai.evidence_b}”</p>}
          {ai.limitations?.length?<p className="text-xs text-muted">Limitaciones: {ai.limitations.join(' · ')}</p>:null}</div>:null;})()}
      {link.reviewed_at && <p className="mt-2 text-xs text-muted">Revisado el {fmtDateTime(link.reviewed_at)} por {link.reviewed_by??'analista'}</p>}
    </Card>)}</div>
    <section className="mt-8"><h2 className="text-lg font-semibold">Historial de versiones</h2>
      <p className="mt-1 text-sm text-fg-2">Una versión anterior conserva sus hallazgos aunque después cambien los casos o vínculos.</p>
      <ol className="mt-3 flex flex-wrap gap-2">{history.map(item=><li key={item.id}>
        <Link href={`/panel/informes/${item.id}`} aria-current={item.id===report.id?'page':undefined}
          className={`rounded-full px-3 py-1 text-sm ${item.id===report.id?'bg-accent text-white':'bg-surface-2 text-accent-ink hover:underline'}`}>v{item.version}</Link>
      </li>)}</ol>
      <Link href="/panel/informes" className="mt-5 inline-block text-sm font-semibold text-accent-ink hover:underline">Preparar otra versión</Link>
    </section>
  </>;
}

export const instant=false;
