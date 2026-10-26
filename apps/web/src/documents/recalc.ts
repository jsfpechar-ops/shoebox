import { Money } from '@shoebox/domain';

type TotalKey = 'totals.net' | 'totals.vat' | 'totals.gross';

/** The total the app offers to set after a fix; the user taps it, the app never changes it alone (hard rule 2). */
export type RecalcSuggestion = { editKey: 'totals.net' | 'totals.gross'; value: string } | null;

/** A total that is present and a valid decimal, or null. */
function readTotal(fields: Readonly<Record<string, string>>, key: TotalKey): Money | null {
  const raw = fields[key];
  if (raw === undefined || raw.trim() === '') return null;
  try {
    return Money.parse(raw.trim(), 'CZK');
  } catch {
    return null;
  }
}

/**
 * After the user fixed one total, the total that now matches the other two.
 * net edited or VAT edited: gross = net + VAT. Gross edited: net = gross - VAT.
 * Null when a value is missing or invalid, when the three already add up, or when the
 * suggestion would be negative and the document's gross is not negative (credit notes are the only negatives).
 */
export function recalcSuggestion(
  fields: Readonly<Record<string, string>>,
  editKey: string,
): RecalcSuggestion {
  if (editKey !== 'totals.net' && editKey !== 'totals.vat' && editKey !== 'totals.gross')
    return null;
  const net = readTotal(fields, 'totals.net');
  const vat = readTotal(fields, 'totals.vat');
  const gross = readTotal(fields, 'totals.gross');
  if (net === null || vat === null || gross === null) return null;

  const isCreditNote = gross.isNegative();
  if (editKey === 'totals.gross') {
    const suggested = gross.subtract(vat);
    if (suggested.equals(net)) return null;
    if (suggested.isNegative() && !isCreditNote) return null;
    return { editKey: 'totals.net', value: suggested.toFixed2() };
  }
  const suggested = net.add(vat);
  if (suggested.equals(gross)) return null;
  if (suggested.isNegative() && !isCreditNote) return null;
  return { editKey: 'totals.gross', value: suggested.toFixed2() };
}
