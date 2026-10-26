'use server';

import { revalidatePath } from 'next/cache';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { restartFailedRead, supabaseReadAgainDeps } from './read-again';

/** "Read again" on a document that could not be read. */
export async function readAgainAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;
  const id = form.get('id');
  if (typeof id !== 'string' || id === '') return;
  await restartFailedRead(supabaseReadAgainDeps(await createSupabaseServerClient()), auth.orgId, id);
  revalidatePath(`/inbox/${id}`);
  revalidatePath('/inbox');
}
