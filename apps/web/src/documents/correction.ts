import type { LegalDate } from '@shoebox/domain';
import { isLegalDate } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import {
  checkInputFromFields,
  runProtoChecks,
  type ValidationRow,
  validationRowsOf,
} from '@shoebox/validation';

export type FixKind = 'text' | 'date' | 'money';

/** The values a user may fix: the M02 field key, how it is typed, its label and its `documents` column. */
export const EDITABLE = {
  'supplier.ico': {
    kind: 'text',
    label: 'proto.field.supplier_ico',
    column: 'partner_snapshot.ico',
  },
  'supplier.dic': {
    kind: 'text',
    label: 'proto.field.supplier_dic',
    column: 'partner_snapshot.dic',
  },
  'document.number': {
    kind: 'text',
    label: 'proto.field.document_number',
    column: 'document_number',
  },
  'document.variable_symbol': {
    kind: 'text',
    label: 'proto.field.variable_symbol',
    column: 'variable_symbol',
  },
  'dates.issue_date': { kind: 'date', label: 'proto.field.issue_date', column: 'issue_date' },
  'dates.duzp': { kind: 'date', label: 'doc.field.duzp', column: 'duzp' },
  'dates.due_date': { kind: 'date', label: 'proto.field.due_date', column: 'due_date' },
  'totals.net': { kind: 'money', label: 'proto.field.total_net', column: 'total_net' },
  'totals.vat': { kind: 'money', label: 'proto.field.total_vat', column: 'total_vat' },
  'totals.gross': { kind: 'money', label: 'proto.field.total_gross', column: 'total_gross' },
} as const satisfies Record<string, { kind: FixKind; label: MessageKey; column: string }>;

export type EditKey = keyof typeof EDITABLE;

export function isEditKey(key: string): key is EditKey {
  return Object.hasOwn(EDITABLE, key);
}

/** The edit key shown next to a detail field with this label, if that value can be fixed. */
export function editKeyOf(label: MessageKey): EditKey | null {
  for (const [key, spec] of Object.entries(EDITABLE))
    if (spec.label === label) return key as EditKey;
  return null;
}

export type Normalized = { ok: true; value: string } | { ok: false; error: MessageKey };

/** Turns what the user typed into the stored text, or names what is wrong with it. */
export function normalizeInput(kind: FixKind, raw: string): Normalized {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, error: 'doc.fix.error.empty' };
  if (trimmed.length > 64) return { ok: false, error: 'doc.fix.error.long' };
  if (kind === 'date')
    return isLegalDate(trimmed)
      ? { ok: true, value: trimmed }
      : { ok: false, error: 'doc.fix.error.date' };
  if (kind === 'money') {
    const compact = trimmed.replace(/[\s  ]/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d{1,2})?$/.test(compact)) return { ok: false, error: 'doc.fix.error.money' };
    const [whole, cents = ''] = compact.split('.');
    return { ok: true, value: `${whole}.${cents.padEnd(2, '0')}` };
  }
  return { ok: true, value: trimmed };
}

export interface CorrectionPlan {
  readonly fields: Readonly<Record<string, string>>;
  readonly rows: readonly ValidationRow[];
  readonly status: 'ready' | 'needs_review';
}

/** The corrected fields, the checks run again on them, and the status that follows (hard rule 2). */
export function planCorrection(input: {
  fields: Readonly<Record<string, string>>;
  documentClass: string;
  editKey: EditKey;
  value: string;
  org: { ico: string | null; dic: string | null } | null;
  today: LegalDate;
}): CorrectionPlan {
  const fields = { ...input.fields, [input.editKey]: input.value };
  const checks = runProtoChecks(
    checkInputFromFields(fields, input.documentClass),
    input.org === null ? { today: input.today } : { today: input.today, org: input.org },
  );
  const rows = validationRowsOf(checks);
  const unsure = input.documentClass === 'unknown' || input.documentClass === 'unreadable';
  const status = unsure || rows.some((r) => r.severity === 'blocking') ? 'needs_review' : 'ready';
  return { fields, rows, status };
}
