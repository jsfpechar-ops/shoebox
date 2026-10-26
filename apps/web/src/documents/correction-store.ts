import type { LegalDate } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import type { createSupabaseServerClient } from '../supabase/server';
import { EDITABLE, type EditKey, planCorrection } from './correction';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface CorrectionInput {
  orgId: string;
  userId: string;
  documentId: string;
  editKey: EditKey;
  value: string;
  today: LegalDate;
}

export type CorrectionResult =
  | { ok: true; status: 'ready' | 'needs_review' }
  | { ok: false; error: MessageKey };

const SAVE_ERROR: MessageKey = 'doc.fix.error.save';

/**
 * Saves one corrected value, runs the checks again and sets the status.
 * Write order: the document goes to needs_review first, so a half-saved document is never left ready.
 * Rules the user already settled (resolved or dismissed) are never inserted again.
 */
export async function applyCorrection(
  supabase: SupabaseLike,
  input: CorrectionInput,
): Promise<CorrectionResult> {
  try {
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id, status, class, partner_snapshot')
      .eq('id', input.documentId)
      .eq('org_id', input.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (docError || !doc) return { ok: false, error: SAVE_ERROR };
    if (doc.status !== 'ready' && doc.status !== 'needs_review')
      return { ok: false, error: 'doc.fix.error.locked' };

    const { data: fieldRows, error: fieldsError } = await supabase
      .from('document_fields')
      .select('field_key, value_text')
      .eq('document_id', input.documentId)
      .eq('is_current', true);
    if (fieldsError) return { ok: false, error: SAVE_ERROR };
    const fields: Record<string, string> = {};
    for (const row of fieldRows ?? [])
      if (row.value_text !== null) fields[row.field_key] = row.value_text;

    const { data: orgRow, error: orgError } = await supabase
      .from('organizations')
      .select('ico, dic')
      .eq('id', input.orgId)
      .maybeSingle();
    if (orgError) return { ok: false, error: SAVE_ERROR };
    const org =
      orgRow && (orgRow.ico !== null || orgRow.dic !== null)
        ? { ico: orgRow.ico, dic: orgRow.dic }
        : null;

    const { data: settledRows, error: settledError } = await supabase
      .from('validation_results')
      .select('rule_id')
      .eq('document_id', input.documentId)
      .neq('state', 'open');
    if (settledError) return { ok: false, error: SAVE_ERROR };
    const settled = new Set((settledRows ?? []).map((r) => r.rule_id));

    const spec = EDITABLE[input.editKey];
    const plan = planCorrection({
      fields,
      documentClass: doc.class,
      editKey: input.editKey,
      value: input.value,
      org,
      today: input.today,
    });

    // 1. The document leaves ready first.
    const w1 = await supabase
      .from('documents')
      .update({ status: 'needs_review' })
      .eq('id', input.documentId)
      .eq('org_id', input.orgId);
    if (w1.error) return { ok: false, error: SAVE_ERROR };

    // 2. The old value stops being current.
    const w2 = await supabase
      .from('document_fields')
      .update({ is_current: false })
      .eq('document_id', input.documentId)
      .eq('field_key', input.editKey)
      .eq('is_current', true);
    if (w2.error) return { ok: false, error: SAVE_ERROR };

    // 3. The user's value becomes current.
    const w3 = await supabase.from('document_fields').insert({
      org_id: input.orgId,
      document_id: input.documentId,
      field_key: input.editKey,
      value_text: input.value,
      source: 'user',
      set_by: input.userId,
    });
    if (w3.error) return { ok: false, error: SAVE_ERROR };

    // 4. The corrected column on the document.
    const patch = spec.column.startsWith('partner_snapshot.')
      ? {
          partner_snapshot: {
            ...(doc.partner_snapshot ?? {}),
            [spec.column.slice('partner_snapshot.'.length)]: input.value,
          },
        }
      : { [spec.column]: input.value };
    const w4 = await supabase
      .from('documents')
      .update(patch)
      .eq('id', input.documentId)
      .eq('org_id', input.orgId);
    if (w4.error) return { ok: false, error: SAVE_ERROR };

    // 5. Open results are replaced by the fresh checks.
    const w5 = await supabase
      .from('validation_results')
      .delete()
      .eq('document_id', input.documentId)
      .eq('state', 'open');
    if (w5.error) return { ok: false, error: SAVE_ERROR };

    // 6. Insert only rules the user has not settled.
    const fresh = plan.rows.filter((r) => !settled.has(r.ruleId));
    if (fresh.length > 0) {
      const w6 = await supabase.from('validation_results').insert(
        fresh.map((r) => ({
          org_id: input.orgId,
          document_id: input.documentId,
          rule_id: r.ruleId,
          rule_version: r.ruleVersion,
          severity: r.severity,
          params: r.params,
        })),
      );
      if (w6.error) return { ok: false, error: SAVE_ERROR };
    }

    // 6b. One audit row per fixed value (M11 §13.1).
    const w6b = await supabase.rpc('audit_document', {
      p_document: input.documentId,
      p_action: 'edit_field',
      p_diff: { field: input.editKey, old: fields[input.editKey] ?? null, new: input.value },
    });
    if (w6b.error) return { ok: false, error: SAVE_ERROR };

    // 7. The last write sets the planned status.
    const w7 = await supabase
      .from('documents')
      .update({ status: plan.status })
      .eq('id', input.documentId)
      .eq('org_id', input.orgId);
    if (w7.error) return { ok: false, error: SAVE_ERROR };
    return { ok: true, status: plan.status };
  } catch {
    return { ok: false, error: SAVE_ERROR };
  }
}
