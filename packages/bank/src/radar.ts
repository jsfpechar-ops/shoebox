// M07 §4.8 missing-documents radar, Phase 2: `missing_document` only.
// TODO(M07-radar-missing_credit_note), TODO(M07-radar-unexplained_income), TODO(M07-radar-expected_invoice),
// TODO(M07-radar-substitute_unpaid), TODO(M07-radar-pick-from-documents): later kinds.
import { addDays, Money, parseLegalDate } from '@shoebox/domain';

export interface RadarTx {
  readonly id: string;
  /** Signed decimal string in account currency (negative = outgoing). */
  readonly amount: string;
  readonly currency: string;
  /** YYYY-MM-DD */
  readonly bookedOn: string;
  readonly matchState: string;
  readonly categoryCode: string | null;
  readonly isPending: boolean;
  readonly isBusiness: boolean;
  /** Σ payment_links.amount_account_currency of the transaction, decimal string ('0' when none). */
  readonly linkedAmount: string;
  readonly counterparty: string | null;
  readonly variableSymbol: string | null;
}

export interface RadarCandidate {
  readonly id: string;
  /** Unexplained remainder, positive decimal string with 2 decimals. */
  readonly remainder: string;
  readonly currency: string;
  readonly bookedOn: string;
  readonly counterparty: string | null;
  readonly variableSymbol: string | null;
}

/** Outgoing, business, uncategorised, booked, unmatched or partial, at least `graceDays` old, with a positive remainder. */
export function radarCandidates(
  txs: readonly RadarTx[],
  today: string,
  graceDays: number,
): RadarCandidate[] {
  const cutoff = addDays(parseLegalDate(today), -graceDays);
  const out: RadarCandidate[] = [];
  for (const t of txs) {
    if (!t.isBusiness || t.isPending || t.categoryCode !== null) continue;
    if (t.matchState !== 'unmatched' && t.matchState !== 'partial') continue;
    if (t.bookedOn > cutoff) continue;
    const amount = Money.parse(t.amount, t.currency);
    if (!amount.isNegative()) continue;
    const remainder = amount.abs().subtract(Money.parse(t.linkedAmount, t.currency));
    if (!remainder.isPositive()) continue;
    out.push({
      id: t.id,
      remainder: remainder.toFixed2(),
      currency: t.currency,
      bookedOn: t.bookedOn,
      counterparty: t.counterparty,
      variableSymbol: t.variableSymbol,
    });
  }
  return out;
}

export interface SupplierRequestInput {
  readonly orgName: string;
  readonly ico: string | null;
  readonly dic: string | null;
  readonly address: string | null;
  readonly bookedOn: string;
  readonly amount: string;
  readonly currency: string;
  readonly variableSymbol: string | null;
  readonly counterparty: string | null;
}

/** Plain-text request for a tax document. Lines for null values are omitted. */
export function supplierRequestText(input: SupplierRequestInput): {
  subject: string;
  body: string;
} {
  const amount = Money.parse(input.amount, input.currency).toFixed2();
  const subject = `Invoice for payment of ${amount} ${input.currency} on ${input.bookedOn}`;
  const lines: string[] = ['Hello,', ''];
  lines.push(
    `We paid ${amount} ${input.currency} on ${input.bookedOn}${
      input.counterparty ? ` to ${input.counterparty}` : ''
    } and do not have a tax document for this payment.`,
  );
  if (input.variableSymbol) lines.push(`Variable symbol: ${input.variableSymbol}`);
  lines.push('', 'Please send us an invoice or receipt with these invoicing details:', '');
  lines.push(input.orgName);
  if (input.ico) lines.push(`Company ID (IČO): ${input.ico}`);
  if (input.dic) lines.push(`VAT ID (DIČ): ${input.dic}`);
  if (input.address) lines.push(`Address: ${input.address}`);
  lines.push('', 'Thank you.');
  return { subject, body: lines.join('\n') };
}
