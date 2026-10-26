import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import {
  INCOME_TAX_OBLIGATION_SOURCE,
  type IncomeTaxObligationsInput,
  incomeTaxObligationsFor,
} from '../src/income-tax/obligations';
import type { ProfileSegment } from '../src/income-tax/readiness';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const seg = (o: Partial<ProfileSegment> = {}): ProfileSegment => ({
  validFrom: d('2025-01-01'),
  validTo: null,
  entityType: 'osvc',
  taxRegime: 'danova_evidence',
  vatStatus: 'neplatce',
  pausalRate: null,
  pausalDanBand: null,
  hasAccountant: false,
  ...o,
});
const input = (o: Partial<IncomeTaxObligationsInput> = {}): IncomeTaxObligationsInput => ({
  year: 2026,
  profiles: [seg()],
  advances: [],
  pausalniDanReturnRequired: false,
  eligibleForEntry: false,
  ...o,
});
const pd = seg({
  taxRegime: 'pausalni_dan',
  pausalRate: 60,
  pausalDanBand: 1,
  vatStatus: 'identifikovana_osoba',
});

describe('incomeTaxObligationsFor (M06 §4.12, §9 general 8)', () => {
  it('dap for 2026: legal 1. 5. 2027, due Monday 3. 5. 2027; advisor note with an accountant', () => {
    const [dap] = incomeTaxObligationsFor(input(), d('2027-02-01'), rules);
    expect(dap).toEqual({
      kind: 'dap',
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      legalDueDate: '2027-05-01',
      dueDate: '2027-05-03',
      amountEstimate: null,
      state: 'open',
      doneSource: null,
      isOptional: false,
      note: 'podklady.dap.note.standard',
      sourceRule: INCOME_TAX_OBLIGATION_SOURCE,
    });
    expect(
      incomeTaxObligationsFor(
        input({ profiles: [seg({ hasAccountant: true })] }),
        d('2027-02-01'),
        rules,
      )[0]?.note,
    ).toBe('podklady.dap.note.advisor');
    expect(incomeTaxObligationsFor(input(), d('2027-05-04'), rules)[0]?.state).toBe('overdue');
  });
  it('paušální daň: no dap unless a return is required; 12 advances; October due 20. 10. 2026 with 9 162', () => {
    const none = incomeTaxObligationsFor(input({ profiles: [pd] }), d('2026-10-10'), rules);
    expect(none.filter((o) => o.kind === 'dap')).toEqual([]);
    const adv = none.filter((o) => o.kind === 'pausalni_dan_advance');
    expect(adv).toHaveLength(12);
    expect(adv[9]).toMatchObject({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      legalDueDate: '2026-10-20',
      dueDate: '2026-10-20',
      amountEstimate: czk('9162.00'),
      state: 'open',
      isOptional: false,
    });
    expect(adv[0]?.state).toBe('overdue');
    const withReturn = incomeTaxObligationsFor(
      input({ profiles: [pd], pausalniDanReturnRequired: true }),
      d('2026-10-10'),
      rules,
    );
    expect(withReturn[0]?.kind).toBe('dap');
  });
  it('an advance booked between the 1st and due + 10 days marks the month done; outside the window it does not', () => {
    const list = incomeTaxObligationsFor(
      input({
        profiles: [pd],
        advances: [
          { bookedOn: d('2026-10-15'), amount: czk('9162.00') },
          { bookedOn: d('2026-09-05'), amount: czk('9000.00') },
          { bookedOn: d('2026-08-28'), amount: czk('9162.00') },
        ],
      }),
      d('2026-11-05'),
      rules,
    );
    const byMonth = Object.fromEntries(
      list
        .filter((o) => o.kind === 'pausalni_dan_advance')
        .map((o) => [o.periodStart, [o.state, o.doneSource]]),
    );
    expect(byMonth['2026-10-01']).toEqual(['done', 'bank_payment']);
    expect(byMonth['2026-09-01']).toEqual(['overdue', null]); // 9 000 < 9 162
    expect(byMonth['2026-08-01']).toEqual(['done', 'bank_payment']);
    expect(byMonth['2026-11-01']).toEqual(['open', null]);
  });
  it('a paušál segment from July only produces July–December advances', () => {
    const list = incomeTaxObligationsFor(
      input({
        profiles: [seg({ validTo: d('2026-06-30') }), { ...pd, validFrom: d('2026-07-01') }],
      }),
      d('2026-12-01'),
      rules,
    );
    expect(
      list.filter((o) => o.kind === 'pausalni_dan_advance').map((o) => o.periodStart.slice(5, 7)),
    ).toEqual(['07', '08', '09', '10', '11', '12']);
  });
  it('exit notice for paušál users and entry notice for eligible others: optional, due 11. 1. 2027, only from 1 December until the date', () => {
    const exit = incomeTaxObligationsFor(input({ profiles: [pd] }), d('2026-12-05'), rules).find(
      (o) => o.kind === 'pausalni_dan_exit',
    );
    expect(exit).toEqual({
      kind: 'pausalni_dan_exit',
      periodStart: '2027-01-01',
      periodEnd: '2027-12-31',
      legalDueDate: '2027-01-10',
      dueDate: '2027-01-11',
      amountEstimate: null,
      state: 'open',
      doneSource: null,
      isOptional: true,
      note: null,
      sourceRule: INCOME_TAX_OBLIGATION_SOURCE,
    });
    expect(
      incomeTaxObligationsFor(input({ profiles: [pd] }), d('2026-11-30'), rules).some(
        (o) => o.kind === 'pausalni_dan_exit',
      ),
    ).toBe(false);
    expect(
      incomeTaxObligationsFor(input({ profiles: [pd] }), d('2027-01-12'), rules).some(
        (o) => o.kind === 'pausalni_dan_exit',
      ),
    ).toBe(false);
    const entry = incomeTaxObligationsFor(
      input({ eligibleForEntry: true }),
      d('2027-01-11'),
      rules,
    ).find((o) => o.kind === 'pausalni_dan_entry');
    expect(entry).toMatchObject({
      kind: 'pausalni_dan_entry',
      dueDate: '2027-01-11',
      isOptional: true,
      state: 'open',
    });
    expect(
      incomeTaxObligationsFor(input({ eligibleForEntry: false }), d('2026-12-05'), rules).some(
        (o) => o.kind === 'pausalni_dan_entry',
      ),
    ).toBe(false);
  });
});
