import { describe, expect, it } from 'vitest';
import { type LegalDate, parseLegalDate } from '../src/dates/index';
import {
  computeOverviewTotals,
  type OverviewDocument,
  type OverviewLine,
  overviewDocDate,
} from '../src/overview/totals';

const d = (s: string): LegalDate => parseLegalDate(s);
const asOf = d('2026-10-25');

function line(over: Partial<OverviewLine> = {}): OverviewLine {
  return {
    lineType: 'item',
    net: '1000.00',
    gross: '1210.00',
    vatTreatment: null,
    taxEffect: 'deductible_expense',
    businessSharePct: '100',
    ...over,
  };
}

function doc(over: Partial<OverviewDocument> = {}): OverviewDocument {
  return {
    status: 'ready',
    class: 'received_invoice',
    direction: 'in',
    businessFlag: 'business',
    deleted: false,
    duzp: d('2026-10-10'),
    issueDate: null,
    receivedDate: null,
    servicePeriodTo: null,
    currency: 'CZK',
    fxRate: null,
    totalGross: '1210.00',
    partnerCountry: 'CZ',
    partnerVatId: null,
    lines: [line()],
    ...over,
  };
}

function income(over: Partial<OverviewDocument> = {}, l: Partial<OverviewLine> = {}) {
  return doc({
    class: 'issued_invoice',
    direction: 'out',
    lines: [line({ taxEffect: 'taxable_income', ...l })],
    ...over,
  });
}

describe('overviewDocDate', () => {
  it('uses DUZP, then the issue date, then the received date', () => {
    expect(overviewDocDate(doc())).toBe('2026-10-10');
    expect(overviewDocDate(doc({ duzp: null, issueDate: d('2026-09-01') }))).toBe('2026-09-01');
    expect(overviewDocDate(doc({ duzp: null, receivedDate: d('2026-08-01') }))).toBe('2026-08-01');
    expect(overviewDocDate(doc({ duzp: null }))).toBeNull();
  });

  it('uses the end of the service period for platform statements', () => {
    const statement = doc({
      class: 'platform_statement',
      servicePeriodTo: d('2026-09-30'),
      issueDate: d('2026-10-02'),
    });
    expect(overviewDocDate(statement)).toBe('2026-09-30');
  });
});

