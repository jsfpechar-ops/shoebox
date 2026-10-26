import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { type AssetLineInput, listAssets } from '../src/income-tax/assets';
import { summarizePrivateUse } from '../src/income-tax/private-use';
import { buildVatNote } from '../src/income-tax/vat-note';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const f = (m: Money) => m.toFixed2();
const line = (
  o: Partial<AssetLineInput> & { lineId: string; categoryCode: string },
): AssetLineInput => ({
  documentId: `doc-${o.lineId}`,
  documentNumber: null,
  partnerName: null,
  description: null,
  issueDate: d('2026-05-12'),
  paidAt: d('2026-05-12'),
  net: null,
  gross: null,
  businessSharePct: '100',
  vatDeducted: false,
  carFlag: false,
  paidInYear: czk('0.00'),
  ...o,
});

describe('listAssets (M06 §4.5)', () => {
  it('S2 van 650 000 is an asset; MacBook 26 990 a small asset; threshold 80 000', () => {
    const r = listAssets(
      [
        line({
          lineId: 'van',
          categoryCode: 'asset_long_term',
          gross: czk('650000.00'),
          net: czk('537190.08'),
          paidInYear: czk('650000.00'),
          carFlag: true,
          partnerName: 'Dealer',
        }),
        line({
          lineId: 'mac',
          categoryCode: 'exp_small_assets',
          gross: czk('26990.00'),
          issueDate: d('2026-03-02'),
          paidAt: d('2026-03-02'),
        }),
      ],
      rules,
      2026,
    );
    expect(f(r.threshold)).toBe('80000.00');
    expect(
      r.assets.map((a) => [a.lineId, f(a.price), f(a.paidInYear), a.carFlag, a.partnerName]),
    ).toEqual([['van', '650000.00', '650000.00', true, 'Dealer']]);
    expect(r.smallAssets.map((a) => [a.lineId, f(a.price), a.date])).toEqual([
      ['mac', '26990.00', '2026-03-02'],
    ]);
    expect(r.warnings).toEqual([]);
  });
  it('a deducting payer gets the net as the price; an IO the gross', () => {
    const payer = listAssets(
      [
        line({
          lineId: 'p',
          categoryCode: 'asset_long_term',
          net: czk('500000.00'),
          gross: czk('605000.00'),
          vatDeducted: true,
        }),
      ],
      rules,
      2026,
    );
    const io = listAssets(
      [
        line({
          lineId: 'i',
          categoryCode: 'asset_long_term',
          net: czk('500000.00'),
          gross: czk('605000.00'),
        }),
      ],
      rules,
      2026,
    );
    expect([f(payer.assets[0]?.price ?? czk('0')), f(io.assets[0]?.price ?? czk('0'))]).toEqual([
      '500000.00',
      '605000.00',
    ]);
  });
  it('warnings: an expense line above the threshold, an asset line at or below it (still listed)', () => {
    const r = listAssets(
      [
        line({ lineId: 'big', categoryCode: 'exp_material', gross: czk('90000.00') }),
        line({ lineId: 'edge', categoryCode: 'exp_material', gross: czk('80000.00') }),
        line({ lineId: 'small-asset', categoryCode: 'asset_long_term', gross: czk('50000.00') }),
      ],
      rules,
      2026,
    );
    expect(r.warnings).toEqual([
      {
        code: 'asset.maybe_misclassified',
        documentId: 'doc-big',
        lineId: 'big',
        params: { price: '90000.00', threshold: '80000.00' },
      },
      {
        code: 'asset.below_threshold',
        documentId: 'doc-small-asset',
        lineId: 'small-asset',
        params: { price: '50000.00', threshold: '80000.00' },
      },
    ]);
    expect(r.assets.map((a) => a.lineId)).toEqual(['small-asset']);
  });
  it('year filter is the union of paid_at and issue_date; a duplicated line counts once', () => {
    const r = listAssets(
      [
        line({
          lineId: 'old',
          categoryCode: 'asset_long_term',
          gross: czk('100000.00'),
          issueDate: d('2025-12-01'),
          paidAt: d('2025-12-15'),
        }),
        line({
          lineId: 'late-paid',
          categoryCode: 'asset_long_term',
          gross: czk('100000.00'),
          issueDate: d('2025-12-20'),
          paidAt: d('2026-01-05'),
        }),
        line({
          lineId: 'late-paid',
          categoryCode: 'asset_long_term',
          gross: czk('100000.00'),
          issueDate: d('2025-12-20'),
          paidAt: d('2026-01-05'),
        }),
        line({
          lineId: 'unpaid',
          categoryCode: 'asset_long_term',
          gross: czk('100000.00'),
          issueDate: d('2026-11-30'),
          paidAt: null,
        }),
      ],
      rules,
      2026,
    );
    expect(r.assets.map((a) => [a.lineId, a.date])).toEqual([
      ['late-paid', '2026-01-05'],
      ['unpaid', '2026-11-30'],
    ]);
  });
});

