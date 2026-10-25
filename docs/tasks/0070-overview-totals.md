# 0070: Přehled income and expense totals (pure)

Status: review
Ticket: P1-OVERVIEW (M09 §4.1, §4.3, §4.4.1 turnover) | Depends on: none | Base commit: 37d843b | Branch: task/0070-overview-totals | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add a pure function in `packages/domain` that turns a year's documents into this month's and this year's income and expenses, the VAT-registration turnover and the "still waiting for review" count. The Přehled screen (brief 0074) shows these numbers, so they must be exact (`Money`, never a float).

## 2. Context

Rules (AGENTS.md hard rule 1): money is `Money` (`packages/domain/src/money`), never a JS number. No wall clock in the domain: `asOf` is passed in.

M09 §4.1, simplified for Phase 1 (no M04 ledger yet):

- COUNTED_STATUSES = `ready`, `finalized`. PENDING_STATUSES = `received`, `splitting`, `classifying`, `extracting`, `validating`, `categorizing`, `needs_review`.
- BOOKABLE_CLASSES = `received_invoice`, `received_receipt`, `received_credit_note`, `received_advance_tax_doc`, `issued_invoice`, `issued_credit_note`, `platform_statement`.
- INCOME effect = `taxable_income`. EXPENSE effects = `deductible_expense`, `non_deductible_expense`, `asset`. Every other effect is ignored.
- Document date: `platform_statement` → first non-null of `servicePeriodTo`, `issueDate`, `receivedDate`; every other class → first non-null of `duzp`, `issueDate`, `receivedDate`.
- A document is **counted** when: not deleted, status counted, class bookable, `businessFlag` is `business` or `mixed`, the document date is not null, it has at least one line whose `lineType` is not `text`, every non-text line has a `taxEffect` and an amount (below), and a non-CZK document has an `fxRate`.
- A document is **pending** when: not deleted, class bookable, `businessFlag` is not `personal`, status is counted or pending, it is not counted, and its date is null or inside the year to date. `pending.grossCzk` adds `totalGross` (× `fxRate` when not CZK); skip a document whose `totalGross` is null or that needs a missing rate.
- Line amount in CZK: `base = vatStatus === 'platce' ? net : (gross ?? net)`; null base → the document is not counted. × `fxRate` when `currency !== 'CZK'`. For `received_credit_note` and `issued_credit_note` the amount is `−|amount|` (credit notes always lower the total, whatever sign was printed). Then × `businessSharePct / 100`.
- Periods: `month` = first day of `asOf`'s month to `asOf`; `ytd` = 1 January of `asOf`'s year to `asOf`, both inclusive. Dates after `asOf` count nowhere.
- Turnover (VAT registration meter, M09 §4.4.1): over counted documents with `direction = 'out'` in the ytd period, add every line with `taxEffect = 'taxable_income'`, amount `net ?? gross` (× fx, credit-note sign as above, **no** business share), except when the line's `vatTreatment` is one of `iss_eu_service`, `iss_eu_goods`, `iss_non_eu_service`, `iss_export_goods`, `iss_exempt`, or the partner is foreign B2B (`partnerCountry` not null and not `CZ`, and `partnerVatId` not null). Put the treatment list in a `const` with the comment `// TODO(verify): move to rule key vat.registration_turnover_policy (M09 §4.4.1)`.

Money API (`packages/domain/src/money/money.ts`): `Money.parse('1210.00', 'CZK')`, `Money.zero('CZK')`, `.add`, `.subtract`, `.negate`, `.abs`, `.multiply('24.3')` (string or Decimal), `.divide('100')`, `.isNegative()`, `.toFixed2()`. Types: `LegalDate` from `../dates/index` (a `YYYY-MM-DD` string; plain string comparison orders it). Enum types from `../enums/index`: `DocumentStatus`, `DocumentClass`, `Direction`, `LineType`, `TaxEffect`, `VatStatus`, `VatTreatment`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/overview/totals.ts` | create | types + `overviewDocDate`, `computeOverviewTotals` |
| `packages/domain/test/overview-totals.test.ts` | create | the test file below, verbatim |

No other file may change (`src/index.ts` is wired by brief 0073).

## 4. Steps

1. Create `packages/domain/test/overview-totals.test.ts` with exactly this content:

```ts
import { describe, expect, it } from 'vitest';
import { type LegalDate, parseLegalDate } from '../src/dates/index';
import {
  computeOverviewTotals,
  type OverviewDocument,
  type OverviewLine,
  overviewDocDate,
} from '../src/overview/totals';

const d = (s: string): LegalDate => parseLegalDate(s);
const asOf = d('2026-10-25');

function line(over: Partial<OverviewLine> = {}): OverviewLine {
  return {
    lineType: 'item',
    net: '1000.00',
    gross: '1210.00',
    vatTreatment: null,
    taxEffect: 'deductible_expense',
    businessSharePct: '100',
    ...over,
  };
}

