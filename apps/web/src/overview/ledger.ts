import { type LedgerTotalsEntry, parseLegalDate, TAX_EFFECT_VALUES } from '@shoebox/domain';
import { z } from 'zod';

/** PostgREST select for `tax_ledger_entries` (numeric cast to text, ADR-007). */
export const LEDGER_SELECT = 'entry_date, basis, tax_effect, business_amount_czk::text';

const ledgerRowSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  basis: z.enum(['payment', 'document_evidence', 'provisional']),
  tax_effect: z.enum(TAX_EFFECT_VALUES),
  business_amount_czk: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
});

/** One row → entry; null when the row does not parse (unknown effect/basis, bad date or amount). */
export function toLedgerEntry(row: unknown): LedgerTotalsEntry | null {
  const parsed = ledgerRowSchema.safeParse(row);
  if (!parsed.success) return null;
  try {
    return {
      entryDate: parseLegalDate(parsed.data.entry_date),
      basis: parsed.data.basis,
      taxEffect: parsed.data.tax_effect,
      businessAmountCzk: parsed.data.business_amount_czk,
    };
  } catch {
    return null;
  }
}
