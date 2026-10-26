import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import type { FxRateRow } from '../src/fx';
import {
  buildTaxLedgerEntries,
  LedgerInputError,
  type TaxLedgerDocument,
  type TaxLedgerEntryDraft,
  type TaxLedgerInput,
  type TaxLedgerLine,
  type TaxLedgerPayment,
} from '../src/ledgers/tax';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import type { VatProfileSlice } from '../src/vat/point-date';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const IO: VatProfileSlice = {
  vatStatus: 'identifikovana_osoba',
  vatPeriod: null,
  foreignServiceDppdPolicy: 'issue_date',
};
const PAYER: VatProfileSlice = {
  vatStatus: 'platce',
  vatPeriod: 'quarterly',
  foreignServiceDppdPolicy: 'service_period_end',
};
const io = () => IO;
const payer = () => PAYER;
const RATES: FxRateRow[] = [
  { rateDate: d('2026-10-02'), currency: 'USD', amount: 1, rate: '23.456000' },
  { rateDate: d('2026-10-05'), currency: 'EUR', amount: 1, rate: '24.580000' },
];

function line(over: Partial<TaxLedgerLine> = {}): TaxLedgerLine {
  return {
    lineId: `l${over.position ?? 1}`,
    position: 1,
    lineType: 'item',
    net: czk('10711.44'),
    vat: czk('2249.40'),
    gross: czk('12960.84'),
    categoryCode: 'exp_property_management',
    businessSharePct: '100',
    coveredByDocumentId: null,
    ...over,
  };
}
function doc(over: Partial<TaxLedgerDocument> = {}): TaxLedgerDocument {
  return {
    documentId: 'doc-1',
    class: 'received_invoice',
    status: 'ready',
    deleted: false,
    currency: 'CZK',
    issueDate: d('2026-09-01'),
    dueDate: d('2026-09-15'),
    paidAt: null,
    vatPointDate: null,
    isPaidPerDocument: null,
    paymentMethod: 'bank_transfer',
    deductionAllowed: false,
    lines: [line()],
    ...over,
  };
}
function pay(over: Partial<TaxLedgerPayment> = {}): TaxLedgerPayment {
  return {
    paymentLinkId: 'pl-1',
    transactionId: 'tx-1',
    linkType: 'payment',
    bookedOn: d('2026-09-10'),
    amountDoc: czk('12960.84'),
    amountAccount: czk('12960.84'),
    ...over,
  };
}
function build(over: Partial<TaxLedgerInput> = {}): TaxLedgerEntryDraft[] {
  return buildTaxLedgerEntries({
    doc: doc(),
    payments: [],
    profileAt: io,
    fxRates: RATES,
    rules,
    ...over,
  });
}
const brief = (es: TaxLedgerEntryDraft[]) =>
  es.map((e) => [e.lineId, e.basis, e.entryDate, e.amountCzk.toFixed2()]);
const total = (es: TaxLedgerEntryDraft[]) =>
  Money.sum(
    es.map((e) => e.amountCzk),
    'CZK',
  ).toFixed2();