function doc(over: Partial<OverviewDocument> = {}): OverviewDocument {
  return {
    status: 'ready',
    class: 'received_invoice',
    direction: 'in',
    businessFlag: 'business',
    deleted: false,
    duzp: d('2026-10-10'),
    issueDate: null,
    receivedDate: null,
    servicePeriodTo: null,
    currency: 'CZK',
    fxRate: null,
    totalGross: '1210.00',
    partnerCountry: 'CZ',
    partnerVatId: null,
    lines: [line()],
    ...over,
  };
}

function income(over: Partial<OverviewDocument> = {}, l: Partial<OverviewLine> = {}) {
  return doc({
    class: 'issued_invoice',
    direction: 'out',
    lines: [line({ taxEffect: 'taxable_income', ...l })],
    ...over,
  });
}

describe('overviewDocDate', () => {
  it('uses DUZP, then the issue date, then the received date', () => {
    expect(overviewDocDate(doc())).toBe('2026-10-10');
    expect(overviewDocDate(doc({ duzp: null, issueDate: d('2026-09-01') }))).toBe('2026-09-01');
    expect(overviewDocDate(doc({ duzp: null, receivedDate: d('2026-08-01') }))).toBe('2026-08-01');
    expect(overviewDocDate(doc({ duzp: null }))).toBeNull();
  });

  it('uses the end of the service period for platform statements', () => {
    const statement = doc({
      class: 'platform_statement',
      servicePeriodTo: d('2026-09-30'),
      issueDate: d('2026-10-02'),
    });
    expect(overviewDocDate(statement)).toBe('2026-09-30');
  });
});

