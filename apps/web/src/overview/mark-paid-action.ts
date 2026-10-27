'use server';

import { pragueToday } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';

export type MarkPaidState = { error: MessageKey | null; done: boolean };

const idSchema = z.string().uuid();

/** Marks one received bill of the active org as paid today (Prague) and writes one audit row. */
export async function markPaidAction(_prev: MarkPaidState, form: FormData): Promise<MarkPaidState> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return { error: 'overview.bills.error', done: false };

  const parsed = idSchema.safeParse(form.get('id'));
  if (!parsed.success) return { error: 'overview.bills.error', done: false };
  const id = parsed.data;
  const today = pragueToday({ now: () => Date.now() });

  try {
    const supabase = await createSupabaseServerClient();
    const update = await supabase
      .from('documents')
      .update({ paid_at: today })
      .eq('id', id)
      .eq('org_id', auth.orgId)
      .is('paid_at', null)
      .select('id');
    if (update.error || !update.data || update.data.length === 0) {
      return { error: 'overview.bills.error', done: false };
    }
    const audit = await supabase.rpc('audit_document', {
      p_document: id,
      p_action: 'edit_field',
      p_diff: { field: 'paid_at', old: null, new: today },
    });
    if (audit.error) return { error: 'overview.bills.error', done: false };
  } catch {
    return { error: 'overview.bills.error', done: false };
  }

  revalidatePath('/prehled');
  return { error: null, done: true };
}
