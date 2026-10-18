'use server';

import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireAnalyst} from '@/lib/panel';
import {createReportVersion,ReportVersionError} from '@/lib/reports/versions';

export async function createReportVersionAction(formData:FormData) {
  const {session,orgId}=await requireAnalyst();
  let id:string;
  try {
    const saved=await createReportVersion({orgId,analystId:session.userId,
      caseIds:formData.getAll('case_id').map(String),linkIds:formData.getAll('link_id').map(String),
      title:String(formData.get('title')??''),seriesId:String(formData.get('series_id')??'')||null});
    id=saved.id;
  } catch(error) {
    if(error instanceof ReportVersionError) {
      redirect(`/panel/informes?error=${encodeURIComponent(error.code)}`);
    }
    throw error;
  }
  revalidatePath('/panel/informes');
  redirect(`/panel/informes/${encodeURIComponent(id)}`);
}
