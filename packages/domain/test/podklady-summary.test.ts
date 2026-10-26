import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { EMPTY_ANSWERS } from '../src/income-tax/answers';
import type { ProfileSegment } from '../src/income-tax/readiness';
import {
  buildPodkladySummary,
  CHECKLIST_KEYS,
  type PodkladyInput,
} from '../src/income-tax/summary';
import type { AnnualTotalsEntry } from '../src/income-tax/totals';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const f = (m: Money) => m.toFixed2();
let n = 0;
const e = (
  categoryCode: string,
  taxEffect: AnnualTotalsEntry['taxEffect'],
  amount: string,
  share = '100',
  business = amount,
): AnnualTotalsEntry => {
  n += 1;
  return {
    entryDate: d('2026-04-10'),
    taxYear: 2026,
    basis: 'payment',
    documentId: `doc-${n}`,
    lineId: `l-${n}`,
    categoryCode,
    taxEffect,
    amountCzk: amount,
    businessSharePct: share,
    businessAmountCzk: business,
  };
};
const seg = (o: Partial<ProfileSegment> = {}): ProfileSegment => ({
  validFrom: d('2025-01-01'),
  validTo: null,
  entityType: 'osvc',
  taxRegime: 'danova_evidence',
  vatStatus: 'neplatce',
  pausalRate: null,
  pausalDanBand: null,
  hasAccountant: true,
  ...o,
});
const tx = (categoryCode: string, amount: string, bookedOn: string) => ({
  categoryCode,
  bookedOn: d(bookedOn),
  amount: czk(amount),
});
const base = (o: Partial<PodkladyInput> = {}): PodkladyInput => ({
  year: 2026,
  taxpayer: { legalName: 'Tomáš Novák', ico: '12345678' },
  profiles: [seg()],
  entries: [],
  assetLines: [],
  privateUse: { personalDocuments: [], partialShareLines: [], carRegimeAnswers: [] },
  vatFilings: [],
  transactions: [],
  readiness: {
    ledger: { staleEntries: 0, documentsFinalizedAfterBuild: 0 },
    pendingDocuments: 0,
    unpaidIssued: 0,
    unexplainedTransactions: { count: 0, sum: czk('0') },
    businessFlagUnknown: { count: 0, sum: czk('0') },
  },
  answers: EMPTY_ANSWERS,
  partialXmlAvailable: true,
  ...o,
});
const s2 = base({
  entries: [
    e('income_services', 'taxable_income', '1400000.00'),
    e('exp_material', 'deductible_expense', '400000.00'),
    e('exp_fuel', 'deductible_expense', '60000.00'),
    e('exp_telecom', 'deductible_expense', '24000.00', '50', '12000.00'),
    e('exp_small_assets', 'deductible_expense', '48000.00'),
    e('exp_representation', 'non_deductible_expense', '4000.00'),
    e('asset_long_term', 'asset', '650000.00'),
  ],
  transactions: [
    ...Array.from({ length: 12 }, (_, i) =>
      tx('ins_social_own', '5005.00', `2026-${String(i + 1).padStart(2, '0')}-08`),
    ),
    tx('ins_health_own', '3306.00', '2026-01-08'),
    tx('tax_income_payment', '15000.00', '2026-06-15'),
  ],
  answers: { ...EMPTY_ANSWERS, comparisonRate: 80 },
});

describe('buildPodkladySummary S2 (danova_evidence, closed year)', () => {
  const s = buildPodkladySummary(s2, rules, d('2027-02-10'));
  it('headline actual: income 1 400 000, expenses 520 000, base 880 000; advances paid 15 000; not watermarked', () => {
    expect([
      f(s.headline.income),
      f(s.headline.expenses),
      f(s.headline.base),
      s.headline.label,
    ]).toEqual(['1400000.00', '520000.00', '880000.00', 'actual']);
    expect([f(s.advancesPaid), s.watermark, s.blocked, s.empty, s.regime, s.generatedOn]).toEqual([
      '15000.00',
      false,
      false,
      false,
      'danova_evidence',
      '2027-02-10',
    ]);
  });
  it('flat-rate comparison at the answered 80 %: better flat by 600 000; no paušální daň block; XML never for DE', () => {
    expect([s.flatRate?.rate, s.flatRate?.better, f(s.flatRate?.difference ?? czk('0'))]).toEqual([
      80,
      'flat',
      '600000.00',
    ]);
    expect([s.pausalniDan, s.partialXmlEligible, s.noReturnKey]).toEqual([null, false, null]);
  });
  it('payments by category and month; social has 12 months of 5 005', () => {
    const social = s.payments.find((p) => p.categoryCode === 'ins_social_own');
    expect([
      f(social?.total ?? czk('0')),
      social?.byMonth.length,
      f(social?.byMonth[11] ?? czk('0')),
    ]).toEqual(['60060.00', 12, '5005.00']);
    expect(s.payments.map((p) => p.categoryCode)).toEqual([
      'ins_health_own',
      'ins_social_own',
      'tax_income_payment',
    ]);
  });
  it('checklist for DE includes depreciation and car, excludes accommodation; disclaimer key fixed', () => {
    expect(s.checklistKeys).toEqual(
      CHECKLIST_KEYS.filter((k) => k !== 'podklady.checklist.accommodation'),
    );
    expect(s.disclaimerKey).toBe('podklady.disclaimer');
  });
});

