# 0045: Turn a Haiku reading into database rows

Status: review
Ticket: P1-EXT-07 (trimmed, Phase 1 core loop) | Depends on: none | Base commit: 37d843b | Branch: task/0045-read-rows | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add pure functions in the worker that turn one `ProtoExtraction` (the Haiku 5.5 reading) and its `ProtoCheckResult[]` (the deterministic checks) into the rows the `doc.extract` job will write: the `documents` patch, `document_vat_summary`, `document_fields` and `validation_results` rows, plus the document's next status. This is the core of "upload, read, check, ready" without any I/O, so it can be tested exactly.

## 2. Context

- Hard rule 1: money is never a float. Add amounts only with `Money` from `@shoebox/domain` (`Money.parse(text, currency)`, `.add()`, `.toString()` gives plain notation like `'1100'` or `'1234.56'`). VAT rates come only from the rules: the caller passes `rules.at(date).get('vat.rates')`, which is `{ standard: 21, reduced: 12 }` for 2025–2026.
- Hard rule 2: AI output is a suggestion. A document reaches `ready` only when no check failed.
- `ProtoExtraction` (in `packages/extraction/src/proto/schema.ts`, exported from `@shoebox/extraction`) has: `document_class`, `supplier {name, ico, dic, vat_id, country}`, `buyer {name, ico, dic}`, `document {number, variable_symbol}`, `dates {issue_date, duzp, due_date}`, `currency`, `vat_recap: {rate_pct, base, vat}[]` (decimal strings), `totals {net, vat, gross}`, `payment {account_number, bank_code, iban, method}`, `flags {not_tax_document_text, non_vat_payer_text, reverse_charge_text, paid_text}`, `not_tax_document`, `issues`. Every value is a string or null.
- `ProtoDocumentClass` includes `'unreadable'`; the database enum `document_class` does not, so map it to `'unknown'`. All other values exist in the enum as they are.
- `ProtoPaymentMethod` is `'bank_transfer' | 'card' | 'cash' | 'cash_on_delivery' | 'other'`; the `documents.payment_method` check allows `'bank_transfer','card','cash','cod','platform_offset','other'`, so `cash_on_delivery` becomes `'cod'`.
- `ProtoCheckResult` (from `@shoebox/validation`) is `{ id, severity: 'pass' | 'warn' | 'fail', key, params }`. Database `severity` enum is `'blocking' | 'warning' | 'info'`: `fail` → `blocking`, `warn` → `warning`, `pass` → no row.
- M02 §5.2 field-key grammar: `document.number`, `supplier.ico`, `dates.duzp`, `vat_recap[0].base`, `totals.gross`. `value_text` is the canonical string.
- Status after reading (04 statuses): `non_document` → `supporting`; `unknown` (incl. unreadable) → `needs_review`; any `blocking` row → `needs_review`; otherwise `ready`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/doc-extract/rows.ts` | create | the pure mappers below |
| `apps/worker/test/doc-extract-rows.test.ts` | create | the test file below, verbatim |
| `apps/worker/package.json` | edit | add `@shoebox/domain`, `@shoebox/extraction`, `@shoebox/validation` as `workspace:*` dependencies |
| `pnpm-lock.yaml` | edit | only through `pnpm install` |

No other file may change.

## 4. Steps

1. Edit `apps/worker/package.json`: in `"dependencies"`, add `"@shoebox/domain": "workspace:*"`, `"@shoebox/extraction": "workspace:*"`, `"@shoebox/validation": "workspace:*"` (keep alphabetical order). Run `pnpm install 2>&1 | tail -5`. Expected: no error. Commit `0045 step 1`.
2. Create `apps/worker/test/doc-extract-rows.test.ts` with the test file below, verbatim. Commit `0045 step 2`.
3. Create `apps/worker/src/doc-extract/rows.ts` with exactly these exports and implement until the tests pass. Do not edit the test file.

```ts
import type { ProtoExtraction } from '@shoebox/extraction';
import type { ProtoCheckResult } from '@shoebox/validation';

export interface VatRates { readonly standard: number; readonly reduced: number }