describe('golden shapes (M04 §9.1)', () => {
  it('AC-9a: manager invoice for an IO carries VAT as cost; one entry per line × payment', () => {
    const es = build({ payments: [pay()] });
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({
      entryDate: '2026-09-10',
      taxYear: 2026,
      basis: 'payment',
      documentId: 'doc-1',
      lineId: 'l1',
      paymentLinkId: 'pl-1',
      transactionId: 'tx-1',
      categoryCode: 'exp_property_management',
      taxEffect: 'deductible_expense',
      businessSharePct: '100',
    });
    expect(es[0]?.amountCzk.toFixed2()).toBe('12960.84');
    expect(es[0]?.businessAmountCzk.toFixed2()).toBe('12960.84');
  });

  it('AC-11: a deducting payer books the net', () => {
    const es = build({ doc: doc({ deductionAllowed: true }), payments: [pay()], profileAt: payer });
    expect(total(es)).toBe('10711.44');
    const noDeduction = build({
      doc: doc({ deductionAllowed: false }),
      payments: [pay()],
      profileAt: payer,
    });
    expect(total(noDeduction)).toBe('12960.84');
  });

  const twoLines = [
    line({ position: 1, net: czk('8000.00'), vat: czk('1680.00'), gross: czk('9680.00') }),
    line({ position: 2, net: czk('2711.44'), vat: czk('569.40'), gross: czk('3280.84') }),
  ];

  it('two lines, full payment: payer amounts are the nets exactly', () => {
    const es = build({
      doc: doc({ lines: twoLines, deductionAllowed: true }),
      payments: [pay()],
      profileAt: payer,
    });
    expect(brief(es)).toEqual([
      ['l1', 'payment', '2026-09-10', '8000.00'],
      ['l2', 'payment', '2026-09-10', '2711.44'],
    ]);
  });

  it('partial payment: pro-rata allocation plus a provisional remainder on the due date (IO)', () => {
    const es = build({
      doc: doc({ lines: twoLines }),
      payments: [pay({ amountDoc: czk('5000.00'), amountAccount: czk('5000.00') })],
    });
    expect(brief(es)).toEqual([
      ['l1', 'payment', '2026-09-10', '3734.33'],
      ['l2', 'payment', '2026-09-10', '1265.67'],
      ['l1', 'provisional', '2026-09-15', '5945.67'],
      ['l2', 'provisional', '2026-09-15', '2015.17'],
    ]);
    expect(total(es)).toBe('12960.84');
    expect(es[2]?.paymentLinkId).toBeNull();
    expect(es[2]?.transactionId).toBeNull();
  });

  it('partial payment for a deducting payer: amounts scale by basis/gross and still sum to round2(p × Σbasis / W)', () => {
    const es = build({
      doc: doc({ lines: twoLines, deductionAllowed: true }),
      payments: [pay({ amountDoc: czk('5000.00'), amountAccount: czk('5000.00') })],
      profileAt: payer,
    });
    expect(brief(es.slice(0, 2))).toEqual([
      ['l1', 'payment', '2026-09-10', '3086.22'],
      ['l2', 'payment', '2026-09-10', '1046.01'],
    ]);
  });

  it('a remainder of 0.01 or less is not provisional; 0.02 is', () => {
    expect(
      build({ payments: [pay({ amountDoc: czk('12960.83'), amountAccount: czk('12960.83') })] }),
    ).toHaveLength(1);
    const es = build({
      payments: [pay({ amountDoc: czk('12960.82'), amountAccount: czk('12960.82') })],
    });
    expect(brief(es)).toEqual([
      ['l1', 'payment', '2026-09-10', '12960.82'],
      ['l1', 'provisional', '2026-09-15', '0.02'],
    ]);
  });

  it('AC-9i: MacBook for an IO at 80 % → 26 990,00 and business 21 592,00; a deducting payer books the net only (K-C01)', () => {
    const mac = line({
      net: czk('22305.79'),
      vat: czk('4684.21'),
      gross: czk('26990.00'),
      categoryCode: 'exp_small_assets',
      businessSharePct: '80',
    });
    const es = build({
      doc: doc({ lines: [mac] }),
      payments: [pay({ amountDoc: czk('26990.00'), amountAccount: czk('26990.00') })],
    });
    expect(es[0]?.amountCzk.toFixed2()).toBe('26990.00');
    expect(es[0]?.businessAmountCzk.toFixed2()).toBe('21592.00');
    expect(es[0]?.businessSharePct).toBe('80');
    const p = build({
      doc: doc({ lines: [mac], deductionAllowed: true }),
      payments: [pay({ amountDoc: czk('26990.00'), amountAccount: czk('26990.00') })],
      profileAt: payer,
    });
    expect(p[0]?.amountCzk.toFixed2()).toBe('22305.79');
    expect(p[0]?.businessAmountCzk.toFixed2()).toBe('17844.63');
  });

  it('AC-9j: IKEA card receipt → document_evidence on the issue date, no link ids', () => {
    const ikea = doc({
      class: 'received_receipt',
      paymentMethod: 'card',
      issueDate: d('2026-05-12'),
      dueDate: null,
      lines: [
        line({
          net: czk('990.08'),
          vat: czk('207.92'),
          gross: czk('1198.00'),
          categoryCode: 'exp_small_assets',
        }),
      ],
    });
    const es = build({ doc: ikea });
    expect(brief(es)).toEqual([['l1', 'document_evidence', '2026-05-12', '1198.00']]);
    expect(es[0]).toMatchObject({ paymentLinkId: null, transactionId: null, taxYear: 2026 });
  });

  it('isPaidPerDocument on an invoice → document_evidence on paidAt; card on a plain invoice → provisional', () => {
    const paid = build({ doc: doc({ isPaidPerDocument: true, paidAt: d('2026-09-03') }) });
    expect(brief(paid)).toEqual([['l1', 'document_evidence', '2026-09-03', '12960.84']]);
    const card = build({ doc: doc({ paymentMethod: 'card' }) });
    expect(brief(card)).toEqual([['l1', 'provisional', '2026-09-15', '12960.84']]);
  });

  it('AC-9k: Alza 117 Kč — discount and rounding lines carry their signed amounts; Σ = printed total', () => {
    const alza = doc({
      issueDate: d('2026-09-18'),
      dueDate: null,
      lines: [
        line({
          position: 1,
          net: czk('118.90'),
          vat: null,
          gross: czk('118.90'),
          categoryCode: 'exp_office_supplies',
        }),
        line({
          position: 2,
          lineType: 'discount',
          net: czk('-1.95'),
          vat: null,
          gross: czk('-1.95'),
          categoryCode: 'exp_office_supplies',
        }),
        line({
          position: 3,
          lineType: 'rounding',
          net: czk('0.05'),
          vat: null,
          gross: czk('0.05'),
          categoryCode: 'exp_office_supplies',
        }),
        line({
          position: 4,
          lineType: 'text',
          net: null,
          vat: null,
          gross: null,
          categoryCode: null,
        }),
      ],
    });
    const es = build({ doc: alza });
    expect(brief(es)).toEqual([
      ['l1', 'provisional', '2026-09-18', '118.90'],
      ['l2', 'provisional', '2026-09-18', '-1.95'],
      ['l3', 'provisional', '2026-09-18', '0.05'],
    ]);
    expect(total(es)).toBe('117.00');
  });

  it('AC-9g: platform statement — income gross, fees as positive expenses, tourist fee pass-through; covered commission skipped', () => {
    const stmt = doc({
      class: 'platform_statement',
      paidAt: d('2026-08-05'),
      lines: [
        line({
          position: 1,
          net: czk('5000.00'),
          vat: null,
          gross: czk('5000.00'),
          categoryCode: 'income_accommodation',
        }),
        line({
          position: 2,
          lineType: 'fee',
          net: czk('-750.00'),
          vat: null,
          gross: czk('-750.00'),
          categoryCode: 'exp_platform_commission',
        }),
        line({
          position: 3,
          lineType: 'fee',
          net: czk('-60.00'),
          vat: null,
          gross: czk('-60.00'),
          categoryCode: 'exp_payment_fees',
        }),
        line({
          position: 4,
          net: czk('250.00'),
          vat: null,
          gross: czk('250.00'),
          categoryCode: 'pt_tourist_fee',
        }),
      ],
    });
    const es = build({ doc: stmt });
    expect(brief(es)).toEqual([
      ['l1', 'document_evidence', '2026-08-05', '5000.00'],
      ['l2', 'document_evidence', '2026-08-05', '750.00'],
      ['l3', 'document_evidence', '2026-08-05', '60.00'],
      ['l4', 'document_evidence', '2026-08-05', '250.00'],
    ]);
    expect(es.map((e) => e.taxEffect)).toEqual([
      'taxable_income',
      'deductible_expense',
      'deductible_expense',
      'pass_through',
    ]);
    const income = Money.sum(
      es.filter((e) => e.taxEffect === 'taxable_income').map((e) => e.amountCzk),
      'CZK',
    );
    const expenses = Money.sum(
      es.filter((e) => e.taxEffect === 'deductible_expense').map((e) => e.amountCzk),
      'CZK',
    );
    expect([income.toFixed2(), expenses.toFixed2()]).toEqual(['5000.00', '810.00']);
    const covered = build({
      doc: {
        ...stmt,
        lines: stmt.lines.map((l) =>
          l.position === 2 ? { ...l, coveredByDocumentId: 'inv-booking' } : l,
        ),
      },
    });
    expect(brief(covered).map((b) => b[0])).toEqual(['l1', 'l3', 'l4']);
    expect(total(covered)).toBe('5310.00');
  });

  it('invoice + full credit note (refund link) nets to zero per category', () => {
    const inv = build({
      doc: doc({
        documentId: 'inv',
        lines: [
          line({
            net: czk('1000.00'),
            vat: czk('210.00'),
            gross: czk('1210.00'),
            categoryCode: 'exp_services_general',
          }),
        ],
      }),
      payments: [pay({ amountDoc: czk('1210.00'), amountAccount: czk('1210.00') })],
    });
    const cn = build({
      doc: doc({
        documentId: 'cn',
        class: 'received_credit_note',
        lines: [
          line({
            net: czk('-1000.00'),
            vat: czk('-210.00'),
            gross: czk('-1210.00'),
            categoryCode: 'exp_services_general',
          }),
        ],
      }),
      payments: [
        pay({
          paymentLinkId: 'pl-2',
          linkType: 'refund',
          amountDoc: czk('1210.00'),
          amountAccount: czk('1210.00'),
          bookedOn: d('2026-09-20'),
        }),
      ],
    });
    expect(brief(inv)).toEqual([['l1', 'payment', '2026-09-10', '1210.00']]);
    expect(brief(cn)).toEqual([['l1', 'payment', '2026-09-20', '-1210.00']]);
    expect(total([...inv, ...cn])).toBe('0.00');
  });
});