describe('other regimes and states', () => {
  it('S3 pausalni_vydaje 60 %: headline flat (expenses 1 200 000 capped, base 2 300 000); XML eligible', () => {
    const s = buildPodkladySummary(
      base({
        profiles: [seg({ taxRegime: 'pausalni_vydaje', pausalRate: 60, vatStatus: 'platce' })],
        entries: [
          e('income_services', 'taxable_income', '3500000.00'),
          e('exp_material', 'deductible_expense', '2900000.00'),
        ],
      }),
      rules,
      d('2027-02-10'),
    );
    expect([
      f(s.headline.expenses),
      f(s.headline.base),
      s.headline.label,
      s.partialXmlEligible,
      s.vatNote.kind,
    ]).toEqual(['1200000.00', '2300000.00', 'flat', true, 'payer']);
    expect(s.checklistKeys).not.toContain('podklady.checklist.depreciation');
    expect(
      buildPodkladySummary(
        base({
          profiles: [seg({ taxRegime: 'pausalni_vydaje', pausalRate: 60 })],
          entries: [e('income_services', 'taxable_income', '1.00')],
          partialXmlAvailable: false,
        }),
        rules,
        d('2027-02-10'),
      ).partialXmlEligible,
    ).toBe(false);
  });
  it('S1 pausalni_dan: paušální daň block, no flat rate, no return, XML not offered; with a band breach the XML is offered', () => {
    const pd = seg({
      taxRegime: 'pausalni_dan',
      pausalRate: 60,
      pausalDanBand: 1,
      vatStatus: 'identifikovana_osoba',
    });
    const advances = Array.from({ length: 12 }, (_, i) =>
      tx('tax_pausal_advance', '9162.00', `2026-${String(i + 1).padStart(2, '0')}-15`),
    );
    const s = buildPodkladySummary(
      base({
        profiles: [pd],
        entries: [e('income_services', 'taxable_income', '850000.00')],
        transactions: advances,
      }),
      rules,
      d('2027-01-05'),
    );
    expect([
      s.flatRate,
      s.pausalniDan?.fitBand,
      f(s.pausalniDan?.paid ?? czk('0')),
      s.noReturnKey,
      s.partialXmlEligible,
      s.headline.label,
      f(s.advancesPaid),
    ]).toEqual([null, 1, '109944.00', 'pd.no_return', false, 'pausalni_dan', '109944.00']);
    const breach = buildPodkladySummary(
      base({ profiles: [pd], entries: [e('income_services', 'taxable_income', '1600000.00')] }),
      rules,
      d('2027-01-05'),
    );
    expect([
      breach.pausalniDan?.returnRequired,
      breach.partialXmlEligible,
      breach.noReturnKey,
    ]).toEqual([true, true, null]);
  });
  it('open year is watermarked; ucetnictvi is blocked; accommodation income adds its checklist key; no data → empty', () => {
    const open = buildPodkladySummary(
      base({ entries: [e('income_accommodation', 'taxable_income', '1000.00')] }),
      rules,
      d('2026-10-26'),
    );
    expect([
      open.watermark,
      open.checklistKeys.includes('podklady.checklist.accommodation'),
    ]).toEqual([true, true]);
    expect(
      buildPodkladySummary(
        base({ profiles: [seg({ taxRegime: 'ucetnictvi' })] }),
        rules,
        d('2027-02-10'),
      ).blocked,
    ).toBe(true);
    expect(buildPodkladySummary(base(), rules, d('2027-02-10')).empty).toBe(true);
  });
  it('regime of the year is the segment covering 31 December', () => {
    const s = buildPodkladySummary(
      base({
        profiles: [
          seg({ validTo: d('2026-06-30') }),
          seg({ validFrom: d('2026-07-01'), taxRegime: 'pausalni_vydaje', pausalRate: 60 }),
        ],
        entries: [e('income_services', 'taxable_income', '100.00')],
      }),
      rules,
      d('2027-02-10'),
    );
    expect([s.regime, s.readiness.map((c) => c.code)]).toEqual([
      'pausalni_vydaje',
      ['P_REGIME_CHANGED'],
    ]);
  });
});