export type DbDocumentClass =
  | 'received_invoice' | 'received_receipt' | 'received_credit_note' | 'received_proforma'
  | 'received_advance_tax_doc' | 'order_confirmation' | 'settlement_statement'
  | 'government_filing' | 'non_document' | 'unknown';

export interface DocumentPatch {
  readonly class: DbDocumentClass;
  readonly classSource: 'llm';
  readonly direction: 'in';
  readonly taxDocStatus: 'full_tax_document' | 'not_tax_document' | 'unknown';
  readonly partnerSnapshot: { name: string | null; ico: string | null; dic: string | null; vat_id: string | null; country: string | null } | null;
  readonly buyerSnapshot: { name: string | null; ico: string | null; dic: string | null } | null;
  readonly documentNumber: string | null;
  readonly variableSymbol: string | null;
  readonly issueDate: string | null;
  readonly duzp: string | null;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly totalNet: string | null;
  readonly totalVat: string | null;
  readonly totalGross: string | null;
  readonly paymentMethod: 'bank_transfer' | 'card' | 'cash' | 'cod' | 'other' | null;
  readonly payToAccount: { account: string | null; bank_code: string | null; iban: string | null } | null;
  readonly isPaidPerDocument: boolean | null;
}

export interface VatSummaryRow {
  readonly vatRateType: 'standard' | 'reduced' | 'zero' | 'none';
  readonly vatRatePct: string;
  readonly base: string;
  readonly vat: string;
}

export interface FieldRow { readonly fieldKey: string; readonly valueText: string; readonly source: 'llm' }

export interface ValidationRow {
  readonly ruleId: string;
  readonly ruleVersion: 1;
  readonly severity: 'blocking' | 'warning';
  readonly params: Record<string, unknown>;
}

export type StatusAfterRead = 'ready' | 'needs_review' | 'supporting';

export function documentPatchOf(x: ProtoExtraction): DocumentPatch;
export function vatSummaryOf(x: ProtoExtraction, rates: VatRates): VatSummaryRow[];
export function fieldsOf(x: ProtoExtraction): FieldRow[];
export function validationRowsOf(results: readonly ProtoCheckResult[]): ValidationRow[];
export function statusAfterRead(x: ProtoExtraction, rows: readonly ValidationRow[]): StatusAfterRead;
```

Rules the tests check:
- `documentPatchOf`: snapshots are null when every value in them is null; `currency` defaults to `'CZK'`; `taxDocStatus` is `not_tax_document` when `x.not_tax_document`, `full_tax_document` when the class is `received_invoice`, `received_credit_note` or `received_advance_tax_doc` and `vat_recap` is not empty, else `unknown`; `payToAccount` is null when account, bank code and IBAN are all null; `isPaidPerDocument` is `true` when `flags.paid_text`, else null.
- `vatSummaryOf`: rate type from the number of `rate_pct`: equal to `rates.standard` → `standard`, `rates.reduced` → `reduced`, 0 → `zero`, anything else → `none`. Two recap lines with the same `rate_pct` are summed with `Money` into one row (the table's key is document + type + pct). Order: as first seen.
- `fieldsOf`: one row per non-null value, keys `supplier.name`, `supplier.ico`, `supplier.dic`, `supplier.vat_id`, `supplier.country`, `buyer.name`, `buyer.ico`, `buyer.dic`, `document.number`, `document.variable_symbol`, `dates.issue_date`, `dates.duzp`, `dates.due_date`, `currency`, `totals.net`, `totals.vat`, `totals.gross`, `payment.account_number`, `payment.bank_code`, `payment.iban`, `payment.method`, then `vat_recap[i].rate_pct`, `vat_recap[i].base`, `vat_recap[i].vat` for each recap line, in that order.
- `validationRowsOf`: `ruleId` is `'PROTO_' + id.toUpperCase()`, `pass` results dropped.
- `statusAfterRead`: as in §2.

Run `pnpm --filter @shoebox/worker test -- doc-extract-rows 2>&1 | tail -30`. Expected: all tests pass. Commit `0045 step 3`.
4. Run `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` and `pnpm exec biome ci apps/worker 2>&1 | tail -30`. Expected: no errors (fix formatting with `pnpm exec biome format --write apps/worker/src/doc-extract apps/worker/test/doc-extract-rows.test.ts`). Commit `0045 step 4`.

Test file `apps/worker/test/doc-extract-rows.test.ts`:

```ts
import type { ProtoExtraction } from '@shoebox/extraction';
import type { ProtoCheckResult } from '@shoebox/validation';
import { describe, expect, it } from 'vitest';
import {
  documentPatchOf,
  fieldsOf,
  statusAfterRead,
  validationRowsOf,
  vatSummaryOf,
} from '../src/doc-extract/rows';

