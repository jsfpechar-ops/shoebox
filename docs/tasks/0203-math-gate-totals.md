# 0203: Math gate: totals, recap against totals, QR amount

Status: blocked
Ticket: P1-VAL-02 (proto subset) | Depends on: none | Base commit: 496b1e9 | Branch: task/0203-math-gate | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0203-report.md

## 1. Objective

Three more blocking arithmetic checks: net + VAT = total, the VAT recap rows add up to the printed net and VAT totals, and the amount in the payment QR equals the total. A document that does not add up never reaches `ready` (a `fail` result becomes a blocking row).

## 2. Context

`packages/validation/src/proto-checks/checks.ts` (verbatim excerpts):

```ts
  readonly currency: string | null;
  readonly totals: { readonly gross: string | null; readonly vat?: string | null };
```

```ts
export const PROTO_CHECK_IDS = [
  'vat_sum',
```

```ts
    ...checkVat(input, currency, options.today),
    ...checkIdentifiers(input),
```

Helpers already in that file: `parseMoney(text, currency): Money | null`, `roundingLineAllowed(diff, tolerance)` (from `@shoebox/domain`, true when |diff| ≤ tolerance), `Money.parse/add/subtract/isZero/toFixed2`, `Money.zero(currency)`. Look at `checkVat` for the style and copy it.

`packages/validation/src/proto-checks/stored.ts` (verbatim):

```ts
    totals: { gross: v('totals.gross'), vat: v('totals.vat') },
```

Tolerances (M03, 06 §2.2): exact sums use `0.01`; a printed rounding line may move the total by up to `1.00`. TODO(decision-tolerances-in-rules): the product keys `validation.tol.*` exist in `packages/domain/src/rules/product.ts` but have no seeded values yet; use the same literals `checkVat` already uses.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/validation/src/proto-checks/checks.ts` | edit | input fields, ids, three checks |
| `packages/validation/src/proto-checks/stored.ts` | edit | read `totals.net` and `qr.amount` |
| `packages/i18n/messages/en.json` | edit | new keys (copy below) |
| `packages/validation/test/proto-checks-math.test.ts` | new | tests below, verbatim |

No other file may change. Do not edit `cs.json` (Czech stays dormant).

## 4. Steps

1. `checks.ts`:
   - Replace the `totals` line with `readonly totals: { readonly gross: string | null; readonly vat?: string | null; readonly net?: string | null };` and add below `vat_recap` in `ProtoCheckInput`: `/** Amount read from the payment QR code (0201), dot decimal. */ readonly qr?: { readonly amount: string | null };`
   - Append `'totals_math', 'recap_vs_totals', 'qr_amount'` to the end of `PROTO_CHECK_IDS`.
   - Add three functions and call them in `runProtoChecks` right after `checkVat`:
     - `checkTotalsMath`: when net, vat and gross all parse: `diff = gross − (net + vat)`; zero → `pass` key `proto.check.totals_math.pass`; |diff| ≤ 1.00 → `warn` `…warn`; else `fail` `…fail`. Params `{ net, vat, gross, diff }` as `toFixed2()`.
     - `checkRecapVsTotals`: only when `vat_recap` is non-empty and every row's base and vat parse. If net parses: compare the sum of bases with net; if vat parses: compare the sum of VAT with vat. Each comparison: zero → `pass`, |diff| ≤ 0.01 → `warn`, else `fail`; keys `proto.check.recap_net.{pass,warn,fail}` and `proto.check.recap_vat.{pass,warn,fail}`, id `recap_vs_totals`, params `{ recap, total, diff }`.
     - `checkQrAmount`: when `qr.amount` and gross parse: equal → `pass` `proto.check.qr_amount.pass`, else `fail` `proto.check.qr_amount.fail`, params `{ qr, total }`.
2. `stored.ts`: replace the totals line with `totals: { gross: v('totals.gross'), vat: v('totals.vat'), net: v('totals.net') },` and, next to the flags block, `if (fields['qr.amount'] !== undefined) { input.qr = { amount: v('qr.amount') }; }`.
3. `en.json`: add, next to the other `proto.check.*` keys:

```json
  "proto.check.totals_math.pass": "Net {net} plus VAT {vat} equals the total {gross}.",
  "proto.check.totals_math.warn": "Net plus VAT differs from the total {gross} by {diff}; within rounding.",
  "proto.check.totals_math.fail": "Net {net} plus VAT {vat} does not equal the total {gross} (difference {diff}).",
  "proto.check.recap_net.pass": "The VAT table bases add up to the net total {total}.",
  "proto.check.recap_net.warn": "The VAT table bases ({recap}) differ from the net total {total} by {diff}.",
  "proto.check.recap_net.fail": "The VAT table bases ({recap}) do not add up to the net total {total} (difference {diff}).",
  "proto.check.recap_vat.pass": "The VAT table adds up to the VAT total {total}.",
  "proto.check.recap_vat.warn": "The VAT table ({recap}) differs from the VAT total {total} by {diff}.",
  "proto.check.recap_vat.fail": "The VAT table ({recap}) does not add up to the VAT total {total} (difference {diff}).",
  "proto.check.qr_amount.pass": "The payment QR code amount matches the total {total}.",
  "proto.check.qr_amount.fail": "The payment QR code says {qr}, but the total is {total}. Check which one is right.",
