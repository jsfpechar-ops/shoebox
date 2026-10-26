/**
 * How sure we are about one shown value. Deterministic (hard rule 2): it comes from the
 * field's source and the open checks, never from the model's own guess.
 */
export type Trust = 'exact' | 'checked' | 'check';

/** Sources read straight from the file's own data, no AI. */
const EXACT_SOURCES: ReadonlySet<string> = new Set(['isdoc', 'qr', 'pdf_text']);

/**
 * Validation check id (the rule id without the `PROTO_` prefix, lower case) to the field keys
 * it concerns. Checks not listed here concern no shown field (e.g. `paid`, `buyer`).
 */
export const CHECK_FIELDS: Record<string, readonly string[]> = {
  vat_sum: ['totals.net', 'totals.vat', 'totals.gross'],
  totals_math: ['totals.net', 'totals.vat', 'totals.gross'],
  vat_rate_math: ['totals.net', 'totals.vat', 'totals.gross'],
  recap_vs_totals: ['totals.net', 'totals.vat', 'totals.gross'],
  vat_rate_missing: ['totals.vat'],
  qr_amount: ['totals.gross'],
  ico_checksum: ['supplier.ico'],
  dic_format: ['supplier.dic'],
  vat_payer: ['supplier.dic'],
  date_issue: ['dates.issue_date'],
  date_duzp: ['dates.duzp'],
  date_due: ['dates.due_date'],
};

/** The field keys that an open check failed or warned about. */
export function fieldsFlagged(checks: readonly { readonly rule_id: string }[]): Set<string> {
  const flagged = new Set<string>();
  for (const check of checks) {
    const checkId = check.rule_id.replace(/^PROTO_/, '').toLowerCase();
    for (const fieldKey of CHECK_FIELDS[checkId] ?? []) flagged.add(fieldKey);
  }
  return flagged;
}

export interface TrustInput {
  /** The `document_fields.source` of the current row, or null when there is none. */
  readonly source: string | null;
  readonly value: string;
  readonly failedOrWarnedFields: ReadonlySet<string>;
  readonly fieldKey: string;
}

/** Rules, in order: user → checked; exact source and not flagged → exact; empty → check; flagged → check; else checked. */
export function trustOf(input: TrustInput): Trust {
  const flagged = input.failedOrWarnedFields.has(input.fieldKey);
  if (input.source === 'user') return 'checked';
  if (input.source !== null && EXACT_SOURCES.has(input.source) && !flagged) return 'exact';
  if (input.value.trim() === '') return 'check';
  if (flagged) return 'check';
  return 'checked';
}
