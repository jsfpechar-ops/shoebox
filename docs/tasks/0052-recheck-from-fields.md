# 0052: Re-run the checks from the stored fields

Status: review
Ticket: P1 review screen, part 2a (trimmed, Phase 1 core loop) | Depends on: 0049 merged into phase/0 | Base commit: see branch | Branch: task/0052-recheck-from-fields | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

When the user corrects a value, the checks must run again on the corrected data (hard rule 2: nothing reaches `ready` without the deterministic checks). The checks today run only on a fresh AI reading. This brief makes them runnable from the stored `document_fields` (one value per M02 key), so the web app can re-check after a correction (brief 0053). It also moves the "check result → validation row" mapping into `@shoebox/validation`, so the worker and the web app write identical rows.

## 2. Context

- `runProtoChecks(input: ProtoCheckInput, options)` is in `packages/validation/src/proto-checks/checks.ts`. `ProtoCheckInput` (same file, line ~38) has `document_class?`, `supplier {ico, dic, country?}`, `buyer? {ico, dic}`, `dates {issue_date, duzp, due_date}`, `currency`, `totals {gross, vat?}`, `vat_recap [{rate_pct, base, vat}]`, `payment? {method}`, `flags? {non_vat_payer_text, reverse_charge_text, paid_text}`, `issues?`.
- The worker stores fields with `fieldsOf(x)` in `apps/worker/src/doc-extract/rows.ts`: keys `supplier.ico`, `supplier.dic`, `supplier.country`, `buyer.ico`, `buyer.dic`, `dates.issue_date`, `dates.duzp`, `dates.due_date`, `currency`, `totals.vat`, `totals.gross`, `payment.method`, `vat_recap[N].rate_pct|base|vat` and more. A null value is not stored. Flags are not stored yet.
- The same file has:

```ts
export function validationRowsOf(results: readonly ProtoCheckResult[]): ValidationRow[] {
  const rows: ValidationRow[] = [];
  for (const r of results) {
    if (r.severity === 'pass') {
      continue;
    }
    rows.push({
      ruleId: `PROTO_${String(r.id).toUpperCase()}`,
      ruleVersion: 1,
      severity: r.severity === 'fail' ? 'blocking' : 'warning',
      params: { ...(r.params as Record<string, unknown>), messageKey: r.key },
    });
  }
  return rows;
}
```

- `ValidationRow` is the type of those rows in `rows.ts` (`{ ruleId: string; ruleVersion: number; severity: 'blocking' | 'warning'; params: Record<string, unknown> }`).
- The worker test `apps/worker/test/doc-extract-rows.test.ts` has a `reading()` fixture (a full `ProtoExtraction` with `flags` all false) and the test `'lists every non-null value with the M02 key grammar, in order'`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/validation/src/proto-checks/stored.ts` | create | `checkInputFromFields`, `validationRowsOf`, `ValidationRow` |
| `packages/validation/src/index.ts` | edit | `export * from './proto-checks/stored';` |
| `packages/validation/test/stored.test.ts` | create | the test file below, verbatim |
| `apps/worker/src/doc-extract/rows.ts` | edit | `validationRowsOf` and `ValidationRow` come from `@shoebox/validation`; `fieldsOf` stores the flags |
| `apps/worker/test/doc-extract-rows.test.ts` | edit | the fieldsOf key list, and one new test |

No other file may change.

## 4. Steps

1. Create `packages/validation/src/proto-checks/stored.ts`:

```ts
import type { ProtoCheckInput, ProtoCheckResult } from './checks';

/** A check result as a `validation_results` row (pass results are dropped). */
export interface ValidationRow {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly severity: 'blocking' | 'warning';
  readonly params: Record<string, unknown>;
}

export function validationRowsOf(results: readonly ProtoCheckResult[]): ValidationRow[] { /* the body of §2, unchanged */ }

/**
 * The check input rebuilt from the current `document_fields` values (M02 key grammar), so the
 * checks can run again after a user correction. Parser issues are gone by then, so `issues` is empty.
 */
export function checkInputFromFields(
  fields: Readonly<Record<string, string>>,
  documentClass?: string,
): ProtoCheckInput
```

   Rules for `checkInputFromFields` (`v(k)` = `fields[k] ?? null`):
   - `document_class`: set only when `documentClass` is given.
   - `supplier: { ico: v('supplier.ico'), dic: v('supplier.dic'), country: v('supplier.country') }`, `buyer: { ico: v('buyer.ico'), dic: v('buyer.dic') }`.
   - `dates` from `dates.issue_date`, `dates.duzp`, `dates.due_date`; `currency: v('currency')`; `totals: { gross: v('totals.gross'), vat: v('totals.vat') }`; `payment: { method: v('payment.method') }`.
   - `vat_recap`: every index N that has all three keys `vat_recap[N].rate_pct`, `vat_recap[N].base`, `vat_recap[N].vat`, sorted by N as a number; a line missing one of the three is left out.
   - `flags`: only when at least one key `flags.non_vat_payer_text`, `flags.reverse_charge_text`, `flags.paid_text` exists; then each is `fields[k] === 'true'`.
   - `issues: []`.

   Add `export * from './proto-checks/stored';` to `packages/validation/src/index.ts`. Create the test file below verbatim. Run `pnpm --filter @shoebox/validation test -- test/stored.test.ts 2>&1 | tail -30` and `pnpm --filter @shoebox/validation typecheck 2>&1 | tail -30`. Expected: pass. Commit `0052 step 1`.

```ts
import { describe, expect, it } from 'vitest';
import { checkInputFromFields, validationRowsOf } from '../src';

