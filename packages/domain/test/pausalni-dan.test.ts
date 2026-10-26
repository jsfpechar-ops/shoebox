import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { EMPTY_ANSWERS } from '../src/income-tax/answers';
import {
  checkPausalniDan,
  fitPausalniDanBand,
  type PausalniDanInput,
  pausalniDanLimit,
} from '../src/income-tax/pausalni-dan';
import type { ProfileSegment } from '../src/income-tax/readiness';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const f = (m: Money) => m.toFixed2();
const seg = (o: Partial<ProfileSegment> = {}): ProfileSegment => ({
  validFrom: d('2025-01-01'),
  validTo: null,
  entityType: 'osvc',
  taxRegime: 'pausalni_dan',
  vatStatus: 'identifikovana_osoba',
  pausalRate: 60,
  pausalDanBand: 1,
  hasAccountant: false,
  ...o,
});
const adv = (date: string, amount: string) => ({ bookedOn: d(date), amount: czk(amount) });
// S1 Petra 2026: Jan–Jun 9 984, Jul 4 230, Aug–Dec 9 162 (zákon č. 90/2026 Sb. cut, retroactive).
const s1Advances = [
  ...[1, 2, 3, 4, 5, 6].map((m) => adv(`2026-0${m}-15`, '9984.00')),
  adv('2026-07-15', '4230.00'),
  ...[8, 9].map((m) => adv(`2026-0${m}-15`, '9162.00')),
  ...[10, 11, 12].map((m) => adv(`2026-${m}-15`, '9162.00')),
];
const s1 = (o: Partial<PausalniDanInput> = {}): PausalniDanInput => ({
  year: 2026,
  income: czk('850000.00'),
  band: 1,
  activityClass: 60,
  months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  advances: s1Advances,
  profileSegments: [seg()],
  answers: EMPTY_ANSWERS,
  ...o,
});

describe('band limits (M06 §4.4 step 1, 2026 rules)', () => {
  it('limit(band, class): 1/60 → 1 500 000; 1/80 → 2 000 000; 1/40 → 1 000 000; 2/40 → 1 500 000; 3/any → 2 000 000', () => {
    const at = d('2026-12-31');
    expect([
      f(pausalniDanLimit(1, 60, rules, at)),
      f(pausalniDanLimit(1, 80, rules, at)),
      f(pausalniDanLimit(1, 40, rules, at)),
      f(pausalniDanLimit(2, 40, rules, at)),
      f(pausalniDanLimit(3, 30, rules, at)),
    ]).toEqual(['1500000.00', '2000000.00', '1000000.00', '1500000.00', '2000000.00']);
  });
  it('fitBand: 850 000/60 → 1; 1 600 000/60 → 2; 1 900 000/80 → 1; 1 900 000/40 → 3; 2 000 001 → null', () => {
    const at = d('2026-12-31');
    expect(fitPausalniDanBand(czk('850000.00'), 60, rules, at)).toBe(1);
    expect(fitPausalniDanBand(czk('1600000.00'), 60, rules, at)).toBe(2);
    expect(fitPausalniDanBand(czk('1900000.00'), 80, rules, at)).toBe(1);
    expect(fitPausalniDanBand(czk('1900000.00'), 40, rules, at)).toBe(3);
    expect(fitPausalniDanBand(czk('2000001.00'), 80, rules, at)).toBeNull();
  });
});