describe('foreign currency', () => {
  const cloudflare = doc({
    documentId: 'cf',
    currency: 'USD',
    issueDate: d('2026-10-03'),
    dueDate: null,
    lines: [
      line({
        net: Money.parse('10.46', 'USD'),
        vat: Money.parse('0.00', 'USD'),
        gross: Money.parse('10.46', 'USD'),
        categoryCode: 'exp_hosting_domains',
      }),
    ],
  });

  it('document evidence on a Saturday converts with Friday’s ČNB rate (AC-9e amounts)', () => {
    const es = build({ doc: { ...cloudflare, isPaidPerDocument: true, paidAt: d('2026-10-03') } });
    expect(brief(es)).toEqual([['l1', 'document_evidence', '2026-10-03', '245.35']]);
  });

  it('a payment link in CZK uses the account amount; in another currency the ČNB rate on booked_on', () => {
    const czkCard = build({
      doc: cloudflare,
      payments: [
        pay({
          bookedOn: d('2026-10-05'),
          amountDoc: Money.parse('10.46', 'USD'),
          amountAccount: czk('245.40'),
        }),
      ],
    });
    expect(brief(czkCard)).toEqual([['l1', 'payment', '2026-10-05', '245.40']]);
    const eurCard = build({
      doc: cloudflare,
      payments: [
        pay({
          bookedOn: d('2026-10-05'),
          amountDoc: Money.parse('10.46', 'USD'),
          amountAccount: Money.parse('9.00', 'EUR'),
        }),
      ],
    });
    expect(brief(eurCard)).toEqual([['l1', 'payment', '2026-10-05', '221.22']]);
  });

  it('no ČNB rate within the look-back → no entries (M03 keeps the document off ready)', () => {
    expect(
      build({ doc: { ...cloudflare, isPaidPerDocument: true, paidAt: d('2026-09-01') } }),
    ).toEqual([]);
    expect(
      build({
        doc: cloudflare,
        payments: [pay({ bookedOn: d('2026-09-01'), amountAccount: Money.parse('9.00', 'EUR') })],
      }),
    ).toEqual([]);
  });
});