describe('summarizePrivateUse (M06 §4.6)', () => {
  it('Decathlon personal; phone 24 000 at 50 % → 12 000 / 12 000; car question answered flat_km 70 %', () => {
    const s = summarizePrivateUse({
      personalDocuments: [
        { documentId: 'decathlon', paidAt: d('2026-10-09'), amountCzk: czk('249.00') },
      ],
      partialShareLines: [
        {
          documentId: 'phone',
          lineId: 'l1',
          description: 'Phone plan',
          totalCzk: czk('24000.00'),
          businessSharePct: '50',
        },
        {
          documentId: 'full',
          lineId: 'l2',
          description: null,
          totalCzk: czk('100.00'),
          businessSharePct: '100',
        },
      ],
      carRegimeAnswers: [
        { questionId: 'q1', answer: null, businessSharePct: null },
        { questionId: 'q2', answer: 'flat_km', businessSharePct: '70' },
      ],
    });
    expect([s.personalCount, f(s.personalSum)]).toEqual([1, '249.00']);
    expect(s.partialShares.map((p) => [p.lineId, f(p.businessPart), f(p.privatePart)])).toEqual([
      ['l1', '12000.00', '12000.00'],
    ]);
    expect([s.carRegime, s.carBusinessSharePct]).toEqual(['flat_km', '70']);
    expect(
      summarizePrivateUse({ personalDocuments: [], partialShareLines: [], carRegimeAnswers: [] })
        .carRegime,
    ).toBe('unanswered');
  });
  it('an odd share rounds the business part half-up (33 % of 100,01 → 33,00)', () => {
    const s = summarizePrivateUse({
      personalDocuments: [],
      partialShareLines: [
        {
          documentId: 'x',
          lineId: 'l',
          description: null,
          totalCzk: czk('100.01'),
          businessSharePct: '33',
        },
      ],
      carRegimeAnswers: [],
    });
    expect([
      f(s.partialShares[0]?.businessPart ?? czk('0')),
      f(s.partialShares[0]?.privatePart ?? czk('0')),
    ]).toEqual(['33.00', '67.01']);
  });
});

describe('buildVatNote (M06 §4.7)', () => {
  const threshold = rules.at('2026-12-31').get('vat.registration_thresholds').calendar_year;
  it('S4: IO since 3. 8. 2026 after a non-payer segment → mixed, VAT payments 5 348 listed, two filings', () => {
    const n = buildVatNote(
      {
        year: 2026,
        segments: [
          { validFrom: d('2025-01-01'), validTo: d('2026-08-02'), vatStatus: 'neplatce' },
          { validFrom: d('2026-08-03'), validTo: null, vatStatus: 'identifikovana_osoba' },
        ],
        vatPayments: czk('5348.00'),
        vatFilings: [
          { periodStart: d('2026-08-01'), row64: czk('2877.00'), state: 'marked_filed' },
          { periodStart: d('2026-09-01'), row64: czk('2471.00'), state: 'generated' },
        ],
        domesticCashIncome: czk('240000.00'),
      },
      rules,
    );
    expect([n.kind, n.textKey, f(n.vatPaid), n.filings.length, n.registrationWarning]).toEqual([
      'mixed',
      'podklady.vat.mixed',
      '5348.00',
      2,
      false,
    ]);
    expect(n.segments).toEqual([
      { from: '2026-01-01', to: '2026-08-02', vatStatus: 'neplatce' },
      { from: '2026-08-03', to: null, vatStatus: 'identifikovana_osoba' },
    ]);
  });
  it('payer all year → payer text, no registration warning even above the threshold; IO above the threshold warns', () => {
    const base = {
      year: 2026,
      vatPayments: czk('0.00'),
      vatFilings: [],
      domesticCashIncome: Money.parse(String(threshold + 1), CZK),
    };
    const payer = buildVatNote(
      { ...base, segments: [{ validFrom: d('2024-01-01'), validTo: null, vatStatus: 'platce' }] },
      rules,
    );
    const io = buildVatNote(
      {
        ...base,
        segments: [
          { validFrom: d('2024-01-01'), validTo: null, vatStatus: 'identifikovana_osoba' },
        ],
      },
      rules,
    );
    expect([
      payer.kind,
      payer.registrationWarning,
      io.kind,
      io.registrationWarning,
      f(io.registrationThreshold),
    ]).toEqual(['payer', false, 'io', true, `${threshold}.00`]);
    const none = buildVatNote(
      {
        ...base,
        domesticCashIncome: czk('100.00'),
        segments: [{ validFrom: d('2024-01-01'), validTo: null, vatStatus: 'neplatce' }],
      },
      rules,
    );
    expect([none.kind, none.registrationWarning]).toEqual(['none', false]);
  });
});
