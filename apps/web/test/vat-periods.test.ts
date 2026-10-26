import { describe, expect, it } from 'vitest';
import {
  buildPeriodCards,
  type CardInputs,
  parseForm,
  parseGenerateBody,
  parsePeriodStart,
  parseYear,
} from '../src/vat/periods';

const F = (o: Partial<CardInputs['filings'][number]>): CardInputs['filings'][number] => ({
  id: 'f',
  type: 'DPHDP3',
  kind: 'radne',
  origin: 'generated',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  state: 'generated',
  bundleId: 'b',
  xsdValid: true,
  totals: { row64: 2877, ledgerHash: 'h' },
  simpleCheck: { verdict: 'simple', checks: [] },
  filedOn: null,
  amendsFilingId: null,
  discoveredOn: null,
  ...o,
});
const base: CardInputs = {
  status: 'identifikovana_osoba',
  today: '2026-09-21',
  filings: [],
  obligations: [
    {
      kind: 'vat_return',
      periodStart: '2026-08-01',
      dueDate: '2026-09-25',
      state: 'open',
      amountEstimate: '2877.00',
    },
  ],
  periodsWithEntries: ['2026-08-01'],
};

describe('buildPeriodCards (M09 §4.9)', () => {
  it('ready card with amount and due date', () => {
    expect(buildPeriodCards({ ...base, filings: [F({})] })).toEqual([
      {
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        form: 'DPHDP3',
        kind: 'ready',
        filingId: 'f',
        bundleId: 'b',
        amountDue: '2877',
        dueDate: '2026-09-25',
        obligationState: 'open',
        reasons: [],
        filedOn: null,
        proposal: null,
      },
    ]);
  });
  it('not_ready lists reasons; needs_accountant; unvalidated draft', () => {
    const nr = F({
      state: 'draft',
      xsdValid: null,
      simpleCheck: {
        verdict: 'not_ready',
        checks: [
          { code: 'S_PENDING_DOCUMENTS', outcome: 'not_ready' },
          { code: 'S_FX_MISSING', outcome: 'pass' },
        ],
      },
    });
    expect(buildPeriodCards({ ...base, filings: [nr] })[0]).toMatchObject({
      kind: 'not_ready',
      reasons: ['S_PENDING_DOCUMENTS'],
    });
    expect(
      buildPeriodCards({
        ...base,
        filings: [
          F({
            state: 'draft',
            xsdValid: null,
            simpleCheck: { verdict: 'needs_accountant', checks: [] },
          }),
        ],
      })[0]?.kind,
    ).toBe('needs_accountant');
    expect(buildPeriodCards({ ...base, filings: [F({ xsdValid: null })] })[0]?.kind).toBe(
      'draft_unvalidated',
    );
  });
  it('filed, imported match, amendment proposal, superseded hidden, workbook hidden', () => {
    const filings = [
      F({ id: 'old', state: 'superseded' }),
      F({ id: 'filed', state: 'marked_filed', filedOn: '2026-09-20' }),
      F({
        id: 'imp',
        origin: 'imported',
        state: 'marked_filed',
        filedOn: '2026-09-20',
        totals: { matchesFiled: true },
      }),
      F({
        id: 'am',
        state: 'draft',
        kind: 'opravne',
        amendsFilingId: 'filed',
        xsdValid: null,
        totals: { proposal: { kind: 'opravne', dueDate: '2026-09-25' } },
      }),
      F({ id: 'wb', type: 'VAT_WORKBOOK' }),
    ];
    const kinds = buildPeriodCards({ ...base, filings }).map((c) => [c.filingId, c.kind]);
    expect(kinds).toEqual([
      ['filed', 'filed'],
      ['imp', 'imported_matches'],
      ['am', 'amendment_needed'],
    ]);
    expect(
      buildPeriodCards({ ...base, filings }).find((c) => c.kind === 'amendment_needed')?.proposal,
    ).toEqual({ kind: 'opravne', dueDate: '2026-09-25' });
  });
  it('overdue period without a filing gets a card; ordering newest first, DP3 before KH', () => {
    const cards = buildPeriodCards({
      ...base,
      status: 'platce',
      today: '2026-10-30',
      periodsWithEntries: ['2026-08-01', '2026-09-01'],
      filings: [
        F({ id: 'kh', type: 'DPHKH1', periodStart: '2026-09-01', periodEnd: '2026-09-30' }),
        F({ id: 'dp', periodStart: '2026-09-01', periodEnd: '2026-09-30' }),
      ],
      obligations: [
        {
          kind: 'vat_return',
          periodStart: '2026-08-01',
          dueDate: '2026-09-25',
          state: 'overdue',
          amountEstimate: null,
        },
      ],
    });
    expect(cards.map((c) => [c.periodStart, c.form, c.kind])).toEqual([
      ['2026-09-01', 'DPHDP3', 'ready'],
      ['2026-09-01', 'DPHKH1', 'ready'],
      ['2026-08-01', 'DPHDP3', 'overdue_missing'],
    ]);
  });
  it('parsers', () => {
    expect(parseYear(null, '2026-09-21')).toBe(2026);
    expect(parseYear('2025', '2026-09-21')).toBe(2025);
    expect(parseYear('x', '2026-09-21')).toBeNull();
    expect(parsePeriodStart('2026-08-01')).toBe('2026-08-01');
    expect(parsePeriodStart('2026-08-02')).toBeNull();
    expect(parsePeriodStart('2026-07-01')).toBe('2026-07-01');
    expect(parseGenerateBody({ kind: 'radne' })).toEqual({ kind: 'radne' });
    expect(parseGenerateBody({ kind: 'dodatecne', discoveredOn: '2026-11-10' })).toEqual({
      kind: 'dodatecne',
      discoveredOn: '2026-11-10',
    });
    expect(parseGenerateBody({ kind: 'x' })).toBeNull();
    expect(parseForm('DPHKH1')).toBe('DPHKH1');
    expect(parseForm(null)).toBe('DPHDP3');
    expect(parseForm('nope')).toBeNull();
  });
});