describe('checkInputFromFields', () => {
  it('rebuilds the input from flat keys, keeping only whole recap lines in index order', () => {
    const input = checkInputFromFields(
      {
        'supplier.ico': '27082440',
        'dates.issue_date': '2026-10-01',
        currency: 'CZK',
        'totals.gross': '1210',
        'vat_recap[10].rate_pct': '12',
        'vat_recap[10].base': '100',
        'vat_recap[10].vat': '12',
        'vat_recap[2].rate_pct': '21',
        'vat_recap[2].base': '1000',
        'vat_recap[2].vat': '210',
        'vat_recap[3].rate_pct': '21',
        'flags.paid_text': 'true',
      },
      'received_invoice',
    );
    expect(input).toEqual({
      document_class: 'received_invoice',
      supplier: { ico: '27082440', dic: null, country: null },
      buyer: { ico: null, dic: null },
      dates: { issue_date: '2026-10-01', duzp: null, due_date: null },
      currency: 'CZK',
      totals: { gross: '1210', vat: null },
      vat_recap: [
        { rate_pct: '21', base: '1000', vat: '210' },
        { rate_pct: '12', base: '100', vat: '12' },
      ],
      payment: { method: null },
      flags: { non_vat_payer_text: false, reverse_charge_text: false, paid_text: true },
      issues: [],
    });
  });

  it('leaves flags and the class out when they were never stored', () => {
    const input = checkInputFromFields({});
    expect(input.flags).toBeUndefined();
    expect('document_class' in input).toBe(false);
    expect(input.vat_recap).toEqual([]);
  });
});

describe('validationRowsOf', () => {
  it('drops passes, maps severities and keeps the message key', () => {
    expect(
      validationRowsOf([
        { id: 'ico', severity: 'pass', key: 'proto.check.ico.pass', params: {} },
        { id: 'vat_rate_math', severity: 'fail', key: 'proto.check.vat_rate_math.fail', params: { rate: '21' } },
        { id: 'dic_format', severity: 'warn', key: 'proto.check.dic_format.warn', params: {} },
      ] as never),
    ).toEqual([
      { ruleId: 'PROTO_VAT_RATE_MATH', ruleVersion: 1, severity: 'blocking', params: { rate: '21', messageKey: 'proto.check.vat_rate_math.fail' } },
      { ruleId: 'PROTO_DIC_FORMAT', ruleVersion: 1, severity: 'warning', params: { messageKey: 'proto.check.dic_format.warn' } },
    ]);
  });
});
```

2. Edit `apps/worker/src/doc-extract/rows.ts`: delete its `validationRowsOf` function and its `ValidationRow` type, and add `export { type ValidationRow, validationRowsOf } from '@shoebox/validation';` (keep every other import of `ValidationRow` in the file working by also importing the type). In `fieldsOf`, after the `vat_recap` loop, append the three flags as text:

```ts
  pairs.push(['flags.non_vat_payer_text', String(x.flags.non_vat_payer_text)]);
  pairs.push(['flags.reverse_charge_text', String(x.flags.reverse_charge_text)]);
  pairs.push(['flags.paid_text', String(x.flags.paid_text)]);
```

   Run `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`. Expected: clean. Commit `0052 step 2`.
3. Edit `apps/worker/test/doc-extract-rows.test.ts`: in `'lists every non-null value with the M02 key grammar, in order'`, append `'flags.non_vat_payer_text'`, `'flags.reverse_charge_text'`, `'flags.paid_text'` after `'vat_recap[0].vat'` (this is the only change to existing tests). Add this test at the end of the file (add the two imports it needs at the top: `runProtoChecks` and `checkInputFromFields` from `@shoebox/validation`, if not already imported):

```ts
describe('re-check from stored fields', () => {
  it('gives the same results as the fresh reading', () => {
    const today = '2026-10-20' as never;
    const x = reading({ flags: { not_tax_document_text: false, non_vat_payer_text: true, reverse_charge_text: false, paid_text: false } } as never);
    const stored = Object.fromEntries(fieldsOf(x).map((f) => [f.fieldKey, f.valueText]));
    const again = runProtoChecks(checkInputFromFields(stored, x.document_class), { today });
    expect(again).toEqual(runProtoChecks(x, { today }));
  });
});
```

   Run `pnpm --filter @shoebox/worker test 2>&1 | tail -30`. Expected: pass. If the re-check test fails, compare the two result lists and fix `checkInputFromFields` (never the test). Commit `0052 step 3`.
4. Run `pnpm exec biome ci packages/validation apps/worker 2>&1 | tail -30` (fix formatting with `pnpm exec biome check --write <file>`), `pnpm --filter @shoebox/validation test 2>&1 | tail -30` and `python3 scripts/context_lint.py 2>&1 | tail -30`. Expected: clean. Commit `0052 step 4`.

## 5. Do not touch

`packages/validation/src/proto-checks/checks.ts`, `packages/extraction/**`, `packages/db/**`, `apps/web/**`, the other functions in `rows.ts`.

## 6. Commands

The commands of steps 1–4, each ending `2>&1 | tail -30`.

## 7. Acceptance

- [ ] `checkInputFromFields` and `validationRowsOf` are exported from `@shoebox/validation`; the worker re-exports `validationRowsOf` and has no copy of its own.
- [ ] The re-check test proves the stored fields give the same check results as the fresh reading.
- [ ] validation and worker tests, typecheck and biome are clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed (the worker already depends on `@shoebox/validation`);
- a file outside §3 needs a change, or §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0052-report.md` (600 tokens at most) and set `Status: review`. The report has the files changed, each command with the last 5 lines of output, §7 ticked, deviations, questions, owner steps left.

## Risk list (for the reviewer)

`checkInputFromFields` (a missed key silently drops a check), the re-export in `rows.ts`.

## Owner steps

None.
