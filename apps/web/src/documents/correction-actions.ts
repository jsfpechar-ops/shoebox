'use server';

import { pragueToday } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import { revalidatePath } from 'next/cache';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { EDITABLE, isEditKey, normalizeInput } from './correction';
import { applyCorrection } from './correction-store';
import { type RecalcSuggestion, recalcSuggestion } from './recalc';

export type FixState = {
  error: MessageKey | null;
  saved: boolean;
  suggestion: RecalcSuggestion;
};

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** Saves one user correction. The value is never logged. */
export async function fixFieldAction(_prev: FixState, form: FormData): Promise<FixState> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return { error: 'doc.fix.error.locked', saved: false, suggestion: null };

  const id = formText(form, 'id');
  const key = formText(form, 'key');
  if (!isEditKey(key)) return { error: 'doc.fix.error.save', saved: false, suggestion: null };

  const normalized = normalizeInput(EDITABLE[key].kind, formText(form, 'value'));
  if (!normalized.ok) return { error: normalized.error, saved: false, suggestion: null };

  const result = await applyCorrection(await createSupabaseServerClient(), {
    orgId: auth.orgId,
    userId: auth.userId,
    documentId: id,
    editKey: key,
    value: normalized.value,
    today: pragueToday({ now: () => Date.now() }),
  });
  if (!result.ok) return { error: result.error, saved: false, suggestion: null };

  revalidatePath(`/inbox/${id}`);
  return { error: null, saved: true, suggestion: recalcSuggestion(result.fields, key) };
}
