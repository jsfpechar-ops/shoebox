import { describe, expect, it } from 'vitest';
import {
  assetsBlock,
  categoryBlocks,
  comparisonBlock,
  pausalniBlock,
  vatNoteText,
} from '../src/podklady/summary-blocks';

const entry = {
  documentId: 'd1',
  entryDate: '2025-03-04',
  amountCzk: '1000.00',
  businessAmountCzk: '800.00',
};
const cat = (code: string, amount: string, business: string) => ({
  categoryCode: code,
  amount,
  businessAmount: business,
  entryCount: 1,
  entries: [entry],
});
const summary = {
  totals: {
    income: [cat('sales', '5000.00', '5000.00')],
    deductible: [cat('office', '1000.00', '800.00'), cat('mystery', '10.00', '10.00')],
    nonDeductible: [],
  },
  flatRate: {
    rate: 60,
    better: 'flat',
    difference: '1500.00',
    capReached: true,
    capKc: '2000000.00',
    caveatKeys: ['podklady.flat.caveat.depreciation', 'nope'],
    incomeKc: '5000.00',
  },
  pausalniDan: {
    fitBand: 1,
    limit: '1000000.00',
    expected: '600.00',
    paid: '600.00',
    delta: '0.00',
    advancesState: 'ok',
    noticeDue: '2026-01-10',
    warnings: [{ code: 'pd.lower_band_possible', params: { band: 1 } }],
  },
  assets: {
    assets: [{ description: 'Laptop', date: '2025-02-01', price: '30000.00' }],
    smallAssets: [],
  },
  privateUse: {
    personalCount: 2,
    personalSum: '500.00',
    partialShares: [{ description: 'Phone', totalCzk: '9000.00', businessSharePct: '50' }],
  },
  vatNote: { kind: 'none' },
};
const labels = new Map([
  ['sales', 'Sales'],
  ['office', 'Office'],
]);

describe('podklady summary blocks', () => {
  it('builds three groups, skipping empty ones', () => {
    const groups = categoryBlocks(summary, labels);
    expect(groups.map((g) => g.title)).toEqual(['Income', 'Expenses']);
    expect(groups[1]?.rows[0]?.label).toBe('Office');
    expect(groups[1]?.rows[0]?.amount).toContain('800');
    expect(groups[1]?.rows[0]?.entries[0]?.documentId).toBe('d1');
    expect(groups[1]?.rows[0]?.entries[0]?.date).toBe('4. 3. 2025');
  });
  it('falls back to the code for an unknown label', () => {
    expect(categoryBlocks(summary, labels)[1]?.rows[1]?.label).toBe('mystery');
  });
  it('compares flat rate, actual and equal', () => {
    const flat = comparisonBlock(summary);
    expect(flat?.text).toContain('60 %');
    expect(flat?.text).toContain('lower');
    expect(flat?.cap).toContain('Kč');
    expect(flat?.caveats).toHaveLength(1);
    const actual = comparisonBlock({
      flatRate: { ...summary.flatRate, better: 'actual', capReached: false },
    });
    expect(actual?.text).toContain('higher');
    expect(actual?.cap).toBeNull();
    expect(comparisonBlock({ flatRate: { better: 'equal' } })?.text).toContain('same base');
    expect(comparisonBlock({ flatRate: null })).toBeNull();
  });
  it('maps pausalni advances states', () => {
    const base = summary.pausalniDan;
    expect(pausalniBlock(summary)?.lines.join(' ')).toContain('All good');
    expect(pausalniBlock(summary)?.lines.join(' ')).toContain('10. 1. 2026');
    expect(pausalniBlock(summary)?.warnings).toHaveLength(1);
    const missing = pausalniBlock({
      pausalniDan: { ...base, advancesState: 'missing', delta: '100.00' },
    });
    expect(missing?.lines.join(' ')).toContain('100 Kč still to pay');
    const over = pausalniBlock({
      pausalniDan: { ...base, advancesState: 'overpaid', delta: '50.00' },
    });
    expect(over?.lines.join(' ')).toContain('Overpaid by 50');
    expect(pausalniBlock({ pausalniDan: null })).toBeNull();
  });
  it('builds assets rows and the personal line', () => {
    const a = assetsBlock(summary);
    expect(a.assets[0]?.title).toBe('Laptop');
    expect(a.personal).toContain('2 personal documents');
    expect(a.shares[0]?.pct).toBe('50');
    expect(vatNoteText(summary)).toContain('not registered');
  });
  it('survives null and garbage', () => {
    for (const bad of [null, undefined, 5, 'x', [], { totals: 3, flatRate: 'x', assets: [] }]) {
      expect(categoryBlocks(bad, labels)).toEqual([]);
      expect(comparisonBlock(bad)).toBeNull();
      expect(pausalniBlock(bad)).toBeNull();
      expect(assetsBlock(bad).assets).toEqual([]);
      expect(vatNoteText(bad)).toBeNull();
    }
  });
});