describe('checkPausalniDan S1 (M06 §9)', () => {
  const c = checkPausalniDan(s1(), rules);
  it('income 850 000 fits band 1 (limit 1 500 000); no warnings; no return', () => {
    expect([c.fitBand, f(c.limit), c.warnings, c.returnRequired]).toEqual([
      1,
      '1500000.00',
      [],
      false,
    ]);
  });
  it('advances: paid 109 944 = expected 12 × 9 162; delta 0; ok', () => {
    expect([f(c.paid), f(c.expected), f(c.delta), c.advancesState]).toEqual([
      '109944.00',
      '109944.00',
      '0.00',
      'ok',
    ]);
  });
  it('per-month table: January paid 9 984 vs 9 162 due; October due 20. 10. 2026 (Tue); 12 rows', () => {
    expect(c.months).toHaveLength(12);
    expect(c.months[0]).toMatchObject({ month: 1, due: '2026-01-20' });
    expect([f(c.months[0]?.expected ?? czk('0')), f(c.months[0]?.paid ?? czk('0'))]).toEqual([
      '9162.00',
      '9984.00',
    ]);
    expect(c.months[9]?.due).toBe('2026-10-20');
    expect(f(c.months[6]?.paid ?? czk('0'))).toBe('4230.00');
  });
  it('notice deadline for 2027 is Monday 11. 1. 2027; for 2026 it was 12. 1. 2026', () => {
    expect(c.noticeDue).toBe('2027-01-11');
    expect(checkPausalniDan(s1({ year: 2025, advances: [] }), rules).noticeDue).toBe('2026-01-12');
  });
  it('a December advance paid on 5. 1. 2027 is not in 2026 (TA-12 default); 11 months paid → missing 9 162', () => {
    const c2 = checkPausalniDan(
      s1({ advances: [...s1Advances.slice(0, 11), adv('2027-01-05', '9162.00')] }),
      rules,
    );
    expect([f(c2.paid), f(c2.delta), c2.advancesState]).toEqual([
      '100782.00',
      '-9162.00',
      'missing',
    ]);
    const c3 = checkPausalniDan(
      s1({ advances: [...s1Advances, adv('2026-12-28', '100.00')] }),
      rules,
    );
    expect([f(c3.delta), c3.advancesState]).toEqual(['100.00', 'overpaid']);
  });
  it('months covered only from July → expected 6 × 9 162 = 54 972', () => {
    expect(f(checkPausalniDan(s1({ months: [7, 8, 9, 10, 11, 12] }), rules).expected)).toBe(
      '54972.00',
    );
  });
});

describe('warnings and return required', () => {
  it('income 1 600 000 in band 1 / class 60 → band_exceeded with limit 1 500 000, return required', () => {
    const c = checkPausalniDan(s1({ income: czk('1600000.00') }), rules);
    expect(c.fitBand).toBe(2);
    expect(c.warnings).toEqual([
      {
        code: 'pd.band_exceeded',
        severity: 'warning',
        params: { income: '1600000.00', band: 1, limit: '1500000.00' },
      },
    ]);
    expect(c.returnRequired).toBe(true);
  });
  it('income above 2 000 000 → only regime_limit_exceeded, fitBand null', () => {
    const c = checkPausalniDan(s1({ income: czk('2100000.00') }), rules);
    expect([c.fitBand, c.warnings.map((w) => w.code), c.returnRequired]).toEqual([
      null,
      ['pd.regime_limit_exceeded'],
      true,
    ]);
    expect(c.warnings[0]?.params).toEqual({ income: '2100000.00', limit: '2000000.00' });
  });
  it('band 2 with income 900 000 / class 40 → info lower_band_possible (band 1), no return', () => {
    const c = checkPausalniDan(
      s1({ band: 2, income: czk('900000.00'), activityClass: 40, advances: [] }),
      rules,
    );
    expect(c.warnings).toEqual([
      { code: 'pd.lower_band_possible', severity: 'info', params: { band: 1 } },
    ]);
    expect(c.returnRequired).toBe(false);
  });
  it('eligibility: VAT payer segment, other income over 50 000, employment, insolvency; unknown answers add nothing', () => {
    const c = checkPausalniDan(
      s1({
        profileSegments: [
          seg({ validTo: d('2026-06-30') }),
          seg({ validFrom: d('2026-07-01'), vatStatus: 'platce' }),
        ],
        answers: {
          ...EMPTY_ANSWERS,
          otherIncome: 'yes',
          otherIncomeApprox: 60_000,
          employmentBeyondLimits: 'yes',
          insolvencyOrPartner: 'yes',
        },
      }),
      rules,
    );
    expect(c.warnings.map((w) => w.code)).toEqual([
      'pd.eligibility.vat_payer',
      'pd.eligibility.other_income',
      'pd.eligibility.employment',
      'pd.eligibility.insolvency',
    ]);
    expect(c.warnings[1]?.params).toEqual({ limit: '50000.00' });
    expect(c.returnRequired).toBe(true);
    const quiet = checkPausalniDan(
      s1({ answers: { ...EMPTY_ANSWERS, otherIncome: 'yes', otherIncomeApprox: 20_000 } }),
      rules,
    );
    expect(quiet.warnings).toEqual([]);
  });
});
