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
    .update({
      answer: { value: 'no' },
      answered_by: auth.userId,
      answered_at: new Date().toISOString(),
    })
    .eq('id', question)
    .eq('org_id', auth.orgId);
  revalidatePath(`/inbox/${id}`);
}

/**
 * Called by the review deck after it stored the answer of a `same_invoice` question:
 * "yes" joins this document after the one before it and reads it again; "no" needs nothing.
 */
export async function reactToSameInvoice(orgId: string, questionId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: q, error } = await supabase
    .from('review_questions')
    .select('document_id, payload, answer')
    .eq('id', questionId)
    .eq('org_id', orgId)
    .eq('kind', 'same_invoice')
    .maybeSingle();
  if (error || !q) return;
  const answer = q.answer as { value?: unknown } | null;
  const other = (q.payload as { other_document_id?: unknown } | null)?.other_document_id;
  if (answer?.value !== 'yes' || typeof other !== 'string' || typeof q.document_id !== 'string')
    return;
  const { data, error: joinError } = await supabase.rpc('join_documents', {
    p_document_id: other,
    p_other_id: q.document_id,
  });
  if (joinError || !Array.isArray(data)) return;
  await readAgain(orgId, data as string[]);
  revalidatePath('/inbox');
}

/** "Add a missing page": the chosen document's pages go after this one's; it is read again. */
export async function addPageAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;
  const id = field(form, 'id');
  const other = field(form, 'other');
  if (id === '' || other === '' || id === other) return;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('join_documents', {
    p_document_id: id,
    p_other_id: other,
  });
  if (error || !Array.isArray(data)) return;
  await readAgain(auth.orgId, data as string[]);
  revalidatePath('/inbox');
  revalidatePath(`/inbox/${id}`);
}
