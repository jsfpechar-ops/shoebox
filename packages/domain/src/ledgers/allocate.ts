import { Money, round2 } from '../money/index';

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

/**
 * M04 §4.11.3: `share_l = total × weight_l / W`, `round2`, residual to the largest |weight| (tie → lowest index).
 * Result is in `total.currency` and sums to `total` exactly. Weights must share one currency.
 */
export function allocateProRata(total: Money, weights: readonly Money[]): Money[] {
  const weightCurrency = weights[0]?.currency ?? total.currency;
  const weightSum = Money.sum(weights, weightCurrency);

  if (weightSum.isZero()) {
    if (total.isZero()) {
      return weights.map(() => Money.zero(total.currency));
    }
    throw new AllocationError('Cannot allocate a non-zero amount against zero total weight');
  }

  const allocations = weights.map((weight) => {
    const share = total.toDecimal().times(weight.toDecimal()).div(weightSum.toDecimal());
    return round2(Money.fromDecimal(share, total.currency));
  });

  const residual = total.subtract(Money.sum(allocations, total.currency));
  if (!residual.isZero()) {
    let target = 0;
    for (const [i, weight] of weights.entries()) {
      const best = weights[target] as Money;
      if (weight.abs().compare(best.abs()) > 0) {
        target = i;
      }
    }
    allocations[target] = (allocations[target] as Money).add(residual);
  }

  return allocations;
}
