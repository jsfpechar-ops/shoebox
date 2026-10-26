import { CZK, type LegalDate, type LinkType, Money } from '@shoebox/domain';
import { MATCHER_CONFIG, type MatcherConfig } from './config';

export interface DocAmountView {
  readonly amountDue: Money;
  readonly currency: string;
  readonly issueDate?: LegalDate;
  readonly isPaidPerDocument?: boolean;
}

export interface LinkView {
  readonly linkType: LinkType;
  readonly amount: Money;
  readonly bookedOn: LegalDate;
  readonly createdAt: string;
}

/** + adds, − subtracts, 0 ignored (M07 §4.7.10). */
const SIGN: Record<LinkType, 1 | -1 | 0> = {
  payment: 1,
  offset: 1,
  platform_payout: 1,
  fx_difference: 1,
  refund: -1,
  fee: 0,
};

const cmpStr = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/** amount_due − tol; tol = roundingToleranceCzk for CZK, else 1 % of amount_due (unrounded). */
export function paidThreshold(doc: DocAmountView, cfg: MatcherConfig = MATCHER_CONFIG): Money {
  const tol =
    doc.currency === CZK
      ? Money.parse(cfg.roundingToleranceCzk, CZK)
      : doc.amountDue.multiply('0.01');
  return doc.amountDue.subtract(tol);
}

export function computePaidAt(
  doc: DocAmountView,
  links: readonly LinkView[],
  cfg: MatcherConfig = MATCHER_CONFIG,
): LegalDate | null {
  if (!doc.amountDue.isPositive()) return doc.isPaidPerDocument ? (doc.issueDate ?? null) : null;
  const threshold = paidThreshold(doc, cfg);
  const ordered = [...links].sort(
    (a, b) => cmpStr(a.bookedOn, b.bookedOn) || cmpStr(a.createdAt, b.createdAt),
  );
  let sum = Money.zero(doc.currency);
  let paidAt: LegalDate | null = null;
  for (const l of ordered) {
    const sign = SIGN[l.linkType];
    if (sign === 1) sum = sum.add(l.amount);
    else if (sign === -1) sum = sum.subtract(l.amount);
    if (sum.compare(threshold) >= 0) paidAt = paidAt ?? l.bookedOn;
    else paidAt = null;
  }
  return paidAt;
}
