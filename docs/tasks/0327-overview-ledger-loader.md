# 0327: Přehled from ledgers (b): the loader reads `tax_ledger_entries` (`apps/web`, query only)

Status: done
Ticket: P1-LEDG-03 ("ledgers feed Přehled") | Depends on: 0326 (merged), 0313 (tables exist) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 45k tokens

## 1. Objective

`loadOverview` adds one org-scoped PostgREST query over `tax_ledger_entries` for the current year and hands the rows to `computeLedgerTotals`/`mergeOverviewTotals` (0326), so the Přehled meters and the month/ytd figures come from the ledger as soon as it exists. Screen and components are lane D's; this brief changes the data path only and keeps `OverviewView` backwards compatible (`totals` gains `source` and `provisional`).

## 2. Context

- `apps/web/src/overview/load.ts` (read it whole: 93 lines): three queries under the user's session (RLS), fail-closed `try/catch`, then `buildOverviewView({profile, documents, asOf, rules})`. `apps/web/src/overview/rows.ts`: `DOCUMENTS_SELECT` with `::text` casts for numerics (ADR-007) and `toOverviewDocument(row): OverviewDocument | null` (zod-parsed, a bad row → null). `apps/web/src/overview/view.ts`: `buildOverviewView` computes `totals = computeOverviewTotals(...)` and feeds `totals.ytd.income` / `totals.turnoverYtd` to `computeLimitMeters`.
- Ledger select: `entry_date, basis, tax_effect, business_amount_czk::text` from `tax_ledger_entries` with `.eq('org_id', orgId)`, `.gte('entry_date', `${year}-01-01`)`, `.lte('entry_date', asOf)`, `.limit(20000)`. Users have select on the table (0313 RLS). A query error or a row that does not parse → treated as no ledger rows (the document totals then apply, 0326 merge rule), never an error page.
- `OverviewTotals` consumers: `apps/web/app/(app)/prehled/page.tsx` and components read `totals.month/ytd/turnoverYtd/pending/countedCount`; adding fields is compatible. The meters must now use the merged `ytd.income` (ledger when present).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/overview/ledger.ts` | create | `LEDGER_SELECT`, `toLedgerEntry` |
| `apps/web/src/overview/view.ts` | edit | accept `ledgerEntries`, merge totals |
| `apps/web/src/overview/load.ts` | edit | the fourth query |
| `apps/web/test/overview-ledger.test.ts` | create | the test below, verbatim |

## 4. Steps

1. Create `apps/web/src/overview/ledger.ts` exporting exactly:
```ts
import type { LedgerTotalsEntry } from '@shoebox/domain';
/** PostgREST select for `tax_ledger_entries` (numeric cast to text, ADR-007). */
export const LEDGER_SELECT = 'entry_date, basis, tax_effect, business_amount_czk::text';
/** One row → entry; null when the row does not parse (unknown effect/basis, bad date or amount). */
export function toLedgerEntry(row: unknown): LedgerTotalsEntry | null;
```
   Parse with zod like `rows.ts` does (`z.enum` over `TAX_EFFECT_VALUES` and the three bases; date `^\d{4}-\d{2}-\d{2}$` then `parseLegalDate`; amount `^-?\d+(\.\d{1,2})?$`).

2. Edit `apps/web/src/overview/view.ts`. Anchor (import block): add `computeLedgerTotals, mergeOverviewTotals, type LedgerTotalsEntry, type MergedOverviewTotals` to the `@shoebox/domain` import. Anchor `  readonly totals: OverviewTotals;` in `OverviewView` → `  readonly totals: MergedOverviewTotals;`. Anchor `  readonly documents: readonly OverviewDocument[];` in the `buildOverviewView` input → add below `  readonly ledgerEntries?: readonly LedgerTotalsEntry[];`. Anchor `  const totals = computeOverviewTotals(documents, profile?.vatStatus ?? 'neplatce', asOf);` → replace with:
```ts
  const documentTotals = computeOverviewTotals(documents, profile?.vatStatus ?? 'neplatce', asOf);
  const totals = mergeOverviewTotals(documentTotals, computeLedgerTotals(input.ledgerEntries ?? [], asOf));
```
   Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors (fix `OverviewTotals` import if now unused); `pnpm --filter @shoebox/web test -- overview-view 2>&1 | tail -30` → unchanged (no ledger rows → document totals).

3. Edit `apps/web/src/overview/load.ts`: add `import { LEDGER_SELECT, toLedgerEntry } from './ledger';` and `type LedgerTotalsEntry` to the domain import; extend `LoadedRows` with `readonly ledgerEntries: readonly LedgerTotalsEntry[]` (and `NO_DATA` with `ledgerEntries: []`); after the `documentsResult` query add:
```ts
    const ledgerResult = await supabase
      .from('tax_ledger_entries')
      .select(LEDGER_SELECT)
      .eq('org_id', orgId)
      .gte('entry_date', `${year}-01-01`)
      .lte('entry_date', asOf)
      .limit(20000);
