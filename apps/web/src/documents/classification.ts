import { CATEGORY_CODES, VAT_TREATMENT_VALUES } from '@shoebox/domain';
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface AnswerBody {
  readonly value: string;
}

/** `{value: non-empty string, at most 120 characters}`; anything else is null. */
export function parseAnswerBody(json: unknown): AnswerBody | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const value = (json as { value?: unknown }).value;
  if (typeof value !== 'string' || value.length === 0 || value.length > 120) return null;
  return { value };
}

export interface ClassificationPatch {
  readonly categoryCode?: string;
  readonly vatTreatment?: string;
  readonly businessSharePct?: string;
  readonly remember?: 'this' | 'vendor' | 'always';
}

const REMEMBER_VALUES = ['this', 'vendor', 'always'] as const;

/** Snake_case body to camelCase patch; null when no key is given or a value is invalid. */
export function parseClassificationPatch(json: unknown): ClassificationPatch | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const body = json as Record<string, unknown>;
  const patch: { -readonly [K in keyof ClassificationPatch]: ClassificationPatch[K] } = {};
  let count = 0;

  if (body.category_code !== undefined) {
    if (
      typeof body.category_code !== 'string' ||
      !CATEGORY_CODES.includes(body.category_code as never)
    )
      return null;
    patch.categoryCode = body.category_code;
    count += 1;
  }
  if (body.vat_treatment !== undefined) {
    if (
      typeof body.vat_treatment !== 'string' ||
      !(VAT_TREATMENT_VALUES as readonly string[]).includes(body.vat_treatment)
    )
      return null;
    patch.vatTreatment = body.vat_treatment;
    count += 1;
  }
  if (body.business_share_pct !== undefined) {
    const pct = body.business_share_pct;
    if (typeof pct !== 'string' || !/^\d{1,3}$/.test(pct) || Number(pct) > 100) return null;
    patch.businessSharePct = pct;
    count += 1;
  }
  if (body.remember !== undefined) {
    if (!(REMEMBER_VALUES as readonly unknown[]).includes(body.remember)) return null;
    patch.remember = body.remember as 'this' | 'vendor' | 'always';
    count += 1;
  }
  return count === 0 ? null : patch;
}

export type StoreResult =
  | { ok: true; documentId: string; revision: number }
  | { ok: false; status: 400 | 404 | 409; error: string };

export interface AnswerInput {
  orgId: string;
  userId: string;
  questionId: string;
  value: string;
}

/** Answers one question: loads it (org-scoped), checks it is unanswered and the value is one of its options, writes answer/answered_by/answered_at. */
export async function storeAnswer(
  supabase: SupabaseLike,
  input: AnswerInput,
): Promise<StoreResult> {
  const { data: question, error: qError } = await supabase
    .from('review_questions')
    .select('id, org_id, document_id, payload, answer')
    .eq('id', input.questionId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (qError || !question) return { ok: false, status: 404, error: 'not_found' };
  if (question.document_id === null || question.document_id === undefined)
    return { ok: false, status: 400, error: 'no_document' };

  const { data: doc, error: dError } = await supabase
    .from('documents')
    .select('id, revision, status')
    .eq('id', question.document_id)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (dError || !doc) return { ok: false, status: 404, error: 'not_found' };
  if (doc.status === 'finalized') return { ok: false, status: 409, error: 'finalized' };

  if (question.answer !== null && question.answer !== undefined)
    return { ok: false, status: 409, error: 'already_answered' };

  const options = (question.payload as { options?: unknown } | null)?.options;
  const allowed =
    Array.isArray(options) &&
    options.some(
      (option) =>
        typeof option === 'object' &&
        option !== null &&
        (option as { value?: unknown }).value === input.value,
    );
  if (!allowed) return { ok: false, status: 400, error: 'bad_value' };

  const { error: wError } = await supabase
    .from('review_questions')
    .update({
      answer: { value: input.value },
      answered_by: input.userId,
      answered_at: new Date().toISOString(),
    })
    .eq('id', input.questionId)
    .eq('org_id', input.orgId);
  if (wError) return { ok: false, status: 400, error: 'save' };

  return { ok: true, documentId: doc.id, revision: doc.revision };
}

export interface PatchInput {
  orgId: string;
  userId: string;
  documentId: string;
  lineId: string;
  patch: ClassificationPatch;
}

/** Writes the user fields of one line (see §2) after checking the document is not finalized and the line belongs to it. */
export async function storeClassificationPatch(
  supabase: SupabaseLike,
  input: PatchInput,
): Promise<StoreResult> {
  const { data: doc, error: dError } = await supabase
    .from('documents')
    .select('id, revision, status')
    .eq('id', input.documentId)
    .eq('org_id', input.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (dError || !doc) return { ok: false, status: 404, error: 'not_found' };
  if (doc.status === 'finalized') return { ok: false, status: 409, error: 'finalized' };

  const { data: line, error: lError } = await supabase
    .from('document_lines')
    .select('id, position')
    .eq('id', input.lineId)
    .eq('document_id', input.documentId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (lError || !line) return { ok: false, status: 404, error: 'not_found' };

  const p = input.patch;
  const writes: Array<[string, string]> = [];
  if (p.categoryCode !== undefined)
    writes.push([`lines[${line.position}].category_code`, p.categoryCode]);
  if (p.vatTreatment !== undefined)
    writes.push([`lines[${line.position}].vat_treatment`, p.vatTreatment]);
  if (p.businessSharePct !== undefined)
    writes.push([`lines[${line.position}].business_share_pct`, p.businessSharePct]);
  if (p.remember !== undefined) writes.push([`lines[${line.position}].remember`, p.remember]);

  for (const [fieldKey, valueText] of writes) {
    const { error: oldError } = await supabase
      .from('document_fields')
      .update({ is_current: false })
      .eq('document_id', input.documentId)
      .eq('org_id', input.orgId)
      .eq('field_key', fieldKey)
      .eq('is_current', true);
    if (oldError) return { ok: false, status: 400, error: 'save' };

    const { error: insError } = await supabase.from('document_fields').insert({
      org_id: input.orgId,
      document_id: input.documentId,
      field_key: fieldKey,
      value_text: valueText,
      source: 'user',
      set_by: input.userId,
      is_current: true,
    });
    if (insError) return { ok: false, status: 400, error: 'save' };
  }

  return { ok: true, documentId: doc.id, revision: doc.revision };
}