```

4. Create `packages/validation/test/proto-checks-math.test.ts`, verbatim:

```ts
import { parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  checkInputFromFields,
  type ProtoCheckInput,
  runProtoChecks,
  validationRowsOf,
} from '../src/index';

// Synthetic values only (hard rule 4).
const TODAY = parseLegalDate('2026-10-19');

function input(over: Partial<ProtoCheckInput> = {}): ProtoCheckInput {
  return {
    document_class: 'received_invoice',
    supplier: { ico: '25596641', dic: 'CZ25596641', country: 'CZ' },
    dates: { issue_date: '2026-09-12', duzp: '2026-09-12', due_date: '2026-09-26' },
    currency: 'CZK',
    totals: { net: '1100.00', vat: '222.00', gross: '1322.00' },
    vat_recap: [
      { rate_pct: '21', base: '1000.00', vat: '210.00' },
      { rate_pct: '12', base: '100.00', vat: '12.00' },
    ],
    issues: [],
    ...over,
  };
}

function sev(over: Partial<ProtoCheckInput>, id: string): string[] {
  return runProtoChecks(input(over), { today: TODAY })
    .filter((r) => r.id === id)
    .map((r) => `${r.key}:${r.severity}`);
}

describe('totals_math', () => {
  it('passes, warns within 1.00, fails beyond', () => {
    expect(sev({}, 'totals_math')).toEqual(['proto.check.totals_math.pass:pass']);
    expect(sev({ totals: { net: '1100.00', vat: '222.00', gross: '1322.40' } }, 'totals_math')).toEqual([
      'proto.check.totals_math.warn:warn',
    ]);
    expect(sev({ totals: { net: '1100.00', vat: '222.00', gross: '1422.00' } }, 'totals_math')).toEqual([
      'proto.check.totals_math.fail:fail',
    ]);
  });
  it('is skipped when net is missing', () => {
    expect(sev({ totals: { vat: '222.00', gross: '1322.00' } }, 'totals_math')).toEqual([]);
  });
});

describe('recap_vs_totals', () => {
  it('passes when bases and VAT add up', () => {
    expect(sev({}, 'recap_vs_totals')).toEqual([
      'proto.check.recap_net.pass:pass',
      'proto.check.recap_vat.pass:pass',
    ]);
  });
  it('fails a swapped base and VAT (decimal shift)', () => {
    const r = sev({ totals: { net: '1100.00', vat: '2220.00', gross: '3320.00' } }, 'recap_vs_totals');
    expect(r).toEqual(['proto.check.recap_net.pass:pass', 'proto.check.recap_vat.fail:fail']);
  });
  it('warns on a one-haler difference', () => {
    const r = sev({ totals: { net: '1100.01', vat: '222.00', gross: '1322.01' } }, 'recap_vs_totals');
    expect(r[0]).toBe('proto.check.recap_net.warn:warn');
  });
  it('is skipped with an empty recap', () => {
    expect(sev({ vat_recap: [] }, 'recap_vs_totals')).toEqual([]);
  });
});

describe('qr_amount', () => {
  it('passes when equal and blocks when different', () => {
    expect(sev({ qr: { amount: '1322.00' } }, 'qr_amount')).toEqual(['proto.check.qr_amount.pass:pass']);
    expect(sev({ qr: { amount: '1232.00' } }, 'qr_amount')).toEqual(['proto.check.qr_amount.fail:fail']);
    const rows = validationRowsOf(runProtoChecks(input({ qr: { amount: '1232.00' } }), { today: TODAY }));
    expect(rows.find((x) => x.ruleId === 'PROTO_QR_AMOUNT')?.severity).toBe('blocking');
  });
  it('is skipped without a QR amount', () => {
    expect(sev({}, 'qr_amount')).toEqual([]);
    expect(sev({ qr: { amount: null } }, 'qr_amount')).toEqual([]);
  });
});

describe('checkInputFromFields', () => {
  it('reads totals.net and qr.amount', () => {
    const x = checkInputFromFields({ 'totals.net': '10.00', 'qr.amount': '12.10' });
    expect(x.totals.net).toBe('10.00');
    expect(x.qr).toEqual({ amount: '12.10' });
    expect(checkInputFromFields({}).qr).toBeUndefined();
  });
});
```

   Implement until these tests pass; do not edit the test file.

## 5. Do not touch

Everything outside §3. Hard rule 1: Money only, never a float or `Number()` on amounts.

## 6. Commands

```
pnpm --filter @shoebox/validation test 2>&1 | tail -30
pnpm --filter @shoebox/validation typecheck 2>&1 | tail -30
pnpm --filter @shoebox/i18n test 2>&1 | tail -30
pnpm --filter @shoebox/worker test -- doc-extract 2>&1 | tail -30
pnpm --filter @shoebox/web test -- correction 2>&1 | tail -30
pnpm eval --quick 2>&1 | tail -30
pnpm exec biome check packages/validation packages/i18n 2>&1 | tail -30
```

All pass. If an existing test (not yours) fails only because it lists every check result and now sees the new `pass` results, STOP and report (§8).

## 7. Acceptance

- [ ] The commands in §6 pass.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0203-report.md`, 200 tokens at most. Set `Status: review`.

## Risk list (for the reviewer)

`checks.ts` (money).