describe('computeOverviewTotals', () => {
  it('returns zeros without documents', () => {
    const t = computeOverviewTotals([], 'neplatce', asOf);
    expect(t.month.income.toFixed2()).toBe('0.00');
    expect(t.month.expenses.toFixed2()).toBe('0.00');
    expect(t.ytd.income.toFixed2()).toBe('0.00');
    expect(t.ytd.expenses.toFixed2()).toBe('0.00');
    expect(t.turnoverYtd.toFixed2()).toBe('0.00');
    expect(t.countedCount).toBe(0);
    expect(t.pending.count).toBe(0);
    expect(t.pending.grossCzk.toFixed2()).toBe('0.00');
  });

  it('a non-payer counts gross amounts, a VAT payer counts net', () => {
    const docs = [doc(), income()];
    const non = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(non.ytd.expenses.toFixed2()).toBe('1210.00');
    expect(non.ytd.income.toFixed2()).toBe('1210.00');
    const io = computeOverviewTotals(docs, 'identifikovana_osoba', asOf);
    expect(io.ytd.expenses.toFixed2()).toBe('1210.00');
    const payer = computeOverviewTotals(docs, 'platce', asOf);
    expect(payer.ytd.expenses.toFixed2()).toBe('1000.00');
    expect(payer.ytd.income.toFixed2()).toBe('1000.00');
  });

  it('splits this month from the year to date and ignores later and earlier years', () => {
    const docs = [
      doc({ duzp: d('2026-10-01') }),
      doc({ duzp: d('2026-03-15') }),
      doc({ duzp: d('2026-10-26') }),
      doc({ duzp: d('2025-12-31') }),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.month.expenses.toFixed2()).toBe('1210.00');
    expect(t.ytd.expenses.toFixed2()).toBe('2420.00');
    expect(t.countedCount).toBe(2);
  });

  it('counts only ready and finalized documents of bookable classes', () => {
    const docs = [
      doc(),
      doc({ status: 'finalized' }),
      doc({ status: 'needs_review' }),
      doc({ status: 'duplicate' }),
      doc({ status: 'supporting' }),
      doc({ class: 'order_confirmation' }),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.ytd.expenses.toFixed2()).toBe('2420.00');
    expect(t.countedCount).toBe(2);
    expect(t.pending.count).toBe(1);
    expect(t.pending.grossCzk.toFixed2()).toBe('1210.00');
  });

  it('leaves out personal and deleted documents; an unknown business flag is pending', () => {
    const docs = [
      doc({ businessFlag: 'personal' }),
      doc({ deleted: true }),
      doc({ businessFlag: 'unknown' }),
      doc({ businessFlag: 'mixed' }),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.ytd.expenses.toFixed2()).toBe('1210.00');
    expect(t.countedCount).toBe(1);
    expect(t.pending.count).toBe(1);
  });

  it('applies the business share, counts assets and non-deductible costs, skips text lines', () => {
    const lines = [
      line({ businessSharePct: '50' }),
      line({ taxEffect: 'asset', gross: '100000.00' }),
      line({ taxEffect: 'non_deductible_expense', gross: '10.00' }),
      line({ taxEffect: 'private', gross: '999.00' }),
      line({ lineType: 'text', net: null, gross: null, taxEffect: null }),
    ];
    const t = computeOverviewTotals([doc({ lines })], 'neplatce', asOf);
    expect(t.ytd.expenses.toFixed2()).toBe('100615.00');
  });

  it('credit notes always lower the total, whatever sign was printed', () => {
    const docs = [
      doc(),
      doc({ class: 'received_credit_note', lines: [line({ gross: '-210.00' })] }),
      doc({ class: 'received_credit_note', lines: [line({ gross: '210.00' })] }),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.ytd.expenses.toFixed2()).toBe('790.00');
  });

  it('converts foreign currency with the document rate; a missing rate makes it pending', () => {
    const eur = { currency: 'EUR', totalGross: '100.00', lines: [line({ gross: '100.00' })] };
    const t = computeOverviewTotals(
      [doc({ ...eur, fxRate: '24.300000' }), doc({ ...eur, fxRate: null })],
      'neplatce',
      asOf,
    );
    expect(t.ytd.expenses.toFixed2()).toBe('2430.00');
    expect(t.countedCount).toBe(1);
    expect(t.pending.count).toBe(1);
    expect(t.pending.grossCzk.toFixed2()).toBe('0.00');
  });

  it('an uncategorized line makes the whole document pending', () => {
    const t = computeOverviewTotals(
      [doc({ lines: [line(), line({ taxEffect: null })] })],
      'neplatce',
      asOf,
    );
    expect(t.ytd.expenses.toFixed2()).toBe('0.00');
    expect(t.countedCount).toBe(0);
    expect(t.pending.count).toBe(1);
    expect(t.pending.grossCzk.toFixed2()).toBe('1210.00');
  });

  it('a document without a date is pending; a pending one from last year is not', () => {
    const docs = [
      doc({ status: 'extracting', duzp: null }),
      doc({ status: 'needs_review', duzp: d('2025-11-01') }),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.pending.count).toBe(1);
  });

  it('turnover counts domestic taxable income net, without foreign B2B and EU lines', () => {
    const docs = [
      income({}, { net: '1000.00', gross: '1210.00' }),
      income({}, { vatTreatment: 'iss_eu_service', net: '500.00', gross: '500.00' }),
      income(
        { partnerCountry: 'DE', partnerVatId: 'DE123456789' },
        { net: '300.00', gross: '300.00' },
      ),
      income({ partnerCountry: 'DE', partnerVatId: null }, { net: '200.00', gross: '200.00' }),
      income({ duzp: d('2025-12-01') }, { net: '7000.00', gross: '7000.00' }),
      doc(),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.turnoverYtd.toFixed2()).toBe('1200.00');
    expect(t.ytd.income.toFixed2()).toBe('2210.00');
  });
});