```
   and, after the documents loop: `const ledgerEntries: LedgerTotalsEntry[] = []; if (ledgerResult.error === null && Array.isArray(ledgerResult.data)) for (const row of ledgerResult.data) { const e = toLedgerEntry(row); if (e !== null) ledgerEntries.push(e); }`; set `rows = { profile, documents, ledgerEntries }` and pass `ledgerEntries: rows.ledgerEntries` to `buildOverviewView`. Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.

4. Create `apps/web/test/overview-ledger.test.ts` verbatim; implement until it passes, do not edit it:
```ts
import { createCzRules, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { LEDGER_SELECT, toLedgerEntry } from '../src/overview/ledger';
import { toOverviewDocument, toOverviewProfile } from '../src/overview/rows';
import { buildOverviewView } from '../src/overview/view';

const rules = createCzRules();
const asOf = parseLegalDate('2026-10-25');

describe('toLedgerEntry', () => {
  it('parses a row and rejects bad ones', () => {
    expect(toLedgerEntry({ entry_date: '2026-10-05', basis: 'payment', tax_effect: 'taxable_income', business_amount_czk: '50000.00' })).toEqual({ entryDate: '2026-10-05', basis: 'payment', taxEffect: 'taxable_income', businessAmountCzk: '50000.00' });
    expect(toLedgerEntry({ entry_date: '2026-10-05', basis: 'payment', tax_effect: 'taxable_income', business_amount_czk: 50000 })).toBeNull();
    expect(toLedgerEntry({ entry_date: '05.10.2026', basis: 'payment', tax_effect: 'taxable_income', business_amount_czk: '1.00' })).toBeNull();
    expect(toLedgerEntry({ entry_date: '2026-10-05', basis: 'cash', tax_effect: 'taxable_income', business_amount_czk: '1.00' })).toBeNull();
    expect(toLedgerEntry(null)).toBeNull();
    expect(LEDGER_SELECT).toContain('business_amount_czk::text');
  });
});

describe('buildOverviewView with ledger rows', () => {
  const docRow = { status: 'ready', class: 'issued_invoice', direction: 'out', business_flag: 'business', deleted_at: null, duzp: '2026-10-05', issue_date: '2026-10-05', received_date: null, service_period_to: null, currency: 'CZK', fx_rate: null, total_gross: '1000.00', partners: { country: 'CZ', vat_id: null }, document_lines: [{ line_type: 'item', net: '1000.00', gross: '1000.00', vat_treatment: null, business_share_pct: '100.00', categories: { tax_effect: 'taxable_income' } }] };
  const profileRow = { vat_status: 'neplatce', vat_period: null, tax_regime: 'pausalni_vydaje', pausal_rate: 60, pausal_dan_band: null, has_accountant: false };
  const documents = [toOverviewDocument(docRow)!];
  const profile = toOverviewProfile(profileRow, true);

  it('takes month/ytd from the ledger and keeps turnover and counted from documents', () => {
    const view = buildOverviewView({ profile, documents, asOf, rules, ledgerEntries: [toLedgerEntry({ entry_date: '2026-10-05', basis: 'payment', tax_effect: 'taxable_income', business_amount_czk: '800.00' })!, toLedgerEntry({ entry_date: '2026-02-01', basis: 'document_evidence', tax_effect: 'deductible_expense', business_amount_czk: '300.00' })!] });
    expect(view.totals.source).toBe('ledger');
    expect(view.totals.ytd.income.toString()).toBe('800');
    expect(view.totals.ytd.expenses.toString()).toBe('300');
    expect(view.totals.month.income.toString()).toBe('800');
    expect(view.totals.turnoverYtd.toString()).toBe('1000');
    expect(view.totals.countedCount).toBe(1);
  });
  it('without ledger rows the document totals apply', () => {
    const view = buildOverviewView({ profile, documents, asOf, rules });
    expect(view.totals.source).toBe('documents');
    expect(view.totals.ytd.income.toString()).toBe('1000');
  });
});
```
   `Money.toString()` prints plain notation without trailing zeros (`'800'`, `'1234.56'`); the expectations above rely on that.
   Command: `pnpm --filter @shoebox/web test -- overview-ledger 2>&1 | tail -30` → all pass; `pnpm --filter @shoebox/web test -- overview 2>&1 | tail -30` → the existing overview tests still pass.

## 5. Do not touch

`apps/web/app/(app)/prehled/*`, components, `rows.ts`, `format.ts` (lane D). Hard rules 1, 3 (`.eq('org_id', orgId)` on the new query), 6 (no copy here).

## 6. Commands

`pnpm --filter @shoebox/web test -- overview 2>&1 | tail -30`; `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`.

## 7. Acceptance

- [ ] New and existing overview tests pass; typecheck clean. - [ ] The ledger query carries the org filter and the year window.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0327-report.md`. Tell lane D: `totals.source === 'documents'` means the ledger has not been built yet for this year (hint text is theirs).

## Risk list

`view.ts` merge (meters must read the merged ytd income).

## Owner steps

None.
