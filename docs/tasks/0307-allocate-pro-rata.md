# 0307: `allocateProRata` (exact sums, property-tested)

Status: todo
Ticket: P1-LEDG-01 (allocation part, AC-4) | Depends on: none | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Split one payment over document lines in proportion to signed weights so that the two-decimal parts always add up to the payment exactly (the residual goes to the line with the largest |weight|, tie → lowest index). Every tax-ledger amount passes through this, so it is property-tested with 10 000 random cases.

## 2. Context

Hard rule 1: Money, never floats. M04 §4.11.3 (pasted): for each payment `p` with document payable total `W = Σ weight_l`: `share_l = p × weight_l / W` (decimal 28 digits), `alloc_l = round2(share_l)`; residual `p − Σ alloc_l` added to the line with the largest `|weight_l|` (tie → lowest position). M04 §9.1 AC-4: `allocateProRata` sums exactly to the input for any weights (fast-check, 10 000 cases incl. negative weights).

Edge cases this brief fixes (spec gap): `W = 0` with `p = 0` → all zeros; `W = 0` with `p ≠ 0` → `AllocationError` (nothing to allocate against); empty weights → `[]` when `p` is zero, else `AllocationError`. Weights may be in another currency than the total (the ratio is unit-free); the result is in the total's currency. Weights in mixed currencies → `CurrencyMismatchError` (from `Money.sum`).

`fast-check` 4.10.2 is already a devDependency of `@shoebox/domain` (`packages/domain/package.json`). Existing API: `Money.parse`, `Money.sum(items, currency)`, `add`, `subtract`, `multiply(Decimal)`, `divide(Decimal)`, `abs`, `compare`, `isZero`, `toDecimal`, `toFixed2`, `round2` (`packages/domain/src/money`). Lint: no `Number()`/`parseFloat`.

Hand-checked examples (the tests):

- 100.00 over [1,1,1]: shares 33.333… → 33.33 ×3 = 99.99, residual +0.01 → index 0 → [33.34, 33.33, 33.33].
- 0.10 over [1,1,1]: 0.0333 → 0.03 ×3 = 0.09, residual 0.01 → [0.04, 0.03, 0.03].
- −100.00 over [1,1,1]: −33.33 ×3 = −99.99, residual −0.01 → [−33.34, −33.33, −33.33] (ROUND_HALF_UP is half away from zero; −33.333 → −33.33).
- 1.00 over [1,1,1,1,1,1]: 0.1667 → 0.17 ×6 = 1.02, residual −0.02 → index 0 → [0.15, 0.17, 0.17, 0.17, 0.17, 0.17].
- 100.00 over [150, −50]: W = 100; shares 150, −50 → exact.
- 1.00 over [1, 2]: 0.333→0.33, 0.667→0.67 → 1.00, no residual.
- 7.00 over [5, −3, 10]: W = 12; 2.9167→2.92, −1.75, 5.8333→5.83 → 7.00, no residual.
- 10.00 over [0, 5]: [0.00, 10.00].
- 0.10 over [−1, −1, 1, 1, 1, 1, 1]: W = 3; −0.0333 → −0.03 ×2, 0.0333 → 0.03 ×5 → Σ 0.09, residual +0.01 → all |w| equal → index 0 → [−0.02, −0.03, 0.03, 0.03, 0.03, 0.03, 0.03].
- 0.10 over [−5, 1, 1]: W = −3; 0.1667 → 0.17, −0.0333 → −0.03 ×2 → Σ 0.11, residual −0.01 → index 0 (|−5| largest) → [0.16, −0.03, −0.03].
- 5000.00 over [9680.00, 3280.84] (partial payment of the manager invoice): 5000·9680/12960.84 = 3734.3259 → 3734.33; 5000·3280.84/12960.84 = 1265.6741 → 1265.67; Σ 5000.00.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/test/allocate.test.ts` | create | verbatim below |
| `packages/domain/src/ledgers/allocate.ts` | create | `allocateProRata`, `AllocationError` |
| `packages/domain/src/index.ts` | edit | export |

## 4. Steps

1. Create `packages/domain/test/allocate.test.ts` with exactly:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AllocationError, allocateProRata } from '../src/ledgers/allocate';
import { CurrencyMismatchError, Money, round2 } from '../src/money/index';

const czk = (s: string) => Money.parse(s, 'CZK');
const w = (...xs: string[]) => xs.map(czk);
const out = (ms: readonly Money[]) => ms.map((m) => m.toFixed2());

/** Integer cents → decimal literal without floats (`-1234` → `'-12.34'`). */
function centsToLiteral(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${frac < 10 ? '0' : ''}${frac}`;
}
const centsArb = (min: number, max: number) => fc.integer({ min, max }).map((c) => czk(centsToLiteral(c)));

