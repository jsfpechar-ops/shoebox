# 0347: `diffFilings` and `chooseAmendmentKind`

Status: todo
Ticket: P3-VAT-10 (part a) | Depends on: 0330, 0333 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 50k tokens

## 1. Objective

Pure amendment logic: diff a filed snapshot against a recomputed one, and propose `opravne`, `dodatecne` or `nasledne` with its due date from rule data (TA-10 defaults).

## 2. Context

M05 §4.11 amendment detection (pasted):
```ts
type FilingDiff = { rows: Array<{row: string; attr: string; filed: number; now: number; delta: number}>;
  documents: { added: string[]; removed: string[]; changed: Array<{documentId: string; fromRevision: number; toRevision: number}> };
  kh: { added: KhRowKey[]; removed: KhRowKey[]; changed: KhRowKey[] }; shv: { changed: ShvKey[] } }
```
| Filed form | today ≤ original deadline | today > original deadline |
|---|---|---|
| DPHDP3 | `opravne` (`O`), full corrected values, replaces the original | `dodatecne` (`D`), full values + `d_zjist`; ř. 66 (`dano`) = new (ř.64 − ř.65) − filed (ř.64 − ř.65) **[verify sign]**; due end of the month after `d_zjist` (`vat.amendment_windows.dp3_dodatecne_due = 'end_of_month_after_discovery'`) |
| DPHKH1 | `opravne` (`O`) | `nasledne` (`N`), full content, `d_zjist`; due `kh_nasledne_working_days` (5) working days after discovery |
| DPHSHV | `radne` regenerated (replace) **[verify]** | `nasledne` (`N`): storno row + new row **[verify]** |

Amending a filing that is itself `dodatecne` → `needs_accountant` (form `E` not supported). `TODO(TA-10)` on every default. Original deadline = `vatDueDate(periodEnd, rules).due` (0330). Working days: `isCzWorkingDay` (`../overview/deadlines`). Rules at `today`. Hand-checked: September 2026 monthly → due 2026-10-26; today 2026-11-10 (Tuesday): dodatečné due = 2026-12-31; KH následné due = 5 working days after → 11, 12, 13, 16 Nov, 17 Nov is a public holiday, → **2026-11-18**.

Snapshot keys: `KhRowKey` = `'<section>:<dic|vatid>:<c_evid_dd>:<dppd>'` (A5/B3: `'A5'`/`'B3'`), value compared = `zakl_dane1|dan1|zakl_dane2|dan2` as `toFixed2()` strings; `ShvKey` = `'<k_stat>:<c_vat>:<k_pln_eu>'`, value = `pln_hodnota`. `rows` compares every row key present on either side for `base` and `tax` (missing = 0; whole-Kč numbers), including `'62'…'65'` carried as rows with `tax` only.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/amend.ts` | create | types + 3 functions |
| `packages/domain/test/amendments.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append export |

## 4. Steps

1. `amend.ts` exports exactly:
```ts
export type KhRowKey = string; export type ShvKey = string;
export interface FilingSnapshot { readonly type: 'DPHDP3' | 'DPHKH1' | 'DPHSHV'; readonly kind: FilingKind; readonly periodStart: LegalDate; readonly periodEnd: LegalDate; readonly rows: Readonly<Record<string, { readonly base?: number; readonly tax?: number }>>; readonly documents: Readonly<Record<string, number>>; readonly kh: Readonly<Record<KhRowKey, string>>; readonly shv: Readonly<Record<ShvKey, string>> }
export interface FilingDiff { readonly rows: Array<{ row: string; attr: 'base' | 'tax'; filed: number; now: number; delta: number }>; readonly documents: { added: string[]; removed: string[]; changed: Array<{ documentId: string; fromRevision: number; toRevision: number }> }; readonly kh: { added: KhRowKey[]; removed: KhRowKey[]; changed: KhRowKey[] }; readonly shv: { changed: ShvKey[] } }
export function diffFilings(filed: FilingSnapshot, next: FilingSnapshot): FilingDiff;   // arrays sorted; rows by numeric row then attr
export function isEmptyDiff(d: FilingDiff): boolean;
export function snapshotOfDphdp3(c: Dphdp3Computation, documents: Readonly<Record<string, number>>, meta: Pick<FilingSnapshot, 'kind' | 'periodStart' | 'periodEnd'>): FilingSnapshot;   // rows: c.rows (numbers) + '62'..'65' tax
export function snapshotOfKh(kh: KhComputation, documents: Readonly<Record<string, number>>, meta: Pick<FilingSnapshot, 'kind' | 'periodStart' | 'periodEnd'>): FilingSnapshot;
export function snapshotOfShv(sh: ShvComputation, documents: Readonly<Record<string, number>>, meta: Pick<FilingSnapshot, 'kind' | 'periodStart' | 'periodEnd'>): FilingSnapshot;
export type AmendmentProposal = { readonly kind: FilingKind; readonly dueDate: LegalDate; readonly discoveredOn: LegalDate | null; readonly row66?: number } | { readonly kind: 'needs_accountant'; readonly reason: 'amend_of_dodatecne' };
export function chooseAmendmentKind(filed: FilingSnapshot, next: FilingSnapshot | null, today: LegalDate, rules: CzRules): AmendmentProposal;   // row66 only for DPHDP3 dodatecne: (next 64 − 65) − (filed 64 − 65)
```
2. Test verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { createCzRules } from '../src/rules/index';
import { chooseAmendmentKind, diffFilings, type FilingSnapshot, isEmptyDiff } from '../src/vat/amend';

