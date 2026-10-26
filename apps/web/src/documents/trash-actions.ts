'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { checkTrashMove, type TrashMove } from './trash';

async function moveDocument(form: FormData, move: TrashMove): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;

  const id = form.get('id');
  if (typeof id !== 'string' || id === '') return;

  const supabase = await createSupabaseServerClient();
  const { data: doc, error: readError } = await supabase
    .from('documents')
    .select('id, finalized_at, deleted_at')
    .eq('id', id)
    .eq('org_id', auth.orgId)
    .maybeSingle();
  if (readError || !doc) return;

  const check = checkTrashMove(
    { finalizedAt: doc.finalized_at ?? null, deletedAt: doc.deleted_at ?? null },
    move,
  );
  if (!check.ok) return;

  const { error: writeError } = await supabase
    .from('documents')
    .update({ deleted_at: move === 'trash' ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('org_id', auth.orgId);
  if (writeError) return;

  await supabase.rpc('audit_document', { p_document: id, p_action: move, p_diff: {} });

  revalidatePath('/inbox');
  redirect(move === 'trash' ? '/inbox?tab=trash' : `/inbox/${id}`);
}

/** Moves one live, not finalized document to the trash. */
export async function moveToTrashAction(form: FormData): Promise<void> {
  await moveDocument(form, 'trash');
}

/** Brings one trashed document back into the inbox. */
export async function restoreAction(form: FormData): Promise<void> {
  await moveDocument(form, 'restore');
}