describe('allocateProRata (M04 §4.11.3, AC-4)', () => {
  it('hand-checked cases', () => {
    expect(out(allocateProRata(czk('100.00'), w('1', '1', '1')))).toEqual(['33.34', '33.33', '33.33']);
    expect(out(allocateProRata(czk('0.10'), w('1', '1', '1')))).toEqual(['0.04', '0.03', '0.03']);
    expect(out(allocateProRata(czk('-100.00'), w('1', '1', '1')))).toEqual(['-33.34', '-33.33', '-33.33']);
    expect(out(allocateProRata(czk('1.00'), w('1', '1', '1', '1', '1', '1')))).toEqual(['0.15', '0.17', '0.17', '0.17', '0.17', '0.17']);
    expect(out(allocateProRata(czk('100.00'), w('150', '-50')))).toEqual(['150.00', '-50.00']);
    expect(out(allocateProRata(czk('1.00'), w('1', '2')))).toEqual(['0.33', '0.67']);
    expect(out(allocateProRata(czk('7.00'), w('5', '-3', '10')))).toEqual(['2.92', '-1.75', '5.83']);
    expect(out(allocateProRata(czk('10.00'), w('0', '5')))).toEqual(['0.00', '10.00']);
    expect(out(allocateProRata(czk('12960.84'), w('9680.00', '3280.84')))).toEqual(['9680.00', '3280.84']);
    expect(out(allocateProRata(czk('5000.00'), w('9680.00', '3280.84')))).toEqual(['3734.33', '1265.67']);
  });

  it('residual goes to the largest |weight|, tie → lowest index', () => {
    expect(out(allocateProRata(czk('0.10'), w('1', '3', '3')))).toEqual(['0.01', '0.05', '0.04']);
    expect(out(allocateProRata(czk('0.10'), w('-1', '-1', '1', '1', '1', '1', '1')))).toEqual(['-0.02', '-0.03', '0.03', '0.03', '0.03', '0.03', '0.03']);
    expect(out(allocateProRata(czk('0.10'), w('-5', '1', '1')))).toEqual(['0.16', '-0.03', '-0.03']);
  });

  it('result currency is the total’s; weights may be in another currency', () => {
    const r = allocateProRata(czk('245.35'), [Money.parse('7.46', 'USD'), Money.parse('3.00', 'USD')]);
    expect(r.every((m) => m.currency === 'CZK')).toBe(true);
    expect(Money.sum(r, 'CZK').toFixed2()).toBe('245.35');
  });

  it('degenerate inputs', () => {
    expect(out(allocateProRata(czk('0.00'), w('0', '0')))).toEqual(['0.00', '0.00']);
    expect(allocateProRata(czk('0.00'), [])).toEqual([]);
    expect(() => allocateProRata(czk('1.00'), [])).toThrow(AllocationError);
    expect(() => allocateProRata(czk('1.00'), w('5', '-5'))).toThrow(AllocationError);
    expect(() => allocateProRata(czk('1.00'), [czk('1'), Money.parse('1', 'EUR')])).toThrow(CurrencyMismatchError);
  });

  it('property: Σ allocations = total exactly, two decimals, deterministic (10 000 runs, negative weights included)', () => {
    fc.assert(
      fc.property(
        centsArb(-1_000_000_000, 1_000_000_000),
        fc.array(centsArb(-10_000_000, 10_000_000), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          fc.pre(!Money.sum(weights, 'CZK').isZero());
          const a = allocateProRata(total, weights);
          const b = allocateProRata(total, weights);
          expect(a).toHaveLength(weights.length);
          expect(Money.sum(a, 'CZK').equals(total)).toBe(true);
          for (const [i, m] of a.entries()) {
            expect(round2(m).equals(m)).toBe(true);
            expect(m.equals(b[i] as Money)).toBe(true);
          }
        },
      ),
      { numRuns: 10_000 },
    );
  });

});
```

Command: `pnpm --filter @shoebox/domain test -- allocate 2>&1 | tail -30`. Expected: fails (module missing).

2. Create `packages/domain/src/ledgers/allocate.ts`. Exported names and signatures exactly:

```ts
import { Money, round2 } from '../money/index';

export class AllocationError extends Error { constructor(message: string) { super(message); this.name = 'AllocationError'; } }
/**
 * M04 §4.11.3: `share_l = total × weight_l / W`, `round2`, residual to the largest |weight| (tie → lowest index).
 * Result is in `total.currency` and sums to `total` exactly. Weights must share one currency.
 */
export function allocateProRata(total: Money, weights: readonly Money[]): Money[];
```

Implementation: `W = Money.sum(weights, weights[0]?.currency ?? total.currency)`; if `W.isZero()`: `total.isZero()` → zeros (one `Money.zero(total.currency)` per weight), else throw. Else for each weight `share = total.toDecimal().times(weight.toDecimal()).div(W.toDecimal())` (28-digit precision from `Money`'s Decimal clone: use `Money.fromDecimal(share, total.currency)` then `round2`), `alloc = round2(...)`. Residual `total − Σ alloc`; if not zero, add to the index of the largest `weight.abs()` (first max). Return the array.

Implement until the tests pass; `pnpm exec biome check --write packages/domain/src/ledgers/allocate.ts 2>&1 | tail -5`.

Command: `pnpm --filter @shoebox/domain test -- allocate 2>&1 | tail -30`. Expected: green (the 10 000-run property takes a few seconds).

3. Edit `packages/domain/src/index.ts`. Anchor: `export * from './enums/index';`. Append after it: `export * from './ledgers/allocate';`. Typecheck and biome (§6).

## 5. Do not touch

Money module, test files, other packages. Hard rule 1.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- allocate 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] Test file green, unchanged; property 10 000 runs.
- [ ] Commits `0307 step 1..3`; no push.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0307-report.md`, `Status: review`, commit `0307 report`.

## Spec notes for the reviewer

- The `W = 0` and empty cases are not in M04; the brief throws rather than guess (a document whose line weights cancel out has nothing a payment can be allocated to).

## Risk list (for the reviewer)

`packages/domain/src/ledgers/allocate.ts`.

## Owner steps

None.