const rules = createCzRules();
const d = parseLegalDate;
const base = (o: Partial<FilingSnapshot> = {}): FilingSnapshot => ({ type: 'DPHDP3', kind: 'radne', periodStart: d('2026-09-01'), periodEnd: d('2026-09-30'), rows: { '5': { base: 11550, tax: 2425 }, '62': { tax: 2425 }, '64': { tax: 2425 } }, documents: { b: 1 }, kh: {}, shv: {}, ...o });

describe('diffFilings (M05 §9 #12)', () => {
  it('empty diff for identical snapshots', () => {
    expect(isEmptyDiff(diffFilings(base(), base()))).toBe(true);
  });
  it('reports rows, documents and KH changes', () => {
    const next = base({ rows: { '5': { base: 11550, tax: 2425 }, '12': { base: 245, tax: 52 }, '62': { tax: 2477 }, '64': { tax: 2477 } }, documents: { b: 2, c: 1 }, kh: { 'A2:NL805734958B01:1637922054:2026-09-03': '11549.94|2425.49|0.00|0.00' } });
    const filed = base({ documents: { b: 1, x: 3 }, kh: { 'A2:NL805734958B01:1637922054:2026-09-03': '11549.94|2425.49|0.00|0.00', 'A5': '1.00|0.21|0.00|0.00' } });
    const diff = diffFilings(filed, next);
    expect(diff.rows).toEqual([
      { row: '12', attr: 'base', filed: 0, now: 245, delta: 245 }, { row: '12', attr: 'tax', filed: 0, now: 52, delta: 52 },
      { row: '62', attr: 'tax', filed: 2425, now: 2477, delta: 52 }, { row: '64', attr: 'tax', filed: 2425, now: 2477, delta: 52 },
    ]);
    expect(diff.documents).toEqual({ added: ['c'], removed: ['x'], changed: [{ documentId: 'b', fromRevision: 1, toRevision: 2 }] });
    expect(diff.kh).toEqual({ added: [], removed: ['A5'], changed: [] });
    expect(isEmptyDiff(diff)).toBe(false);
  });
});

describe('chooseAmendmentKind (TA-10 defaults)', () => {
  const next = base({ rows: { '5': { base: 11550, tax: 2425 }, '12': { base: 245, tax: 52 }, '62': { tax: 2477 }, '64': { tax: 2477 } } });
  it('DPHDP3 before the deadline → opravne due on the original date', () => {
    expect(chooseAmendmentKind(base(), next, d('2026-10-20'), rules)).toEqual({ kind: 'opravne', dueDate: '2026-10-26', discoveredOn: null });
    expect(chooseAmendmentKind(base(), next, d('2026-10-26'), rules)).toMatchObject({ kind: 'opravne' });
  });
  it('DPHDP3 after the deadline → dodatecne with d_zjist, ř.66 = 52, due end of next month', () => {
    expect(chooseAmendmentKind(base(), next, d('2026-11-10'), rules)).toEqual({ kind: 'dodatecne', dueDate: '2026-12-31', discoveredOn: '2026-11-10', row66: 52 });
  });
  it('KH after the deadline → nasledne due 5 working days later (17 Nov holiday skipped)', () => {
    expect(chooseAmendmentKind(base({ type: 'DPHKH1' }), null, d('2026-11-10'), rules)).toEqual({ kind: 'nasledne', dueDate: '2026-11-18', discoveredOn: '2026-11-10' });
    expect(chooseAmendmentKind(base({ type: 'DPHKH1' }), null, d('2026-10-01'), rules)).toMatchObject({ kind: 'opravne', dueDate: '2026-10-26' });
  });
  it('SH: radne before, nasledne after; dodatecne of a dodatecne → needs_accountant', () => {
    expect(chooseAmendmentKind(base({ type: 'DPHSHV' }), null, d('2026-10-01'), rules)).toMatchObject({ kind: 'radne' });
    expect(chooseAmendmentKind(base({ type: 'DPHSHV' }), null, d('2026-11-01'), rules)).toMatchObject({ kind: 'nasledne', discoveredOn: '2026-11-01' });
    expect(chooseAmendmentKind(base({ kind: 'dodatecne' }), next, d('2026-12-01'), rules)).toEqual({ kind: 'needs_accountant', reason: 'amend_of_dodatecne' });
  });
});
```
Command: `pnpm --filter @shoebox/domain test -- amendments 2>&1 | tail -30`.
3. Index export; typecheck; commit `feat(domain): filing diff and amendment kind (0347)`.

## 5. Do not touch

Serializers (storno rows for SH `nasledne` are not emitted yet: `TODO(TA-10)` in the report).

## 6. Commands

`pnpm --filter @shoebox/domain test -- amendments 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Green; every default carries `TODO(TA-10)`; `[verify]` ř.66 sign recorded.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0347-report.md`.

## Risk list

`amend.ts` (deadlines).

## Owner steps

None.
