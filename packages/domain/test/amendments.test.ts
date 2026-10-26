import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { createCzRules } from '../src/rules/index';
import {
  chooseAmendmentKind,
  diffFilings,
  type FilingSnapshot,
  isEmptyDiff,
} from '../src/vat/amend';

const rules = createCzRules();
const d = parseLegalDate;
const base = (o: Partial<FilingSnapshot> = {}): FilingSnapshot => ({
  type: 'DPHDP3',
  kind: 'radne',
  periodStart: d('2026-09-01'),
  periodEnd: d('2026-09-30'),
  rows: { '5': { base: 11550, tax: 2425 }, '62': { tax: 2425 }, '64': { tax: 2425 } },
  documents: { b: 1 },
  kh: {},
  shv: {},
  ...o,
});

describe('diffFilings (M05 §9 #12)', () => {
  it('empty diff for identical snapshots', () => {
    expect(isEmptyDiff(diffFilings(base(), base()))).toBe(true);
  });
  it('reports rows, documents and KH changes', () => {
    const next = base({
      rows: {
        '5': { base: 11550, tax: 2425 },
        '12': { base: 245, tax: 52 },
        '62': { tax: 2477 },
        '64': { tax: 2477 },
      },
      documents: { b: 2, c: 1 },
      kh: { 'A2:NL805734958B01:1637922054:2026-09-03': '11549.94|2425.49|0.00|0.00' },
    });
    const filed = base({
      documents: { b: 1, x: 3 },
      kh: {
        'A2:NL805734958B01:1637922054:2026-09-03': '11549.94|2425.49|0.00|0.00',
        A5: '1.00|0.21|0.00|0.00',
      },
    });
    const diff = diffFilings(filed, next);
    expect(diff.rows).toEqual([
      { row: '12', attr: 'base', filed: 0, now: 245, delta: 245 },
      { row: '12', attr: 'tax', filed: 0, now: 52, delta: 52 },
      { row: '62', attr: 'tax', filed: 2425, now: 2477, delta: 52 },
      { row: '64', attr: 'tax', filed: 2425, now: 2477, delta: 52 },
    ]);
    expect(diff.documents).toEqual({
      added: ['c'],
      removed: ['x'],
      changed: [{ documentId: 'b', fromRevision: 1, toRevision: 2 }],
    });
    expect(diff.kh).toEqual({ added: [], removed: ['A5'], changed: [] });
    expect(isEmptyDiff(diff)).toBe(false);
  });
});

describe('chooseAmendmentKind (TA-10 defaults)', () => {
  const next = base({
    rows: {
      '5': { base: 11550, tax: 2425 },
      '12': { base: 245, tax: 52 },
      '62': { tax: 2477 },
      '64': { tax: 2477 },
    },
  });
  it('DPHDP3 before the deadline → opravne due on the original date', () => {
    expect(chooseAmendmentKind(base(), next, d('2026-10-20'), rules)).toEqual({
      kind: 'opravne',
      dueDate: '2026-10-26',
      discoveredOn: null,
    });
    expect(chooseAmendmentKind(base(), next, d('2026-10-26'), rules)).toMatchObject({
      kind: 'opravne',
    });
  });
  it('DPHDP3 after the deadline → dodatecne with d_zjist, ř.66 = 52, due end of next month', () => {
    expect(chooseAmendmentKind(base(), next, d('2026-11-10'), rules)).toEqual({
      kind: 'dodatecne',
      dueDate: '2026-12-31',
      discoveredOn: '2026-11-10',
      row66: 52,
    });
  });
  it('KH after the deadline → nasledne due 5 working days later (17 Nov holiday skipped)', () => {
    expect(chooseAmendmentKind(base({ type: 'DPHKH1' }), null, d('2026-11-10'), rules)).toEqual({
      kind: 'nasledne',
      dueDate: '2026-11-18',
      discoveredOn: '2026-11-10',
    });
    expect(
      chooseAmendmentKind(base({ type: 'DPHKH1' }), null, d('2026-10-01'), rules),
    ).toMatchObject({ kind: 'opravne', dueDate: '2026-10-26' });
  });
  it('SH: radne before, nasledne after; dodatecne of a dodatecne → needs_accountant', () => {
    expect(
      chooseAmendmentKind(base({ type: 'DPHSHV' }), null, d('2026-10-01'), rules),
    ).toMatchObject({ kind: 'radne' });
    expect(
      chooseAmendmentKind(base({ type: 'DPHSHV' }), null, d('2026-11-01'), rules),
    ).toMatchObject({ kind: 'nasledne', discoveredOn: '2026-11-01' });
    expect(chooseAmendmentKind(base({ kind: 'dodatecne' }), next, d('2026-12-01'), rules)).toEqual({
      kind: 'needs_accountant',
      reason: 'amend_of_dodatecne',
    });
  });
});
