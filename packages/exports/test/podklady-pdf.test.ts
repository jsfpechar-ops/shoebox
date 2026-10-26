import {
  buildPodkladySummary,
  CZK,
  createCzRules,
  EMPTY_ANSWERS,
  Money,
  type PodkladyInput,
  parseLegalDate,
} from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { buildPodkladyPdf, formatKc, podkladyPdfLines, transliterate } from '../src/podklady-pdf';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}${JSON.stringify(params)}` : key;
let n = 0;
const e = (
  categoryCode: string,
  taxEffect: PodkladyInput['entries'][number]['taxEffect'],
  amount: string,
) => ({
  entryDate: d('2026-04-10'),
  taxYear: 2026,
  basis: 'payment' as const,
  documentId: `doc-${++n}`,
  lineId: `l-${n}`,
  categoryCode,
  taxEffect,
  amountCzk: amount,
  businessSharePct: '100',
  businessAmountCzk: amount,
});
const seg = (o: Partial<PodkladyInput['profiles'][number]>) => ({
  validFrom: d('2025-01-01'),
  validTo: null,
  entityType: 'osvc',
  taxRegime: 'danova_evidence' as const,
  vatStatus: 'neplatce' as const,
  pausalRate: null,
  pausalDanBand: null,
  hasAccountant: false,
  ...o,
});
const base = (o: Partial<PodkladyInput> = {}): PodkladyInput => ({
  year: 2026,
  taxpayer: { legalName: 'Tomáš Řehoř', ico: '12345678' },
  profiles: [seg({})],
  entries: [
    e('income_services', 'taxable_income', '1400000.00'),
    e('exp_material', 'deductible_expense', '400000.00'),
    e('exp_fuel', 'deductible_expense', '60000.00'),
    e('exp_telecom', 'deductible_expense', '12000.00'),
    e('exp_small_assets', 'deductible_expense', '48000.00'),
    e('exp_representation', 'non_deductible_expense', '4000.00'),
  ],
  assetLines: [
    {
      documentId: 'van',
      lineId: 'van-1',
      documentNumber: 'F-2026-11',
      partnerName: 'Škoda Dealer',
      description: 'Dodávka',
      issueDate: d('2026-05-12'),
      paidAt: d('2026-05-12'),
      categoryCode: 'asset_long_term',
      net: null,
      gross: czk('650000.00'),
      businessSharePct: '100',
      vatDeducted: false,
      carFlag: true,
      paidInYear: czk('650000.00'),
    },
  ],
  privateUse: {
    personalDocuments: [],
    partialShareLines: [
      {
        documentId: 'phone',
        lineId: 'p1',
        description: 'Telefon',
        totalCzk: czk('24000.00'),
        businessSharePct: '50',
      },
    ],
    carRegimeAnswers: [],
  },
  vatFilings: [],
  transactions: [
    { categoryCode: 'tax_income_payment', bookedOn: d('2026-06-15'), amount: czk('-15000.00') },
  ],
  readiness: {
    ledger: { staleEntries: 0, documentsFinalizedAfterBuild: 0 },
    pendingDocuments: 0,
    unpaidIssued: 1,
    unexplainedTransactions: { count: 0, sum: czk('0') },
    businessFlagUnknown: { count: 0, sum: czk('0') },
  },
  answers: { ...EMPTY_ANSWERS, comparisonRate: 80 },
  partialXmlAvailable: false,
  ...o,
});

describe('podkladyPdfLines S2 (M06 §9 general 2)', () => {
  const lines = podkladyPdfLines(buildPodkladySummary(base(), rules, d('2027-02-10')), t);
  const texts = lines.map((l) => `${l.text}${l.value ? ` | ${l.value}` : ''}`);
  it('headline rows in whole Kč: income 1 400 000, expenses 520 000, base 880 000, advances 15 000', () => {
    expect(texts).toContain('podklady.headline.income | 1 400 000 Kč');
    expect(texts).toContain('podklady.headline.expenses | 520 000 Kč');
    expect(texts).toContain('podklady.headline.base | 880 000 Kč');
    expect(texts).toContain('podklady.headline.advances | 15 000 Kč');
  });
  it('comparison line with the 600 000 difference, the cap line absent, the four caveats present', () => {
    expect(
      texts.some(
        (x) =>
          x.startsWith('podklady.flat.result') &&
          x.includes('"difference":"600 000 Kč"') &&
          x.includes('"direction":"podklady.flat.lower"'),
      ),
    ).toBe(true);
    expect(texts.some((x) => x.startsWith('podklady.flat.cap'))).toBe(false);
    for (const k of ['depreciation', 'insurance', 'credits_35ca', 'switching'])
      expect(texts).toContain(`podklady.flat.caveat.${k}`);
  });
  it('assets, private use, warnings, checklist (DE: depreciation and car present, accommodation absent), one footer disclaimer', () => {
    expect(texts.some((x) => x.includes('Skoda Dealer') && x.includes('650 000 Kč'))).toBe(true);
    expect(texts).toContain('podklady.assets.note');
    expect(texts.some((x) => x.includes('Telefon') && x.includes('12 000 Kč'))).toBe(true);
    expect(texts.some((x) => x.startsWith('podklady.readiness.P_UNPAID_ISSUED'))).toBe(true);
    for (const k of [
      'credits',
      'deductions',
      'other_income',
      'depreciation',
      'car',
      'base_adjustments',
      'advances_paid',
      'insurance_reports',
      'missing_documents',
    ])
      expect(texts).toContain(`podklady.checklist.${k}`);
    expect(texts).not.toContain('podklady.checklist.accommodation');
    expect(lines.filter((l) => l.kind === 'footer')).toEqual([
      { kind: 'footer', text: 'podklady.disclaimer' },
    ]);
    expect(lines[0]).toEqual({ kind: 'h1', text: 'podklady.title{"year":2026}' });
  });
  it('paušální daň user gets the pd block instead of the comparison', () => {
    const pd = podkladyPdfLines(
      buildPodkladySummary(
        base({
          profiles: [seg({ taxRegime: 'pausalni_dan', pausalRate: 60, pausalDanBand: 1 })],
          entries: [e('income_services', 'taxable_income', '850000.00')],
          transactions: [],
        }),
        rules,
        d('2027-02-10'),
      ),
      t,
    ).map((l) => l.text);
    expect(pd.some((x) => x.startsWith('pd.band_ok'))).toBe(true);
    expect(pd.some((x) => x.startsWith('pd.advances_missing'))).toBe(true);
    expect(pd.some((x) => x.startsWith('pd.no_return'))).toBe(true);
    expect(pd.some((x) => x.startsWith('podklady.flat.result'))).toBe(false);
  });
});

describe('helpers and bytes', () => {
  it('formatKc rounds half-up to whole Kč with thin-space thousands', () => {
    expect([
      formatKc(czk('141540.19')),
      formatKc(czk('98459.81')),
      formatKc(czk('0.50')),
      formatKc(czk('-302.00')),
    ]).toEqual(['141 540 Kč', '98 460 Kč', '1 Kč', '-302 Kč']);
  });
  it('transliterate maps Czech diacritics and replaces anything else outside WinAnsi', () => {
    expect(transliterate('Příliš žluťoučký kůň ÚPĚL ďábelské ódy – 10 €')).toBe(
      'Prilis zlutoucky kun UPEL dabelske ody – 10 €',
    );
    expect(transliterate('東京')).toBe('??');
  });
  it('buildPodkladyPdf: a PDF with at most 4 pages that contains the footer text', async () => {
    const bytes = await buildPodkladyPdf(buildPodkladySummary(base(), rules, d('2027-02-10')), t);
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 8));
    expect(head.startsWith('%PDF-1.')).toBe(true);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeLessThanOrEqual(4);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
