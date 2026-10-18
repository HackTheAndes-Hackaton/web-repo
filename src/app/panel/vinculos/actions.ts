'use server';

import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {explainPendingLink} from '@/lib/api/link-explanations';
import {ApiError} from '@/lib/api/http';
import {requireAnalyst} from '@/lib/panel';

export async function explainLinkAction(formData:FormData) {
  const {orgId}=await requireAnalyst();
  const id=String(formData.get('link_id')??'');
  let notice='failed';
  try {notice=(await explainPendingLink(orgId,id)).status;}
  catch(error) {if(error instanceof ApiError) notice=error.code;else throw error;}
  revalidatePath('/panel/vinculos');
  redirect(`/panel/vinculos?explicacion=${encodeURIComponent(notice)}#vinculo-${encodeURIComponent(id)}`);
}
