import {createReportVersionAction} from '@/app/panel/informes/actions';
import {caseCode} from '@/lib/repo';
import type {ReportVersion} from '@/lib/reports/versions';

type Choice={id:string;title:string};
export function ReportSelectionForm({cases,links,series}:{cases:Choice[];links:(Choice&{a:string;b:string})[];series:ReportVersion[]}) {
  return <details className="mt-5 border-t border-line pt-4">
    <summary className="cursor-pointer text-sm font-semibold text-accent-ink">Preparar versión de informe</summary>
    <form action={createReportVersionAction} className="mt-4 space-y-4 rounded-2xl bg-surface-2 p-4">
      <p className="text-sm text-fg-2">Selecciona los casos y vínculos que quedarán congelados en esta versión. Deben formar una red conectada.</p>
      <label className="block text-sm font-medium">Título
        <input name="title" required maxLength={120} defaultValue={`Informe preliminar · ${cases.length} casos ficticios`}
          className="mt-1 block w-full rounded-xl border border-line bg-surface px-3 py-2 text-fg" />
      </label>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Casos</legend>
        {cases.map(item=><label key={item.id} className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="case_id" value={item.id} defaultChecked className="mt-1" />
          <span>{caseCode(item.id)} · {item.title}</span>
        </label>)}
      </fieldset>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Vínculos</legend>
        {links.map(item=><label key={item.id} className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="link_id" value={item.id} defaultChecked className="mt-1" />
          <span>{caseCode(item.a)} ↔ {caseCode(item.b)} · {item.title}</span>
        </label>)}
      </fieldset>
      {series.length>0 && <label className="block text-sm font-medium">Serie
        <select name="series_id" defaultValue="" className="mt-1 block w-full rounded-xl border border-line bg-surface px-3 py-2 text-fg">
          <option value="">Crear informe nuevo</option>
          {series.map(item=><option key={item.series_id} value={item.series_id}>Nueva versión de «{item.title}» (actual: v{item.version})</option>)}
        </select>
      </label>}
      <button type="submit" className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Guardar versión</button>
      <p className="text-xs text-muted">Usa solo casos ficticios y resúmenes Maritime autorizados. El informe es preliminar y requiere revisión humana.</p>
    </form>
  </details>;
}
