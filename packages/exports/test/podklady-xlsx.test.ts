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
import { buildPodkladyXlsx, PODKLADY_SHEETS, podkladySheets } from '../src/podklady-xlsx';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
let n = 0;
const e = (
  categoryCode: string,
  taxEffect: PodkladyInput['entries'][number]['taxEffect'],
  amount: string,
  o: Partial<PodkladyInput['entries'][number]> = {},
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
  ...o,
});
const input: PodkladyInput = {
  year: 2026,
  taxpayer: { legalName: 'Josef Novák', ico: '87654321' },
  profiles: [
    {
      validFrom: d('2026-08-03'),
      validTo: null,
      entityType: 'osvc',
      taxRegime: 'danova_evidence',
      vatStatus: 'identifikovana_osoba',
      pausalRate: null,
      pausalDanBand: null,
      hasAccountant: true,
    },
    {
      validFrom: d('2025-01-01'),
      validTo: d('2026-08-02'),
      entityType: 'osvc',
      taxRegime: 'danova_evidence',
      vatStatus: 'neplatce',
      pausalRate: null,
      pausalDanBand: null,
      hasAccountant: true,
    },
  ],
  entries: [
    e('income_accommodation', 'taxable_income', '180000.00'),
    e('income_services', 'taxable_income', '60000.00'),
    e('exp_cleaning', 'deductible_expense', '11600.00'),
    e('exp_cleaning', 'deductible_expense', '8150.00'),
    e('exp_property_management', 'deductible_expense', '12960.84'),
    e('exp_property_management', 'deductible_expense', '9749.44'),
    e('exp_platform_commission', 'deductible_expense', '13699.77'),
    e('exp_platform_commission', 'deductible_expense', '11549.94'),
    e('exp_small_assets', 'deductible_expense', '26990.00'),
    e('exp_material', 'deductible_expense', '1198.00'),
    e('exp_material', 'deductible_expense', '117.00'),
    e('exp_hosting_domains', 'deductible_expense', '226.50'),
    e('exp_software_saas', 'deductible_expense', '2218.32'),
    e('pt_tourist_fee', 'pass_through', '3500.00'),
    e('pt_tourist_fee', 'pass_through', '4150.00'),
    e('exp_other_deductible', 'private', '249.00', {
      documentId: 'decathlon',
      businessSharePct: '0',
      businessAmountCzk: '0.00',
    }),
    e('income_services', 'taxable_income', '5000.00', {
      basis: 'provisional',
      entryDate: d('2026-12-20'),
    }),
  ],
  assetLines: [
    {
      documentId: 'macbook',
      lineId: 'mac-1',
      documentNumber: 'UA30417938',
      partnerName: 'Apple',
      description: 'MacBook',
      issueDate: d('2026-03-02'),
      paidAt: d('2026-03-02'),
      categoryCode: 'exp_small_assets',
      net: null,
      gross: czk('26990.00'),
      businessSharePct: '100',
      vatDeducted: false,
      carFlag: false,
      paidInYear: czk('26990.00'),
    },
  ],
  privateUse: {
    personalDocuments: [
      { documentId: 'decathlon', paidAt: d('2026-10-09'), amountCzk: czk('249.00') },
    ],
    partialShareLines: [],
    carRegimeAnswers: [],
  },
  vatFilings: [{ periodStart: d('2026-08-01'), row64: czk('2877.00'), state: 'marked_filed' }],
  transactions: [
    { categoryCode: 'tax_vat_payment', bookedOn: d('2026-09-25'), amount: czk('-2877.00') },
    { categoryCode: 'tax_vat_payment', bookedOn: d('2026-10-25'), amount: czk('-2471.00') },
  ],
  readiness: {
    ledger: { staleEntries: 0, documentsFinalizedAfterBuild: 0 },
    pendingDocuments: 2,
    unpaidIssued: 0,
    unexplainedTransactions: { count: 0, sum: czk('0') },
    businessFlagUnknown: { count: 0, sum: czk('0') },
  },
  answers: { ...EMPTY_ANSWERS, comparisonRate: 60 },
  partialXmlAvailable: false,
};
const summary = buildPodkladySummary(input, rules, d('2027-02-10'));
const opts = { appOrigin: 'https://app.example', label: (k: string) => `[${k}]` };
const sheets = podkladySheets(summary, opts);
const sheet = (name: string) => sheets.find((s) => s.name === name)?.rows ?? [];
const row = (name: string, first: string) => sheet(name).find((r) => r[0] === first);

