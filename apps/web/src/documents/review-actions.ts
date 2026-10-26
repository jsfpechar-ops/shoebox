'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { parseQuestionPayload } from './review-deck';

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** Saves one answer to an open review question. Other kinds are stored only; the asking lane reacts to them. */
export async function answerQuestionAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) redirect('/inbox/review?error=1');

  const id = formText(form, 'id');
  const value = formText(form, 'value');
  let saved = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: question, error: readError } = await supabase
      .from('review_questions')
      .select('id, document_id, kind, payload')
      .eq('id', id)
      .eq('org_id', auth.orgId)
      .is('answered_at', null)
      .maybeSingle();
    const payload = question ? parseQuestionPayload(question.payload) : null;
    if (readError || !question || payload === null) redirect('/inbox/review?error=1');
    if (!payload.options.some((option) => option.value === value)) redirect('/inbox/review?error=1');

    const answer = { value };
    const { error: writeError } = await supabase
      .from('review_questions')
      .update({ answer, answered_by: auth.userId, answered_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', auth.orgId)
      .is('answered_at', null);
    if (writeError) redirect('/inbox/review?error=1');

    if (question.kind === 'business_or_personal' && question.document_id) {
      const { error: flagError } = await supabase
        .from('documents')
        .update({ business_flag: value })
        .eq('id', question.document_id)
        .eq('org_id', auth.orgId);
      if (flagError) redirect('/inbox/review?error=1');
    }

    if (question.document_id) {
      await supabase.rpc('audit_document', {
        p_document: question.document_id,
        p_action: 'answer_question',
        p_diff: { kind: question.kind, answer },
      });
    }
    saved = true;
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    saved = false;
  }

  revalidatePath('/inbox');
  redirect(saved ? '/inbox/review' : '/inbox/review?error=1');
}
