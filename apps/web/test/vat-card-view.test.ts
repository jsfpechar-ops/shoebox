import { describe, expect, it } from 'vitest';
import { groupCards, vatCardView } from '../src/vat/card-view';
import type { CardKind, PeriodCard } from '../src/vat/periods';

function card(kind: CardKind, over: Partial<PeriodCard> = {}): PeriodCard {
  return {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    form: 'DPHDP3',
    kind,
    filingId: 'f1',
    bundleId: null,
    amountDue: null,
    dueDate: '2026-10-25',
    obligationState: null,
    reasons: [],
    filedOn: null,
    proposal: null,
    ...over,
  };
}

const kinds = (v: ReturnType<typeof vatCardView>) => v.actions.map((a) => a.kind);

describe('vatCardView', () => {
  it('ready: download, mark filed, amount', () => {
    const v = vatCardView([card('ready', { amountDue: '2877' })]);
    expect(v.tone).toBe('ready');
    expect(kinds(v)).toEqual(['open', 'download', 'mark_filed']);
    expect(v.title).toContain('September 2026');
    expect(v.due).toContain('25. 10.');
    expect(v.body).toMatch(/2\s877/);
  });
  it('ready without amount', () => {
    const v = vatCardView([card('ready')]);
    expect(v.body).not.toMatch(/pay/);
  });
  it('two-card ready group downloads the zip', () => {
    const v = vatCardView([card('ready'), card('ready', { form: 'DPHKH1' })]);
    const dl = v.actions.find((a) => a.kind === 'download');
    expect(dl).toMatchObject({ label: 'zip' });
  });
  it('draft_unvalidated', () => {
    const v = vatCardView([card('draft_unvalidated')]);
    expect(v.tone).toBe('todo');
    expect(kinds(v)).toEqual(['open']);
  });
  it('not_ready lists reasons, unknown code is generic', () => {
    const v = vatCardView([card('not_ready', { reasons: ['S_FX_MISSING', 'S_NOPE'] })]);
    expect(v.tone).toBe('todo');
    expect(v.reasons).toHaveLength(2);
    expect(v.reasons[0]).toContain('exchange rate');
    expect(v.reasons[1]).toBe('Something in this month needs a check.');
  });
  it('needs_accountant offers the workbook', () => {
    const v = vatCardView([card('needs_accountant')]);
    expect(v.tone).toBe('warn');
    expect(kinds(v)).toEqual(['open', 'workbook']);
  });
  it('filed', () => {
    const v = vatCardView([card('filed', { filedOn: '2026-10-05' })]);
    expect(v.tone).toBe('done');
    expect(v.body).toContain('5. 10. 2026');
  });
  it('imported_matches', () => {
    expect(vatCardView([card('imported_matches')]).tone).toBe('done');
  });
  it('amendment_needed prepares the proposed kind', () => {
    const v = vatCardView([
      card('amendment_needed', { proposal: { kind: 'dodatecne', dueDate: '2026-11-25' } }),
    ]);
    expect(v.tone).toBe('warn');
    expect(v.actions[1]).toEqual({
      kind: 'prepare',
      periodStart: '2026-09-01',
      filingKind: 'dodatecne',
    });
    const fallback = vatCardView([
      card('amendment_needed', { proposal: { kind: 'x', dueDate: '2026-11-25' } }),
    ]);
    expect(fallback.actions[1]).toMatchObject({ filingKind: 'opravne' });
  });
  it('overdue_missing prepares radne', () => {
    const v = vatCardView([card('overdue_missing')]);
    expect(v.actions[1]).toMatchObject({ kind: 'prepare', filingKind: 'radne' });
  });
  it('a not_ready sibling beats a ready main card', () => {
    const v = vatCardView([card('ready'), card('not_ready', { form: 'DPHKH1' })]);
    expect(v.tone).toBe('todo');
  });
});

describe('groupCards', () => {
  it('groups newest first with form order', () => {
    const groups = groupCards([
      card('ready', { form: 'DPHKH1' }),
      card('ready', { periodStart: '2026-10-01' }),
      card('ready'),
    ]);
    expect(groups.map((g) => g[0]?.periodStart)).toEqual(['2026-10-01', '2026-09-01']);
    expect(groups[1]?.map((c) => c.form)).toEqual(['DPHDP3', 'DPHKH1']);
  });
});
