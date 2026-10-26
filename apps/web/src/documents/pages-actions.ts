'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { enqueueDocExtract } from './enqueue';

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

async function readAgain(orgId: string, ids: readonly string[]): Promise<void> {
  const retry = String(Date.now());
  for (const id of ids) {
    try {
      await enqueueDocExtract(orgId, id, retry);
    } catch {
      // The queue is down: the documents stay `received`.
    }
  }
}

/** "These are separate invoices": one document per page, each read again. */
export async function separatePagesAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;
  const id = field(form, 'id');
  if (id === '') return;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('separate_document_pages', { p_document_id: id });
  if (error || !Array.isArray(data)) return;
  await readAgain(auth.orgId, data as string[]);
  revalidatePath('/inbox');
  revalidatePath(`/inbox/${id}`);
}

/** The answer to "Is this part of the same invoice as the document before it?". */
export async function answerSameInvoiceAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;
  const id = field(form, 'id');
  const other = field(form, 'other');
  const question = field(form, 'question');
  if (id === '' || other === '' || question === '') return;
  const supabase = await createSupabaseServerClient();
  if (field(form, 'answer') === 'yes') {
    const { data, error } = await supabase.rpc('join_documents', {
      p_document_id: other,
      p_other_id: id,
    });
    if (error || !Array.isArray(data)) return;
    await readAgain(auth.orgId, data as string[]);
    revalidatePath('/inbox');
    redirect(`/inbox/${other}`);
  }
  await supabase
    .from('review_questions')
    .update({ answer: { same: false }, answered_by: auth.userId, answered_at: new Date().toISOString() })
    .eq('id', question)
    .eq('org_id', auth.orgId);
  revalidatePath(`/inbox/${id}`);
}
