# 0363: Podklady database I/O (`packages/db/src/podklady.ts`)

Status: todo
Ticket: P4-POD-05 (data) | Depends on: 0343 (`filings.ts`: `insertFiling`, `supersedeOpenFilings`, `ledgerHashOf`, `listFilings`), 0362 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 24 tool calls, 60k tokens

## 1. Objective

Every read the podklady need for one org and year, mapped to the domain input types of 0359, plus the writes: the `PODKLADY_DPFO` filing (with `filing_documents` snapshot), and the reserve cache. All queries org-scoped under the tenant transaction (`TenantTx`). The `filings_inputs_no_rc` constraint is proven by a test.

## 2. Context

Domain input (`PodkladyInput`, 0359) needs: `profiles` (taxpayer_profiles overlapping the year → `ProfileSegment`), `entries` (`tax_ledger_entries where tax_year = year` → `AnnualTotalsEntry`, decimal columns `::text`), `assetLines` (document_lines with `category_code in ('asset_long_term','exp_small_assets')` on documents `status in ('ready','finalized')`, not deleted, with `paid_at` or `issue_date` in the year; partner name via `partners`; `vatDeducted` = the document's `deduction_allowed` and the profile at `issue_date` is `platce`; `paidInYear` = Σ `business_amount_czk`… no: Σ `amount_czk` of the line's non-provisional ledger entries in the year; `carFlag` = the document has another line with `category_code like 'exp_car_%'` or `'exp_fuel'`), `privateUse` (documents `business_flag='personal'` paid in the year; lines with `0 < business_share_pct < 100` on bookable finalized documents; `review_questions` of kind `car_regime` with their answer), `vatFilings` (M05 filings of the year: `type in ('DPHDP3')`, `totals.row64`, `state`), `transactions` (`category_code in (tax_vat_payment, tax_income_payment, tax_pausal_advance, ins_social_own, ins_health_own, tax_other_fees)` with `booked_on` in the year; `amount` signed → pass as is, the domain takes absolutes), `readiness` counts: `ledger.staleEntries` = entries with `build_version < currentBuildVersion` (parameter), `documentsFinalizedAfterBuild` = documents finalized after the newest entry's build (0324 stores build metadata; if there is no such column, pass 0 and `TODO(ledger-stale)`), `pendingDocuments` = bookable documents with `issue_date` or `paid_at` in the year and `status not in ('ready','finalized')`, `unpaidIssued` = `class='issued_invoice'`, `issue_date ≤ year end`, `paid_at is null`, `unexplainedTransactions` = `transactions` outgoing (`amount < 0`), `match_state='unmatched'`, `booked_on` in the year (count, Σ |amount|), `businessFlagUnknown` = documents `business_flag='unknown'` paid in the year (count, Σ gross). Column names: read `packages/db/src/schema/documents.ts`, `document-details.ts`, `ledgers.ts`, `tenancy.ts`, and migration `0020_money.sql` (transactions) — grep the names you use; do not guess.

Writes: `PODKLADY_DPFO` filing = `supersedeOpenFilings(tx, orgId, 'PODKLADY_DPFO', '⟨year⟩-01-01', 'radne')` then `insertFiling(tx, { type: 'PODKLADY_DPFO', kind: 'radne', periodStart, periodEnd: '⟨year⟩-12-31', state: 'generated', totals, inputs: answers, pdfPath, xlsxPath, generatedAt, generatedBy, simpleCheck: null }, documents, entries)` where `documents` = distinct `(documentId, revision)` of the contributing entries. `totals` snapshot = `{ ledgerHash, answersVersion, headline: { income, expenses, base }, incomeTotal, deductibleTotal, privatePart, regime }` (strings). `ledgerHash = ledgerHashOf(entries)` (0343). Reserve cache: `upsertReserveEstimate(serviceTx, orgId, row)` and `readReserveEstimate(tx, orgId)` on `tax_reserve_estimates` (0362).

