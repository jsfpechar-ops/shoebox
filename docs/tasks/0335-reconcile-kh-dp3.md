# 0335: `reconcileKhDp3` and the KH ↔ DPHDP3 property tests

Status: todo
Ticket: P3-VAT-05 (part b) | Depends on: 0334 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 55k tokens

## 1. Objective

A pure `reconcileKhDp3` that checks the cross-form invariants the tax office checks (M05 §9 P1–P6), and a fast-check suite over random simple payer periods proving P1–P8 for `computeDphdp3`/`computeKh`.

## 2. Context

M05 §9 property tests (pasted; generator = random simple payer periods: 0–60 documents of allowed treatments, both rates, CZK/EUR/USD, credit notes in-period, gross around 10 000):
- **P1** Věta C equals the DP3 values it mirrors (`obrat23`=ř.1 base, `obrat5`=ř.2 base, `pln23`=ř.40, `pln5`=ř.41, `celk_zd_a2`=Σ ř.3,4,5,6,12,13 base).
- **P2** `|VetaC.obrat23 − Σ(A4+A5).zakl_dane1| ≤ 0.50`; same for `obrat5` (A4+A5 `zakl_dane2`), `pln23` (B2+B3 `zakl_dane1`), `pln5` (B2+B3 `zakl_dane2`).
- **P3** `|celk_zd_a2 − Σ A2 (zakl_dane1+zakl_dane2)| ≤ 0.50 × k`, k = number of non-zero DP3 rows in {3,4,5,6,12,13}.
- **P4** Every entry with `khSection` appears in exactly one KH row or aggregate; Σ KH bases and taxes (2 dp) = Σ entry `baseCzk`, `vatCzk` exactly.
- **P5** ř.43 = ř.3+5+12 (base and tax), ř.44 = ř.4+6+13; ř.64 − ř.65 = ř.62 − ř.63; exactly one of ř.64/ř.65 non-zero (or both zero).
- **P6** IO: no Veta4 rows (40–46), no KH, ř.64 = ř.62.
- **P7** Permuting entry order → identical computation. **P8** Splitting a document's lines differently (same per-rate sums) → identical computation.

Since P2/P3 bound a rounding difference, with `sum_entries_then_round` the difference of one row is at most 0.50; with k rows feeding one KH figure it is ≤ 0.50 × k. P2's single-row bound holds because ř.1 = round0(Σ A4+A5 bases) exactly.

`fast-check` 4.10.2 is already a devDependency of `@shoebox/domain` (`test/allocate.test.ts` shows the import style: `import fc from 'fast-check'`).

Inputs available: `computeDphdp3` (0333), `computeKh` (0334), `VatLedgerEntryDraft`, `Money`. Entry amounts: generate integer haléře (`fc.integer`) and build `Money.parse((c / 100).toFixed(2), 'CZK')`; tax for a self-assessed/domestic entry = `vatForRate(base, '21')` or `'12'` (`../money/index`), so ledgers stay internally consistent.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/reconcile.ts` | create | `reconcileKhDp3` |
| `packages/domain/test/kh-dp3.property.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append `export * from './vat/reconcile';` |

## 4. Steps

