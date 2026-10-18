import {notFound} from 'next/navigation';
import {requireAnalyst} from '@/lib/panel';
import {getReportVersion} from '@/lib/reports/versions';
import {renderReportPdf} from '@/lib/reports/pdf.mjs';

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const {orgId}=await requireAnalyst();
  const {id}=await params;
  const report=await getReportVersion(orgId,id);
  if(!report) notFound();
  const bytes=await renderReportPdf(report);
  return new Response(Buffer.from(bytes),{
    headers:{
      'Content-Type':'application/pdf',
      'Content-Disposition':`attachment; filename="tiskz-informe-v${report.version}-${report.id}.pdf"`,
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
    }
  });
}
