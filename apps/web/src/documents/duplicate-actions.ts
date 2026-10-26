'use server';

import type { MessageKey } from '@shoebox/i18n';
import { revalidatePath } from 'next/cache';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { keepBoth, supabaseDuplicateStore } from './duplicate';

export type KeepBothState = { error: MessageKey | null };

export async function keepBothAction(_prev: KeepBothState, form: FormData): Promise<KeepBothState> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return { error: 'doc.duplicate.error' };
  const id = form.get('id');
  if (typeof id !== 'string' || id === '') return { error: 'doc.duplicate.error' };
  const store = supabaseDuplicateStore(await createSupabaseServerClient(), auth.orgId);
  const result = await keepBoth(store, id);
  if (!result.ok) return { error: 'doc.duplicate.error' };
  revalidatePath(`/inbox/${id}`);
  revalidatePath('/inbox');
  return { error: null };
}