const RATES = { standard: 21, reduced: 12 };

function reading(overrides: Partial<ProtoExtraction> = {}): ProtoExtraction {
  return {
    schema_version: 'm02-proto-v3',
    kind_hint: 'invoice',
    document_class: 'received_invoice',
    supplier: { name: 'Dodavatel s.r.o.', ico: '27082440', dic: 'CZ27082440', vat_id: null, country: 'CZ' },
    buyer: { name: null, ico: null, dic: null },
    document: { number: 'FV2026-001', variable_symbol: '2026001' },
    dates: { issue_date: '2026-10-01', duzp: '2026-10-01', due_date: '2026-10-15' },
    currency: 'CZK',
    vat_recap: [{ rate_pct: '21', base: '1000', vat: '210' }],
    totals: { net: '1000', vat: '210', gross: '1210' },
    payment: { account_number: '123456789', bank_code: '0100', iban: null, method: 'bank_transfer' },
    flags: { not_tax_document_text: false, non_vat_payer_text: false, reverse_charge_text: false, paid_text: false },
    not_tax_document: false,
    issues: [],
    ...overrides,
  } as ProtoExtraction;
}

function check(id: string, severity: 'pass' | 'warn' | 'fail'): ProtoCheckResult {
  return { id, severity, key: 'proto.check.x', params: { a: 1 } } as unknown as ProtoCheckResult;
}

describe('documentPatchOf', () => {
  it('maps a full invoice', () => {
    const patch = documentPatchOf(reading());
    expect(patch).toEqual({
      class: 'received_invoice',
      classSource: 'llm',
      direction: 'in',
      taxDocStatus: 'full_tax_document',
      partnerSnapshot: { name: 'Dodavatel s.r.o.', ico: '27082440', dic: 'CZ27082440', vat_id: null, country: 'CZ' },
      buyerSnapshot: null,
      documentNumber: 'FV2026-001',
      variableSymbol: '2026001',
      issueDate: '2026-10-01',
      duzp: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'CZK',
      totalNet: '1000',
      totalVat: '210',
      totalGross: '1210',
      paymentMethod: 'bank_transfer',
      payToAccount: { account: '123456789', bank_code: '0100', iban: null },
      isPaidPerDocument: null,
    });
  });

  it('maps unreadable to unknown, cash on delivery to cod, defaults the currency', () => {
    const patch = documentPatchOf(
      reading({
        document_class: 'unreadable',
        currency: null,
        payment: { account_number: null, bank_code: null, iban: null, method: 'cash_on_delivery' },
        flags: { not_tax_document_text: false, non_vat_payer_text: false, reverse_charge_text: false, paid_text: true },
      }),
    );
    expect(patch.class).toBe('unknown');
    expect(patch.currency).toBe('CZK');
    expect(patch.paymentMethod).toBe('cod');
    expect(patch.payToAccount).toBeNull();
    expect(patch.isPaidPerDocument).toBe(true);
    expect(patch.taxDocStatus).toBe('unknown');
  });

  it('marks a non-tax document', () => {
    expect(documentPatchOf(reading({ not_tax_document: true })).taxDocStatus).toBe('not_tax_document');
  });

  it('a receipt without a recap is unknown', () => {
    const patch = documentPatchOf(reading({ document_class: 'received_receipt', vat_recap: [] }));
    expect(patch.taxDocStatus).toBe('unknown');
  });
});

