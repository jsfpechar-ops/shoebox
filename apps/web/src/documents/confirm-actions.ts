'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { statusAfterAnswers } from './issue-questions';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

async function liveDocument(supabase: SupabaseLike, orgId: string, id: string) {
  const { data, error } = await supabase
    .from('documents')
    .select('id, status, class')
    .eq('id', id)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) return null;
  return data.status === 'ready' || data.status === 'needs_review' ? data : null;
}

/** One tap on "it's fine": the issue is dismissed; with no open blocking issue left the document is ready. */
export async function answerIssueAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;
  const id = formText(form, 'id');
  const issueId = formText(form, 'issueId');
  if (id === '' || issueId === '') return;

  try {
    const supabase = await createSupabaseServerClient();
    const doc = await liveDocument(supabase, auth.orgId, id);
    if (doc === null) return;

    const dismissed = await supabase
      .from('validation_results')
      .update({
        state: 'dismissed',
        dismiss_reason: 'user_answered',
        resolved_by: auth.userId,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', issueId)
      .eq('document_id', id)
      .eq('org_id', auth.orgId)
      .eq('state', 'open')
      .select('id');
    if (dismissed.error || (dismissed.data ?? []).length === 0) return;

    const open = await supabase
      .from('validation_results')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', id)
      .eq('org_id', auth.orgId)
      .eq('state', 'open')
      .eq('severity', 'blocking');
    if (open.error) return;

    await supabase.rpc('audit_document', {
      p_document: id,
      p_action: 'answer_question',
      p_diff: { kind: 'issue', answer: 'dismiss' },
    });

    const status = statusAfterAnswers(open.count ?? 0, doc.class);
    if (status === 'ready' && doc.status !== 'ready') {
      await supabase.from('documents').update({ status }).eq('id', id).eq('org_id', auth.orgId);
    }
  } catch {
    return;
  }
  revalidatePath(`/inbox/${id}`);
  revalidatePath('/inbox');
}

/** "Looks right, confirm": every open blocking issue is dismissed, the document is ready, next one opens. */
export async function confirmDocumentAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;
  const id = formText(form, 'id');
  if (id === '') return;

  let next = '/inbox';
  try {
    const supabase = await createSupabaseServerClient();
    const doc = await liveDocument(supabase, auth.orgId, id);
    if (doc === null) return;

    // 1. Dismiss every open blocking issue; the status changes only after that.
    const dismissed = await supabase
      .from('validation_results')
      .update({
        state: 'dismissed',
        dismiss_reason: 'user_confirmed',
        resolved_by: auth.userId,
        resolved_at: new Date().toISOString(),
      })
      .eq('document_id', id)
      .eq('org_id', auth.orgId)
      .eq('state', 'open')
      .eq('severity', 'blocking');
    if (dismissed.error) return;

    // 2. The document is ready.
    const ready = await supabase
      .from('documents')
      .update({ status: 'ready' })
      .eq('id', id)
      .eq('org_id', auth.orgId);
    if (ready.error) return;

    await supabase.rpc('audit_document', {
      p_document: id,
      p_action: 'answer_question',
      p_diff: { kind: 'confirm_document', answer: 'confirmed' },
    });

    // 3. The next document waiting for review, else the inbox.
    const { data: following } = await supabase
      .from('documents')
      .select('id')
      .eq('org_id', auth.orgId)
      .eq('status', 'needs_review')
      .is('deleted_at', null)
      .neq('id', id)
      .order('created_at')
      .limit(1);
    const nextId = following?.[0]?.id;
    if (typeof nextId === 'string') next = `/inbox/${nextId}`;
  } catch {
    return;
  }
  revalidatePath('/inbox');
  redirect(next);
}
