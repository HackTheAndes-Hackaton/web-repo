import {createReportVersionAction} from '@/app/panel/informes/actions';
import {caseCode} from '@/lib/repo';
import type {ReportVersion} from '@/lib/reports/versions';

type Choice={id:string;title:string};
export function ReportSelectionForm({cases,links,series}:{cases:Choice[];links:(Choice&{a:string;b:string})[];series:ReportVersion[]}) {
  const withinLimit=cases.length<=20&&links.length<=50;
  return <details className="mt-5 border-t border-line pt-4">
    <summary className="cursor-pointer text-sm font-semibold text-accent-ink">Preparar informe de este conjunto</summary>
    <form action={createReportVersionAction} className="mt-4 space-y-4 rounded-2xl bg-surface-2 p-4">
      <p className="text-sm text-fg-2">La versión incluirá todos los casos y vínculos vigentes de este conjunto. No se pueden excluir coincidencias al preparar el informe.</p>
      <label className="block text-sm font-medium">Título
        <input name="title" required maxLength={120} defaultValue={`Informe preliminar del conjunto de ${cases.length} casos`}
          className="mt-1 block w-full rounded-xl border border-line bg-surface px-3 py-2 text-fg" />
      </label>
      {cases.map(item=><input key={item.id} type="hidden" name="case_id" value={item.id} />)}
      {links.map(item=><input key={item.id} type="hidden" name="link_id" value={item.id} />)}
      <p className="text-sm"><strong>Casos:</strong> {cases.map(item=>caseCode(item.id)).join(', ')}</p>
      <p className="text-sm"><strong>Vínculos:</strong> {links.map(item=>`${caseCode(item.a)} ↔ ${caseCode(item.b)}`).join('; ')}</p>
      {series.length>0 && <label className="block text-sm font-medium">Serie
        <select name="series_id" defaultValue="" className="mt-1 block w-full rounded-xl border border-line bg-surface px-3 py-2 text-fg">
          <option value="">Crear informe nuevo</option>
          {series.map(item=><option key={item.series_id} value={item.series_id}>Nueva versión de «{item.title}» (actual: v{item.version})</option>)}
        </select>
      </label>}
      {withinLimit?<button type="submit" className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Guardar versión del conjunto</button>
        :<p className="text-sm text-warning-ink">Este conjunto supera el límite actual de 20 casos o 50 vínculos y requiere ampliar la capacidad de exportación.</p>}
      <p className="text-xs text-muted">El informe incluye todos los casos del conjunto. Cuando un caso no tenga análisis Maritime o resumen, el documento lo indicará. Requiere revisión humana.</p>
    </form>
  </details>;
}