describe('vatSummaryOf', () => {
  it('types each rate from the rules and sums duplicate rates exactly', () => {
    const rows = vatSummaryOf(
      reading({
        vat_recap: [
          { rate_pct: '21', base: '100.10', vat: '21.02' },
          { rate_pct: '12', base: '50', vat: '6' },
          { rate_pct: '21', base: '0.20', vat: '0.04' },
          { rate_pct: '0', base: '10', vat: '0' },
          { rate_pct: '15', base: '1', vat: '0.15' },
        ],
      }),
      RATES,
    );
    expect(rows).toEqual([
      { vatRateType: 'standard', vatRatePct: '21', base: '100.3', vat: '21.06' },
      { vatRateType: 'reduced', vatRatePct: '12', base: '50', vat: '6' },
      { vatRateType: 'zero', vatRatePct: '0', base: '10', vat: '0' },
      { vatRateType: 'none', vatRatePct: '15', base: '1', vat: '0.15' },
    ]);
  });

  it('is empty without a recap', () => {
    expect(vatSummaryOf(reading({ vat_recap: [] }), RATES)).toEqual([]);
  });
});

describe('fieldsOf', () => {
  it('lists every non-null value with the M02 key grammar, in order', () => {
    const keys = fieldsOf(reading()).map((f) => f.fieldKey);
    expect(keys).toEqual([
      'supplier.name',
      'supplier.ico',
      'supplier.dic',
      'supplier.country',
      'document.number',
      'document.variable_symbol',
      'dates.issue_date',
      'dates.duzp',
      'dates.due_date',
      'currency',
      'totals.net',
      'totals.vat',
      'totals.gross',
      'payment.account_number',
      'payment.bank_code',
      'payment.method',
      'vat_recap[0].rate_pct',
      'vat_recap[0].base',
      'vat_recap[0].vat',
    ]);
    expect(fieldsOf(reading())[1]).toEqual({ fieldKey: 'supplier.ico', valueText: '27082440', source: 'llm' });
  });
});

describe('validationRowsOf and statusAfterRead', () => {
  it('drops passes and maps severities', () => {
    const rows = validationRowsOf([check('vat_sum', 'pass'), check('ico_checksum', 'fail'), check('dic_format', 'warn')]);
    expect(rows).toEqual([
      { ruleId: 'PROTO_ICO_CHECKSUM', ruleVersion: 1, severity: 'blocking', params: { a: 1 } },
      { ruleId: 'PROTO_DIC_FORMAT', ruleVersion: 1, severity: 'warning', params: { a: 1 } },
    ]);
  });

  it('is ready only without a blocking row', () => {
    expect(statusAfterRead(reading(), validationRowsOf([check('dic_format', 'warn')]))).toBe('ready');
    expect(statusAfterRead(reading(), validationRowsOf([check('vat_sum', 'fail')]))).toBe('needs_review');
  });

  it('sends non-documents to supporting and unknown classes to review', () => {
    expect(statusAfterRead(reading({ document_class: 'non_document' }), [])).toBe('supporting');
    expect(statusAfterRead(reading({ document_class: 'unreadable' }), [])).toBe('needs_review');
    expect(statusAfterRead(reading({ document_class: 'unknown' }), [])).toBe('needs_review');
  });
});
```

## 5. Do not touch

`apps/web/**`, `packages/**`, `apps/worker/src/registry.ts`, `apps/worker/src/worker.ts`, migrations. Hard rules 1 and 2.

## 6. Commands

- `pnpm --filter @shoebox/worker test -- doc-extract-rows 2>&1 | tail -30` → all pass.
- `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → no errors.
- `pnpm exec biome ci apps/worker 2>&1 | tail -30` → no errors.

## 7. Acceptance

- [ ] The test file is unchanged and passes.
- [ ] No `parseFloat`, `Number(` on an amount, or `+` on amount strings in `rows.ts` (`Number(rate_pct)` for the rate comparison is allowed).
- [ ] Typecheck and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0045-report.md` (600 tokens at most) and set `Status: review`. The report has the files changed, each command with the last 5 lines of output, §7 ticked, deviations, questions, owner steps left.

## Risk list (for the reviewer)

`apps/worker/src/doc-extract/rows.ts` (money summing, status gate).

## Owner steps

None.
