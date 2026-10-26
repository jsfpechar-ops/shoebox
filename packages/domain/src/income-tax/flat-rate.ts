import { CZK, floor0, Money, round0 } from '../money/index';
import type { CzRules } from '../vat/period';
import type { FlatRate } from './answers';
export const FLAT_RATE_CAVEAT_KEYS = [
  'podklady.flat.caveat.depreciation',
  'podklady.flat.caveat.insurance',
  'podklady.flat.caveat.credits_35ca',
  'podklady.flat.caveat.switching',
] as const;
export interface FlatRateComparison {
  readonly rate: FlatRate;
  readonly incomeKc: Money;
  readonly capKc: Money;
  readonly flatRaw: Money;
  readonly flat: Money;
  readonly capReached: boolean;
  readonly baseFlat: Money;
  readonly baseActual: Money;
  readonly better: 'flat' | 'actual' | 'equal';
  readonly difference: Money;
  readonly caveatKeys: readonly string[];
}
export function computeFlatRateComparison(
  income: Money,
  actual: Money,
  rate: FlatRate,
  rules: CzRules,
  year: number,
): FlatRateComparison {
  const caps = rules.at(`${year}-01-01`).get('pausalni_vydaje.rates_caps');
  const capValue = caps[String(rate) as keyof typeof caps];
  if (capValue === undefined) throw new Error(`flat-rate: no cap for rate ${rate}`);
  const incomeKc = round0(income);
  const capKc = Money.parse(String(capValue), CZK);
  const flatRaw = floor0(incomeKc.multiply(String(rate)).divide('100'));
  const capReached = flatRaw.compare(capKc) > 0;
  const flat = capReached ? capKc : flatRaw;
  const baseFlat = incomeKc.subtract(flat);
  const baseActual = incomeKc.subtract(round0(actual));
  const order = baseFlat.compare(baseActual);
  const better = order < 0 ? 'flat' : order > 0 ? 'actual' : 'equal';
  const difference = baseFlat.subtract(baseActual).abs();
  return {
    rate,
    incomeKc,
    capKc,
    flatRaw,
    flat,
    capReached,
    baseFlat,
    baseActual,
    better,
    difference,
    caveatKeys: [...FLAT_RATE_CAVEAT_KEYS],
  };
}