describe('qualification and skips', () => {
  it('decoys and duplicates produce no entries (AC-9l)', () => {
    expect(build({ doc: doc({ status: 'duplicate' }), payments: [pay()] })).toEqual([]);
    expect(build({ doc: doc({ status: 'needs_review' }), payments: [pay()] })).toEqual([]);
    expect(build({ doc: doc({ class: 'other_supporting' }), payments: [pay()] })).toEqual([]);
    expect(build({ doc: doc({ class: 'settlement_statement' }), payments: [pay()] })).toEqual([]);
    expect(build({ doc: doc({ deleted: true }), payments: [pay()] })).toEqual([]);
    expect(build({ doc: doc({ status: 'finalized' }), payments: [pay()] })).toHaveLength(1);
  });

  it('fx_difference links are ignored; a line without category throws', () => {
    expect(
      brief(
        build({
          payments: [
            pay(),
            pay({
              paymentLinkId: 'pl-9',
              linkType: 'fx_difference',
              amountDoc: czk('0.00'),
              amountAccount: czk('3.00'),
            }),
          ],
        }),
      ),
    ).toEqual([['l1', 'payment', '2026-09-10', '12960.84']]);
    expect(() => build({ doc: doc({ lines: [line({ categoryCode: null })] }) })).toThrow(
      LedgerInputError,
    );
  });

  it('a document whose weights sum to zero produces no entries', () => {
    expect(
      build({
        doc: doc({ lines: [line({ gross: czk('0.00'), net: czk('0.00'), vat: czk('0.00') })] }),
      }),
    ).toEqual([]);
  });
});
