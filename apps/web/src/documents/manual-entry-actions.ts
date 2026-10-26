'use server';

import { pragueToday } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { planCorrection } from './correction';
import { manualDocumentColumns, manualFields, parseManualEntry } from './manual-entry';

export type ManualState = {
  errors: Partial<Record<'partner' | 'date' | 'amount' | 'form', MessageKey>>;
};

const FORM_KEYS = ['kind', 'partner', 'date', 'amount', 'paid', 'note', 'missing', 'reason'] as const;

/** Saves a document typed by hand. It goes through the same checks as an uploaded one. The values are never logged. */
export async function saveManualEntryAction(
  _prev: ManualState,
  form: FormData,
): Promise<ManualState> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return { errors: { form: 'manual.error.save' } };

  const values: Record<string, string> = {};
  for (const key of FORM_KEYS) {
    const value = form.get(key);
    if (typeof value === 'string') values[key] = value;
  }
  const parsed = parseManualEntry(values);
  if (!parsed.ok) return { errors: parsed.errors };
  const v = parsed.value;

  let savedId = '';
  try {
    const supabase = await createSupabaseServerClient();
    const { data: orgRow, error: orgError } = await supabase
      .from('organizations')
      .select('ico, dic')
      .eq('id', auth.orgId)
      .maybeSingle();
    if (orgError) return { errors: { form: 'manual.error.save' } };
    const org =
      orgRow && (orgRow.ico !== null || orgRow.dic !== null)
        ? { ico: orgRow.ico, dic: orgRow.dic }
        : null;

    const plan = planCorrection({
      fields: manualFields(v),
      documentClass: v.kind,
      editKey: 'totals.gross',
      value: v.amount,
      org,
      today: pragueToday({ now: () => Date.now() }),
    });

    const created = await supabase
      .from('documents')
      .insert({ org_id: auth.orgId, ...manualDocumentColumns(v), status: 'needs_review' })
      .select('id')
      .single();
    if (created.error || !created.data) return { errors: { form: 'manual.error.save' } };
    const id = created.data.id;

    const fieldRows = Object.entries(plan.fields).map(([field_key, value_text]) => ({
      org_id: auth.orgId,
      document_id: id,
      field_key,
      value_text,
      source: 'user',
      set_by: auth.userId,
    }));
    const w1 = await supabase.from('document_fields').insert(fieldRows);
    if (w1.error) return { errors: { form: 'manual.error.save' } };

    const w2 = await supabase.from('document_lines').insert({
      org_id: auth.orgId,
      document_id: id,
      position: 1,
      description: v.note,
      gross: v.amount,
    });
    if (w2.error) return { errors: { form: 'manual.error.save' } };

    if (plan.rows.length > 0) {
      const w3 = await supabase.from('validation_results').insert(
        plan.rows.map((r) => ({
          org_id: auth.orgId,
          document_id: id,
          rule_id: r.ruleId,
          rule_version: r.ruleVersion,
          severity: r.severity,
          params: r.params,
        })),
      );
      if (w3.error) return { errors: { form: 'manual.error.save' } };
    }

    const w4 = await supabase
      .from('documents')
      .update({ status: plan.status })
      .eq('id', id)
      .eq('org_id', auth.orgId);
    if (w4.error) return { errors: { form: 'manual.error.save' } };

    const audit = await supabase.rpc('audit_document', {
      p_document: id,
      p_action: 'create_manual',
      p_diff: {},
    });
    if (audit.error) return { errors: { form: 'manual.error.save' } };

    savedId = id;
  } catch {
    return { errors: { form: 'manual.error.save' } };
  }
  revalidatePath('/inbox');
  redirect(`/inbox/${savedId}`);
}