describe('computeOverviewTotals', () => {
  it('returns zeros without documents', () => {
    const t = computeOverviewTotals([], 'neplatce', asOf);
    expect(t.month.income.toFixed2()).toBe('0.00');
    expect(t.month.expenses.toFixed2()).toBe('0.00');
    expect(t.ytd.income.toFixed2()).toBe('0.00');
    expect(t.ytd.expenses.toFixed2()).toBe('0.00');
    expect(t.turnoverYtd.toFixed2()).toBe('0.00');
    expect(t.countedCount).toBe(0);
    expect(t.pending.count).toBe(0);
    expect(t.pending.grossCzk.toFixed2()).toBe('0.00');
  });

  it('a non-payer counts gross amounts, a VAT payer counts net', () => {
    const docs = [doc(), income()];
    const non = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(non.ytd.expenses.toFixed2()).toBe('1210.00');
    expect(non.ytd.income.toFixed2()).toBe('1210.00');
    const io = computeOverviewTotals(docs, 'identifikovana_osoba', asOf);
    expect(io.ytd.expenses.toFixed2()).toBe('1210.00');
    const payer = computeOverviewTotals(docs, 'platce', asOf);
    expect(payer.ytd.expenses.toFixed2()).toBe('1000.00');
    expect(payer.ytd.income.toFixed2()).toBe('1000.00');
  });

  it('splits this month from the year to date and ignores later and earlier years', () => {
    const docs = [
      doc({ duzp: d('2026-10-01') }),
      doc({ duzp: d('2026-03-15') }),
      doc({ duzp: d('2026-10-26') }),
      doc({ duzp: d('2025-12-31') }),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.month.expenses.toFixed2()).toBe('1210.00');
    expect(t.ytd.expenses.toFixed2()).toBe('2420.00');
    expect(t.countedCount).toBe(2);
  });

  it('counts only ready and finalized documents of bookable classes', () => {
    const docs = [
      doc(),
      doc({ status: 'finalized' }),
      doc({ status: 'needs_review' }),
      doc({ status: 'duplicate' }),
      doc({ status: 'supporting' }),
      doc({ class: 'order_confirmation' }),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.ytd.expenses.toFixed2()).toBe('2420.00');
    expect(t.countedCount).toBe(2);
    expect(t.pending.count).toBe(1);
    expect(t.pending.grossCzk.toFixed2()).toBe('1210.00');
  });

  it('leaves out personal and deleted documents; an unknown business flag is pending', () => {
    const docs = [
      doc({ businessFlag: 'personal' }),
      doc({ deleted: true }),
      doc({ businessFlag: 'unknown' }),
      doc({ businessFlag: 'mixed' }),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.ytd.expenses.toFixed2()).toBe('1210.00');
    expect(t.countedCount).toBe(1);
    expect(t.pending.count).toBe(1);
  });

  it('applies the business share, counts assets and non-deductible costs, skips text lines', () => {
    const lines = [
      line({ businessSharePct: '50' }),
      line({ taxEffect: 'asset', gross: '100000.00' }),
      line({ taxEffect: 'non_deductible_expense', gross: '10.00' }),
      line({ taxEffect: 'private', gross: '999.00' }),
      line({ lineType: 'text', net: null, gross: null, taxEffect: null }),
    ];
    const t = computeOverviewTotals([doc({ lines })], 'neplatce', asOf);
    expect(t.ytd.expenses.toFixed2()).toBe('100615.00');
  });

  it('credit notes always lower the total, whatever sign was printed', () => {
    const docs = [
      doc(),
      doc({ class: 'received_credit_note', lines: [line({ gross: '-210.00' })] }),
      doc({ class: 'received_credit_note', lines: [line({ gross: '210.00' })] }),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.ytd.expenses.toFixed2()).toBe('790.00');
  });

  it('converts foreign currency with the document rate; a missing rate makes it pending', () => {
    const eur = { currency: 'EUR', totalGross: '100.00', lines: [line({ gross: '100.00' })] };
    const t = computeOverviewTotals(
      [doc({ ...eur, fxRate: '24.300000' }), doc({ ...eur, fxRate: null })],
      'neplatce',
      asOf,
    );
    expect(t.ytd.expenses.toFixed2()).toBe('2430.00');
    expect(t.countedCount).toBe(1);
    expect(t.pending.count).toBe(1);
    expect(t.pending.grossCzk.toFixed2()).toBe('0.00');
  });

  it('an uncategorized line makes the whole document pending', () => {
    const t = computeOverviewTotals(
      [doc({ lines: [line(), line({ taxEffect: null })] })],
      'neplatce',
      asOf,
    );
    expect(t.ytd.expenses.toFixed2()).toBe('0.00');
    expect(t.countedCount).toBe(0);
    expect(t.pending.count).toBe(1);
    expect(t.pending.grossCzk.toFixed2()).toBe('1210.00');
  });

  it('a document without a date is pending; a pending one from last year is not', () => {
    const docs = [
      doc({ status: 'extracting', duzp: null }),
      doc({ status: 'needs_review', duzp: d('2025-11-01') }),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.pending.count).toBe(1);
  });

  it('turnover counts domestic taxable income net, without foreign B2B and EU lines', () => {
    const docs = [
      income({}, { net: '1000.00', gross: '1210.00' }),
      income({}, { vatTreatment: 'iss_eu_service', net: '500.00', gross: '500.00' }),
      income({ partnerCountry: 'DE', partnerVatId: 'DE123456789' }, { net: '300.00', gross: '300.00' }),
      income({ partnerCountry: 'DE', partnerVatId: null }, { net: '200.00', gross: '200.00' }),
      income({ duzp: d('2025-12-01') }, { net: '7000.00', gross: '7000.00' }),
      doc(),
    ];
    const t = computeOverviewTotals(docs, 'neplatce', asOf);
    expect(t.turnoverYtd.toFixed2()).toBe('1200.00');
    expect(t.ytd.income.toFixed2()).toBe('2210.00');
  });
});
```

2. Create `packages/domain/src/overview/totals.ts` exporting exactly:

```ts
export interface OverviewLine {
  readonly lineType: LineType;
  readonly net: string | null;            // decimal literal, as stored (numeric(15,2))
  readonly gross: string | null;
  readonly vatTreatment: VatTreatment | null;
  readonly taxEffect: TaxEffect | null;   // categories.tax_effect of the line's category; null = not categorized
  readonly businessSharePct: string;      // '100'
}
export interface OverviewDocument {
  readonly status: DocumentStatus;
  readonly class: DocumentClass;
  readonly direction: Direction | null;
  readonly businessFlag: 'business' | 'personal' | 'mixed' | 'unknown';
  readonly deleted: boolean;
  readonly duzp: LegalDate | null;
  readonly issueDate: LegalDate | null;
  readonly receivedDate: LegalDate | null;
  readonly servicePeriodTo: LegalDate | null;
  readonly currency: string;
  readonly fxRate: string | null;
  readonly totalGross: string | null;
  readonly partnerCountry: string | null;
  readonly partnerVatId: string | null;
  readonly lines: readonly OverviewLine[];
}
export interface PeriodTotals { readonly income: Money; readonly expenses: Money }
export interface OverviewTotals {
  readonly month: PeriodTotals;
  readonly ytd: PeriodTotals;
  readonly turnoverYtd: Money;
  readonly countedCount: number;          // counted documents dated in the ytd period
  readonly pending: { readonly count: number; readonly grossCzk: Money };
}
export function overviewDocDate(doc: OverviewDocument): LegalDate | null;
export function computeOverviewTotals(
  docs: readonly OverviewDocument[],
  vatStatus: VatStatus,
  asOf: LegalDate,
): OverviewTotals;
```

Implement §2 until the tests pass. Do not edit the test file. A file header comment names M09 §4.1/§4.3 and says Phase 1 sums document lines directly until M04's ledger kernel exists.
Command: `pnpm --filter @shoebox/domain test -- overview-totals 2>&1 | tail -30` → all tests pass.

3. Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no errors. Then `pnpm exec biome check packages/domain 2>&1 | tail -30` → clean (run `pnpm exec biome check --write packages/domain/src/overview packages/domain/test/overview-totals.test.ts` once if it only reports formatting).

## 5. Do not touch

`packages/domain/src/index.ts`, `packages/domain/src/rules/`, every other package. Hard rules 1 (Money, no float; no `Number()` on amounts) and 8.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- overview-totals 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors.
- `python3 scripts/context_lint.py 2>&1 | tail -30` → OK (after the report).

## 7. Acceptance

- [ ] The test file is byte-identical to §4 step 1 and passes.
- [ ] No `number` arithmetic on money in `totals.ts` (only `Money` methods).
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

Write `docs/tasks/0070-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you were unsure about.
