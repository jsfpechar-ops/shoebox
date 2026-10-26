import { CZK, Money, round2 } from '@shoebox/domain';
import { MATCHER_CONFIG, type MatcherConfig } from './config';
import type { AmountFeature, DocView, MatchContext, TxView } from './types';

/** M07 §4.6.2: compare the transaction amount with the open document amount. */
export function compareAmount(
  t: TxView,
  d: DocView,
  ctx: Pick<MatchContext, 'fxRate'>,
  vsExact: boolean,
  cfg: MatcherConfig = MATCHER_CONFIG,
): AmountFeature | null {
  const cmpAcc = t.remaining ?? t.amount.abs();
  const open = d.openAmount;
  if (!cmpAcc.isPositive() || !open.isPositive()) return null;
  const tol = Money.parse(cfg.roundingToleranceCzk, CZK);

  if (d.currency === t.currency) {
    const delta = cmpAcc.subtract(open);
    if (delta.isZero()) return { kind: 'exact', ratio: 1, amountDoc: open, amountAccount: cmpAcc };
    if (d.currency === CZK && delta.abs().compare(tol) <= 0) {
      return { kind: 'rounding', ratio: 1, amountDoc: open, amountAccount: cmpAcc };
    }
    if (vsExact && cmpAcc.compare(open) < 0) return { kind: 'partial', ratio: 1, amountDoc: cmpAcc, amountAccount: cmpAcc };
    if (vsExact && cmpAcc.compare(open) > 0) return { kind: 'overpayment', ratio: 1, amountDoc: open, amountAccount: open };
    return null;
  }

  const orig = t.amountOriginal;
  if (orig !== undefined && orig.currency === d.currency) {
    const cmpDoc = orig.abs();
    if (cmpDoc.equals(open)) return { kind: 'exact', ratio: 1, amountDoc: open, amountAccount: cmpAcc };
    if (vsExact && cmpDoc.compare(open) < 0) return { kind: 'partial', ratio: 1, amountDoc: cmpDoc, amountAccount: cmpAcc };
    return null;
  }

  const rate = ctx.fxRate(d.currency, t.bookedOn);
  if (rate === null) return null;
  const openAcc = round2(Money.fromDecimal(open.toDecimal().mul(rate), t.currency));
  if (!openAcc.isPositive()) return null;
  const tolPct = Number(t.cardMerchant !== undefined ? cfg.cardFxTolerancePct : cfg.bankFxTolerancePct);
  const pct = cmpAcc.subtract(openAcc).abs().toDecimal().div(openAcc.toDecimal()).mul(100).toNumber();
  if (pct <= tolPct) return { kind: 'fx', ratio: 1 - pct / tolPct, amountDoc: open, amountAccount: cmpAcc };
  if (vsExact && cmpAcc.compare(openAcc) < 0) {
    const amountDoc = round2(Money.fromDecimal(cmpAcc.toDecimal().div(rate), d.currency));
    return { kind: 'partial', ratio: 1, amountDoc, amountAccount: cmpAcc };
  }
  if (vsExact && cmpAcc.compare(openAcc) > 0) {
    return { kind: 'overpayment', ratio: 1, amountDoc: open, amountAccount: openAcc };
  }
  return null;
}