describe('podkladySheets S4 (M06 §9, haléře)', () => {
  it('11 sheets for a DE user (no Flat-rate tax); names from PODKLADY_SHEETS', () => {
    expect(sheets.map((s) => s.name)).toEqual(PODKLADY_SHEETS.filter((s) => s !== 'Flat-rate tax'));
    expect(sheets.every((s) => s.name.length <= 31)).toBe(true);
  });
  it('Summary: income 240 000,00; expenses 98 459,81; base 141 540; flat comparison at 60 %; disclaimer text', () => {
    expect(row('Summary', 'Income')).toEqual(['Income', { num: '240000.00' }]);
    expect(row('Summary', 'Expenses')).toEqual(['Expenses', { num: '98459.81' }]);
    expect(row('Summary', 'Base before adjustments')).toEqual([
      'Base before adjustments',
      { num: '141540.00' },
    ]);
    expect(row('Summary', 'Flat-rate expenses')).toEqual([
      'Flat-rate expenses',
      { num: '144000.00' },
    ]);
    expect(row('Summary', 'Difference')).toEqual(['Difference', { num: '45540.00' }]);
    expect(row('Summary', 'Disclaimer')).toEqual(['Disclaimer', '[podklady.disclaimer]']);
  });
  it('Income has 2 entries; Expenses 12 (11 deductible + Decathlon private); Unpaid has the provisional 5 000', () => {
    expect(sheet('Income')).toHaveLength(3);
    expect(sheet('Expenses')).toHaveLength(13);
    const dec = sheet('Expenses').find((r) => r[3] === 'decathlon');
    expect(dec?.slice(5)).toEqual([
      { num: '249.00' },
      { num: '0' },
      { num: '0.00' },
      { num: '249.00' },
    ]);
    expect(sheet('Expenses').some((r) => r[4] === 'https://app.example/documents/decathlon')).toBe(
      true,
    );
    expect(sheet('Unpaid at year end')).toHaveLength(2);
    expect(sheet('Unpaid at year end')[1]?.[5]).toEqual({ num: '5000.00' });
  });
  it('Categories: tourist fee 7 650 as pass_through; totals rows', () => {
    const fee = sheet('Categories').find((r) => r[0] === 'pt_tourist_fee');
    expect(fee?.[2]).toBe('pass_through');
    expect(fee?.[4]).toEqual({ num: '7650.00' });
    expect(row('Categories', 'Income total')?.[4]).toEqual({ num: '240000.00' });
    expect(row('Categories', 'Deductible total')?.[5]).toEqual({ num: '98459.81' });
  });
  it('Assets empty with the note; Small assets has the MacBook; Private has Decathlon; payments has VAT by month', () => {
    expect(sheet('Assets')).toEqual([
      [
        'Date',
        'Supplier',
        'Description',
        'Document',
        'Price CZK',
        'Paid in year CZK',
        'Share %',
        'Car',
        'Link',
      ],
      ['[podklady.assets.note]'],
    ]);
    expect(sheet('Small assets')[1]?.slice(0, 5)).toEqual([
      '2026-03-02',
      'Apple',
      'MacBook',
      'UA30417938',
      { num: '26990.00' },
    ]);
    expect(sheet('Private')[0]).toEqual(['Personal documents', { num: '1' }, { num: '249.00' }]);
    const vat = sheet('Tax and insurance payments').find((r) => r[0] === 'tax_vat_payment');
    expect([vat?.[2], vat?.[3 + 8], vat?.[3 + 9]]).toEqual([
      { num: '5348.00' },
      { num: '2877.00' },
      { num: '2471.00' },
    ]);
  });
  it('Missing lists the pending-documents warning; Checklist has the accommodation item and no depreciation twice', () => {
    expect(
      sheet('Missing').some(
        (r) =>
          r[0] === 'P_PENDING_DOCUMENTS' && r[2] === '[podklady.readiness.P_PENDING_DOCUMENTS]',
      ),
    ).toBe(true);
    const keys = sheet('Checklist').map((r) => r[0]);
    expect(keys).toContain('podklady.checklist.accommodation');
    expect(keys).toContain('podklady.checklist.depreciation');
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('buildPodkladyXlsx is a ZIP with one worksheet per sheet', () => {
    const bytes = buildPodkladyXlsx(summary, opts, new Date(0));
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('xl/worksheets/sheet11.xml');
    expect(text).not.toContain('xl/worksheets/sheet12.xml');
  });
});
