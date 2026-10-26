import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { convertToCzk, type FxRateRow, resolveFxRate } from '../src/fx';
import { CurrencyMismatchError, Money, round2 } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const d = parseLegalDate;
const rules = createCzRules();
const RULE = rules.at('2026-10-01').get('vat.cnb_rate_rule');
const LOOKBACK = rules.at('2026-10-01').get('fx.max_lookback_days');

// Fixture rates (synthetic, not ČNB values). 2026-10-03/04 is a weekend.
const RATES: FxRateRow[] = [
  { rateDate: d('2026-10-01'), currency: 'USD', amount: 1, rate: '23.400000' },
  { rateDate: d('2026-10-02'), currency: 'USD', amount: 1, rate: '23.456000' },
  { rateDate: d('2026-10-05'), currency: 'USD', amount: 1, rate: '23.500000' },
  { rateDate: d('2026-10-02'), currency: 'HUF', amount: 100, rate: '6.123000' },
  { rateDate: d('2026-10-05'), currency: 'EUR', amount: 1, rate: '24.580000' },
  { rateDate: d('2026-09-20'), currency: 'GBP', amount: 1, rate: '28.000000' },
];
const fx = (currency: string, date: string) => resolveFxRate(currency, d(date), RATES, RULE, LOOKBACK);

describe('resolveFxRate (M04 §4.9, M05 §4.2 step 6)', () => {
  it('the rate published on the date, else the last one before it (Saturday → Friday)', () => {
    expect(fx('USD', '2026-10-02')).toMatchObject({ currency: 'USD', rateDate: '2026-10-02', rate: '23.456000', amount: 1 });
    expect(fx('USD', '2026-10-03')?.rateDate).toBe('2026-10-02');
    expect(fx('USD', '2026-10-04')?.rateDate).toBe('2026-10-02');
    expect(fx('USD', '2026-10-05')?.rateDate).toBe('2026-10-05');
    expect(fx('USD', '2026-10-01')?.rate).toBe('23.400000');
  });

  it('never a later rate; null outside the look-back window; null for an unknown currency', () => {
    expect(fx('EUR', '2026-10-04')).toBeNull();
    expect(fx('GBP', '2026-09-27')?.rateDate).toBe('2026-09-20');
    expect(fx('GBP', '2026-09-28')).toBeNull();
    expect(fx('CHF', '2026-10-02')).toBeNull();
    expect(resolveFxRate('GBP', d('2026-09-28'), RATES, RULE, 8)?.rateDate).toBe('2026-09-20');
  });

  it('CZK is the identity rate on the date itself', () => {
    expect(fx('CZK', '2026-10-03')).toEqual({ currency: 'CZK', rateDate: '2026-10-03', rate: '1', amount: 1, perUnit: expect.anything() });
    expect(fx('CZK', '2026-10-03')?.perUnit.toString()).toBe('1');
  });

  it('perUnit = rate / amount (HUF per 100)', () => {
    const huf = fx('HUF', '2026-10-03');
    expect(huf?.amount).toBe(100);
    expect(huf?.perUnit.toString()).toBe('0.06123');
    expect(fx('USD', '2026-10-03')?.perUnit.toString()).toBe('23.456');
  });

  it('rejects a negative look-back', () => {
    expect(() => resolveFxRate('USD', d('2026-10-03'), RATES, RULE, -1)).toThrow(RangeError);
  });
});

describe('convertToCzk', () => {
  it('Cloudflare $10.46 at the Friday rate → 245.34976, round2 → 245.35 (AC-9e)', () => {
    const rate = fx('USD', '2026-10-03');
    if (rate === null) throw new Error('rate');
    const czk = convertToCzk(Money.parse('10.46', 'USD'), rate);
    expect(czk.currency).toBe('CZK');
    expect(czk.toString()).toBe('245.34976');
    expect(round2(czk).toFixed2()).toBe('245.35');
  });

  it('Anthropic €90 at 24.58 → 2212.20 (AC-9f); 1 000 HUF → 61.23', () => {
    const eur = fx('EUR', '2026-10-05');
    const huf = fx('HUF', '2026-10-02');
    if (eur === null || huf === null) throw new Error('rate');
    expect(round2(convertToCzk(Money.parse('90.00', 'EUR'), eur)).toFixed2()).toBe('2212.20');
    expect(round2(convertToCzk(Money.parse('1000.00', 'HUF'), huf)).toFixed2()).toBe('61.23');
  });

  it('currency mismatch throws; CZK passes through unchanged', () => {
    const usd = fx('USD', '2026-10-02');
    const czk = fx('CZK', '2026-10-02');
    if (usd === null || czk === null) throw new Error('rate');
    expect(() => convertToCzk(Money.parse('1.00', 'EUR'), usd)).toThrow(CurrencyMismatchError);
    expect(convertToCzk(Money.parse('12.34', 'CZK'), czk).toString()).toBe('12.34');
    expect(convertToCzk(Money.parse('-10.46', 'USD'), usd).toString()).toBe('-245.34976');
  });
});
