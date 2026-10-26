import type { LegalDate } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import { normalizeInput } from './correction';

export const MANUAL_KINDS = ['received_receipt', 'received_invoice', 'issued_invoice'] as const;
export const MANUAL_PAID = ['cash', 'card', 'bank_transfer', 'unpaid'] as const;
export const MANUAL_REASONS = ['lost', 'damaged', 'never_issued', 'other'] as const;

export interface ManualEntry {
  readonly kind: (typeof MANUAL_KINDS)[number];
  readonly partnerName: string | null;
  readonly partnerIco: string | null;
  readonly date: LegalDate;
  readonly amount: string;
  readonly paid: (typeof MANUAL_PAID)[number];
  readonly note: string | null;
  readonly substituteReason: (typeof MANUAL_REASONS)[number] | null;
}

export type ManualParse =
  | { ok: true; value: ManualEntry }
  | { ok: false; errors: Partial<Record<'partner' | 'date' | 'amount', MessageKey>> };

function pick<T extends readonly string[]>(
  list: T,
  raw: string | undefined,
  fallback: T[number],
): T[number] {
  return (list as readonly string[]).includes(raw ?? '') ? (raw as T[number]) : fallback;
}

/** Reads the form fields into a manual entry, or names what is missing or wrong. */
export function parseManualEntry(form: Readonly<Record<string, string>>): ManualParse {
  const errors: Partial<Record<'partner' | 'date' | 'amount', MessageKey>> = {};
  const kind = pick(MANUAL_KINDS, form.kind, 'received_receipt');
  const paid = pick(MANUAL_PAID, form.paid, 'cash');
  const partner = (form.partner ?? '').trim();
  let partnerName: string | null = null;
  let partnerIco: string | null = null;
  if (partner === '') errors.partner = 'manual.error.partner';
  else if (/^\d{8}$/.test(partner)) partnerIco = partner;
  else partnerName = partner.slice(0, 200);

  const date = normalizeInput('date', form.date ?? '');
  if (!date.ok) errors.date = date.error;
  const amount = normalizeInput('money', form.amount ?? '');
  if (!amount.ok) errors.amount = amount.error;

  if (!date.ok || !amount.ok || errors.partner) return { ok: false, errors };

  const note = (form.note ?? '').trim().slice(0, 200);
  const substituteReason =
    form.missing === 'on' ? pick(MANUAL_REASONS, form.reason, 'other') : null;

  return {
    ok: true,
    value: {
      kind,
      partnerName,
      partnerIco,
      date: date.value as LegalDate,
      amount: amount.value,
      paid,
      note: note === '' ? null : note,
      substituteReason,
    },
  };
}

/** The `document_fields` map (field key → text) the checks and the document page read. */
export function manualFields(entry: ManualEntry): Record<string, string> {
  const party = entry.kind === 'issued_invoice' ? 'buyer' : 'supplier';
  const fields: Record<string, string> = {};
  const name = entry.partnerName ?? undefined;
  const ico = entry.partnerIco ?? undefined;
  if (name !== undefined) fields[`${party}.name`] = name;
  if (ico !== undefined) fields[`${party}.ico`] = ico;
  fields['dates.issue_date'] = entry.date;
  fields['totals.gross'] = entry.amount;
  fields.currency = 'CZK';
  if (entry.paid !== 'unpaid') fields['payment.method'] = entry.paid;
  return fields;
}

/** The `documents` columns of the new row (status and org are added by the caller). */
export function manualDocumentColumns(entry: ManualEntry): Record<string, unknown> {
  const partner: Record<string, string> = {};
  if (entry.partnerName !== null) partner.name = entry.partnerName;
  if (entry.partnerIco !== null) partner.ico = entry.partnerIco;
  return {
    entry_mode: 'manual',
    class: entry.kind,
    direction: entry.kind === 'issued_invoice' ? 'out' : 'in',
    partner_snapshot: partner,
    issue_date: entry.date,
    currency: 'CZK',
    total_gross: entry.amount,
    payment_method: entry.paid === 'unpaid' ? null : entry.paid,
    is_paid_per_document: entry.paid !== 'unpaid',
    substitute_reason: entry.substituteReason,
  };
}