Factories: `taxLedgerEntryFactory`, `taxpayerProfileFactory`, `documentFactory`/line factories, `filingFactory` (`packages/testkit/src/factories/index.ts`). Harness: `packages/db/test/ledger-rebuild.db.test.ts` (0324) shows a tenant-transaction test with factories; copy its connection setup.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/podklady.ts` | create | signatures below |
| `packages/db/src/index.ts` | edit | `export * from './podklady';` |
| `packages/db/test/podklady.db.test.ts` | create | below |

## 4. Steps

1. `podklady.ts` exports exactly:
```ts
import type { AnnualTotalsEntry, AssetLineInput, PodkladyAnswers, PodkladyTransaction, PrivateUseInput, ProfileSegment, ReadinessInput, VatNoteInput } from '@shoebox/domain';
export interface PodkladyRows {
  readonly profiles: ProfileSegment[]; readonly entries: AnnualTotalsEntry[]; readonly assetLines: AssetLineInput[];
  readonly privateUse: PrivateUseInput; readonly vatFilings: VatNoteInput['vatFilings']; readonly transactions: PodkladyTransaction[];
  readonly readiness: Omit<ReadinessInput, 'year' | 'profiles'>; readonly taxpayer: { legalName: string; ico: string | null };
  readonly ledgerHash: string; readonly documents: ReadonlyArray<{ documentId: string; revision: number }>;
}
export async function readPodkladyRows(tx: TenantTx, orgId: string, year: number, currentBuildVersion: bigint): Promise<PodkladyRows>;
export interface PodkladyFilingInsert { readonly year: number; readonly totals: Record<string, unknown>; readonly answers: PodkladyAnswers; readonly answersVersion: number; readonly pdfPath: string | null; readonly xlsxPath: string | null; readonly generatedBy: string; readonly at: Date }
export async function insertPodkladyFiling(tx: TenantTx, orgId: string, input: PodkladyFilingInsert, rows: PodkladyRows): Promise<{ filingId: string; supersededIds: string[] }>;
export async function latestPodkladyFiling(tx: TenantTx, orgId: string, year: number): Promise<FilingRow | null>;   // newest non-superseded PODKLADY_DPFO of the year
export interface ReserveRow { readonly asOf: string; readonly taxYear: number; readonly kind: 'estimate' | 'pausalni_dan'; readonly payload: unknown; readonly ledgerHash: string | null; readonly computedAt: Date }
export async function readReserveEstimate(tx: TenantTx, orgId: string): Promise<ReserveRow | null>;
export async function upsertReserveEstimate(tx: ServiceTx, orgId: string, row: Omit<ReserveRow, 'computedAt'>): Promise<void>;
```
Money fields come out as decimal strings; dates as `YYYY-MM-DD` strings cast to `LegalDate` with `parseLegalDate`. Every query has `org_id = $orgId` even under RLS (rule 3; the static tenant check `scripts/lint` enforces it).
2. Test (db, two orgs A and B, tenant session of A):
```ts
describe('readPodkladyRows', () => {
  it('returns A\'s 2026 entries and profiles only; B\'s rows and 2027 entries are absent; ledgerHash stable across two reads', …);
  it('asset lines: an asset_long_term line paid in 2026 with its partner name and paidInYear; an exp_small_assets line; a 2025 line absent', …);
  it('readiness counts: one pending document, one unpaid issued invoice, one unmatched outgoing transaction with its sum', …);
  it('transactions: only the six tax/insurance categories of the year, signed as stored', …);
});
describe('insertPodkladyFiling', () => {
  it('creates a generated PODKLADY_DPFO filing for 2026-01-01..2026-12-31 with filing_documents for every contributing document; a second insert supersedes the first', …);
  it('latestPodkladyFiling returns the newest non-superseded one', …);
  it('general 5: inputs containing rodneCislo / rod_c / rodne_cislo are rejected by filings_inputs_no_rc (raw insert through the tx)', …);
});
describe('reserve cache', () => {
  it('upsert as the worker, read as A; B reads null; second upsert replaces the row', …);
});
```
Command: `pnpm --filter @shoebox/db test -- podklady 2>&1 | tail -30`.
3. Index export; `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`.
4. Commit `feat(db): podklady rows, filing insert, reserve cache (0363)`.

## 5. Do not touch

`filings.ts` (use it), migrations, `apps/`.

## 6. Commands

`pnpm --filter @shoebox/db test -- podklady 2>&1 | tail -30` · `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` · `python3 scripts/context_lint.py 2>&1 | tail -3` is the orchestrator's; the tenant SQL lint runs in CI.

## 7. Acceptance

- [ ] Every read is org-scoped and tested against a second org; the RČ constraint test fails the insert; filing + filing_documents in one transaction.

## 8. Stop and ask

TEMPLATE §8. Stop if `packages/db/src/filings.ts` does not exist (0343 not merged): report blocked, do not write your own filing insert.

## 9. Report

`docs/tasks/0363-report.md`. List every column name you relied on from `0020_money.sql` (transactions) so the orchestrator can check 05.

## Risk list

RLS, the ledger hash (idempotency of 0364 rests on it).

## Owner steps

None.