1. `reconcile.ts` exports exactly:
```ts
export type ReconciliationCode = 'P1_VETAC_MISMATCH' | 'P2_OUTPUT_SUM' | 'P2_INPUT_SUM' | 'P3_A2_SUM' | 'P5_DERIVED_ROWS' | 'P5_RESULT_ROWS' | 'P6_IO_SHAPE';
export interface ReconciliationIssue { readonly code: ReconciliationCode; readonly detail: string }   // detail: short, numbers as toFixed2(); never document content
export interface ReconciliationResult { readonly ok: boolean; readonly issues: readonly ReconciliationIssue[] }
/** P1, P2, P3, P5 for a payer (kh given); P5, P6 for an IO (kh null). Pure, never throws on shape. */
export function reconcileKhDp3(dp3: Dphdp3Computation, kh: KhComputation | null): ReconciliationResult;
```
P6 for an IO: `kh` must be null, `rows` must not contain 40–46, `row64.equals(row62)`; otherwise `P6_IO_SHAPE`. For a payer with `kh === null` → `P1_VETAC_MISMATCH` with detail `'kh missing'`.
2. Test file verbatim:
```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money, vatForRate } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3, dphdp3Row } from '../src/vat/dphdp3';
import { computeKh, type KhAmounts } from '../src/vat/kh';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';
import { reconcileKhDp3 } from '../src/vat/reconcile';

const rules = createCzRules();
const d = parseLegalDate;
const START = d('2026-09-01');
const czk = (c: number) => Money.parse((c / 100).toFixed(2), 'CZK');
const ZERO = Money.zero('CZK');

type Kind = 'iss_domestic' | 'rcv_domestic' | 'eu_service' | 'non_eu_service' | 'eu_goods';
interface Doc { kind: Kind; rate: 'standard' | 'reduced'; parts: number[]; sign: 1 | -1; big: boolean; idx: number }

const KIND: Record<Kind, { treatment: VatLedgerEntryDraft['vatTreatment']; rows: (rate: 'standard' | 'reduced') => string[]; kh: (big: boolean) => VatLedgerEntryDraft['khSection'] }> = {
  iss_domestic: { treatment: 'iss_domestic_vat', rows: (r) => [r === 'standard' ? '1' : '2'], kh: (big) => (big ? 'A4' : 'A5') },
  rcv_domestic: { treatment: 'rcv_domestic_vat', rows: (r) => [r === 'standard' ? '40' : '41'], kh: (big) => (big ? 'B2' : 'B3') },
  eu_service: { treatment: 'rcv_eu_service_reverse_charge', rows: (r) => (r === 'standard' ? ['5', '43'] : ['6', '44']), kh: () => 'A2' },
  non_eu_service: { treatment: 'rcv_non_eu_service_reverse_charge', rows: (r) => (r === 'standard' ? ['12', '43'] : ['13', '44']), kh: () => 'A2' },
  eu_goods: { treatment: 'rcv_eu_goods_acquisition', rows: (r) => (r === 'standard' ? ['3', '43'] : ['4', '44']), kh: () => 'A2' },
};

/** One ledger entry per rate bucket per document, like buildVatLedgerEntries (one entry per (treatment, rate)). */
function entriesOf(doc: Doc, split: boolean): VatLedgerEntryDraft[] {
  const k = KIND[doc.kind];
  const parts = split ? doc.parts : [doc.parts.reduce((a, b) => a + b, 0)];
  return parts.map((cents, i) => {
    const base = czk(cents * doc.sign);
    return {
      periodStart: START, periodEnd: d('2026-09-30'), vatPointDate: d(`2026-09-${String(1 + (doc.idx % 28)).padStart(2, '0')}`), vatPointRule: 'duzp', lineId: null,
      documentId: `doc-${doc.idx}`, vatTreatment: k.treatment, vatRateType: doc.rate, vatRatePct: doc.rate === 'standard' ? 21 : 12,
      baseCzk: base, vatCzk: vatForRate(base, doc.rate === 'standard' ? '21' : '12'), deductionPct: '100', currency: 'CZK', baseForeign: null, fxRate: null, fxAmount: null, fxRateDate: null,
      dphdp3Rows: k.rows(doc.rate), khSection: k.kh(doc.big), khDocumentTotalCzk: null, shvCode: null,
      counterpartyVatId: doc.kind === 'iss_domestic' || doc.kind === 'rcv_domestic' ? 'CZ12345678' : 'DE123456789', evidenceNumber: `E-${doc.idx}-${i}`,
    };
  });
}

const docArb = (idx: number): fc.Arbitrary<Doc> => fc.record({
  kind: fc.constantFrom<Kind>('iss_domestic', 'rcv_domestic', 'eu_service', 'non_eu_service', 'eu_goods'),
  rate: fc.constantFrom<'standard' | 'reduced'>('standard', 'reduced'),
  parts: fc.array(fc.integer({ min: 1, max: 1_500_000 }), { minLength: 1, maxLength: 4 }),
  sign: fc.constantFrom<1 | -1>(1, 1, 1, -1),
  big: fc.boolean(),
  idx: fc.constant(idx),
});
const periodArb = fc.integer({ min: 0, max: 60 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => docArb(i))));
const sumKh = (rows: readonly KhAmounts[], key: keyof KhAmounts) => rows.reduce((acc, r) => acc.add(r[key]), ZERO);
const absLe = (a: Money, b: Money, tol: string) => a.subtract(b).abs().compare(Money.parse(tol, 'CZK')) <= 0;
const lookup = () => ({ duzp: null, partnerCountry: 'CZ' });

describe('KH ↔ DPHDP3 properties (M05 §9, 1 000 runs)', () => {
  it('P1–P5 hold and reconcileKhDp3 agrees on every random payer period', () => {
    fc.assert(fc.property(periodArb, (docs) => {
      const entries = docs.flatMap((doc) => entriesOf(doc, false));
      const dp3 = computeDphdp3(entries, 'platce', rules, START);
      const kh = computeKh(entries, dp3, lookup);
      expect(reconcileKhDp3(dp3, kh)).toEqual({ ok: true, issues: [] });
      // P1
      expect(kh.c.obrat23.equals(dphdp3Row(dp3, '1').base) && kh.c.pln23.equals(dphdp3Row(dp3, '40').base)).toBe(true);
      // P2
      const a45 = [...kh.a4, ...(kh.a5 ? [kh.a5] : [])];
      const b23 = [...kh.b2, ...(kh.b3 ? [kh.b3] : [])];
      expect(absLe(kh.c.obrat23, sumKh(a45, 'zaklDane1'), '0.50')).toBe(true);
      expect(absLe(kh.c.obrat5, sumKh(a45, 'zaklDane2'), '0.50')).toBe(true);
      expect(absLe(kh.c.pln23, sumKh(b23, 'zaklDane1'), '0.50')).toBe(true);
      expect(absLe(kh.c.pln5, sumKh(b23, 'zaklDane2'), '0.50')).toBe(true);
      // P3
      const k = ['3', '4', '5', '6', '12', '13'].filter((r) => !dphdp3Row(dp3, r).base.isZero()).length;
      expect(absLe(kh.c.celkZdA2, sumKh(kh.a2, 'zaklDane1').add(sumKh(kh.a2, 'zaklDane2')), (0.5 * k).toFixed(2))).toBe(true);
      // P4
      const khEntries = entries.filter((e) => e.khSection !== null);
      const rowDocs = [...kh.a2, ...kh.a4, ...kh.b2].map((r) => r.documentId).concat(kh.a5?.documentIds ?? [], kh.b3?.documentIds ?? []);
      expect(new Set(rowDocs).size).toBe(new Set(khEntries.map((e) => e.documentId)).size);
      const all = [...kh.a2, ...kh.a4, ...kh.b2, ...(kh.a5 ? [kh.a5] : []), ...(kh.b3 ? [kh.b3] : [])];
      expect(sumKh(all, 'zaklDane1').add(sumKh(all, 'zaklDane2')).equals(khEntries.reduce((a, e) => a.add(e.baseCzk), ZERO))).toBe(true);
      expect(sumKh(all, 'dan1').add(sumKh(all, 'dan2')).equals(khEntries.reduce((a, e) => a.add(e.vatCzk), ZERO))).toBe(true);
      // P5
      const r = (x: string) => dphdp3Row(dp3, x);
      expect(r('43').base.equals(r('3').base.add(r('5').base).add(r('12').base)) && r('43').tax.equals(r('3').tax.add(r('5').tax).add(r('12').tax))).toBe(true);
      expect(r('44').base.equals(r('4').base.add(r('6').base).add(r('13').base))).toBe(true);
      expect(dp3.row64.subtract(dp3.row65).equals(dp3.row62.subtract(dp3.row63))).toBe(true);
      expect(dp3.row64.isZero() || dp3.row65.isZero()).toBe(true);
    }), { numRuns: 1000 });
  });
  it('P6: IO periods never carry deduction rows or KH; ř.64 = ř.62', () => {
    fc.assert(fc.property(periodArb, (docs) => {
      const io = docs.filter((x) => x.kind === 'eu_service' || x.kind === 'non_eu_service');
      const entries = io.flatMap((doc) => entriesOf(doc, false).map((e) => ({ ...e, dphdp3Rows: e.dphdp3Rows.filter((row) => row !== '43' && row !== '44'), khSection: null })));
      const dp3 = computeDphdp3(entries, 'identifikovana_osoba', rules, START);
      expect(Object.keys(dp3.rows).some((row) => Number(row) >= 40 && Number(row) <= 46)).toBe(false);
      expect(dp3.row64.equals(dp3.row62)).toBe(true);
      expect(reconcileKhDp3(dp3, null).ok).toBe(true);
    }), { numRuns: 300 });
  });
  it('P7 permutation and P8 re-splitting give identical computations', () => {
    fc.assert(fc.property(periodArb, fc.integer(), (docs, seed) => {
      const a = docs.flatMap((doc) => entriesOf(doc, false));
      const b = docs.flatMap((doc) => entriesOf(doc, true));
      const shuffled = [...a].sort((x, y) => (x.documentId + seed).localeCompare(y.documentId + seed) || (seed % 2 ? 1 : -1));
      const run = (es: VatLedgerEntryDraft[]) => { const dp3 = computeDphdp3(es, 'platce', rules, START); return JSON.stringify({ dp3, kh: computeKh(es, dp3, lookup) }); };
      expect(run(shuffled)).toBe(run(a));
      // P8: same per-rate sums per document → identical DP3 and KH rows (evidence numbers differ per part, so compare without them)
      const strip = (s: string) => s.replace(/"cEvidDd":"[^"]*"/g, '');
      expect(strip(run(b))).toBe(strip(run(a)));
    }), { numRuns: 300 });
  });
  it('reconcileKhDp3 flags a tampered Věta C and a payer without KH', () => {
    const entries = entriesOf({ kind: 'iss_domestic', rate: 'standard', parts: [1_000_000], sign: 1, big: true, idx: 0 }, false);
    const dp3 = computeDphdp3(entries, 'platce', rules, START);
    const kh = computeKh(entries, dp3, lookup);
    const bad = { ...kh, c: { ...kh.c, obrat23: kh.c.obrat23.add(Money.parse('1.00', 'CZK')) } };
    expect(reconcileKhDp3(dp3, bad).issues.map((i) => i.code)).toContain('P1_VETAC_MISMATCH');
    expect(reconcileKhDp3(dp3, null).ok).toBe(false);
  });
});
```
P8 note: `entriesOf(doc, true)` yields several entries per document with the same rate; `computeKh` must merge them into one row per document (0334 groups per document), and `computeDphdp3` sums them. The `vatCzk` of split parts may differ from the unsplit tax by rounding; KH `dan1` therefore may differ by ≤ 0,01 per part. If the P8 assertion fails only on `dan`/`tax` haléře, relax P8 to compare `dp3.rows` keys and KH row counts/document ids and note it in the report (the spec's P8 assumes identical per-rate sums including tax).
Command: `pnpm --filter @shoebox/domain test -- kh-dp3 2>&1 | tail -30`.
3. Index line; typecheck; commit `feat(domain): reconcileKhDp3 + property tests (0335)`.

## 5. Do not touch

`dphdp3.ts`, `kh.ts` (if a property fails there, STOP and report the counterexample: it is a 0333/0334 bug).

## 6. Commands

`pnpm --filter @shoebox/domain test -- kh-dp3 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] 1 000 runs green for P1–P5; P6, P7/P8 green; typecheck clean.

## 8. Stop and ask

TEMPLATE §8; a counterexample from fast-check goes verbatim into the report.

## 9. Report

`docs/tasks/0335-report.md`.

## Risk list

`reconcile.ts`.

## Owner steps

None.
