# 0343: Filing I/O (`packages/db/src/filings.ts`) and the M05 job definitions

Status: todo
Ticket: P3-VAT-09 (part a) | Depends on: 0342, 0330 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

The database side of the filing lifecycle: read everything a period needs (ledger entries, documents, profile versions, a ledger build hash), insert a filing with its document and entry snapshots, supersede open filings, mark filed, upsert VAT obligations; plus the four pg-boss job definitions of M05 §6. No computation here (0344 does that).

## 2. Context

M05 §4.11 (pasted): Generate: insert `filing_documents (document_id, document_revision)` and `filing_entries` (entry-level snapshot) → `totals` → state `generated`. Idempotency key `{org}:{type}:{period_start}:{kind}:{ledger_build_hash}`; same hash → return the existing filing. Regenerate before filing: any open filing (`draft|generated|downloaded`) for the same `(type, period_start, kind)` → `superseded`; new row created. Mark filed: allowed from `generated|downloaded`; sets `marked_filed_at`, `filed_on`, `submission_ref`, obligation → `done`; if the filing is `opravne`, the filing it amends → `superseded`.

M05 §6 jobs (verbatim payloads):
```ts
'vat.period.evaluate':   z.object({ orgId: z.string().uuid(), periodStart: z.string().date(), family: z.enum(['IO','PAYER']) })
'vat.filing.generate':   z.object({ orgId: z.string().uuid(), periodStart: z.string().date(), kind: z.enum(['radne','opravne','dodatecne','nasledne']), amendsFilingId: z.string().uuid().optional(), discoveredOn: z.string().date().optional(), requestedBy: z.string().uuid() })
'vat.workbook.generate': z.object({ orgId: z.string().uuid(), periodStart: z.string().date(), requestedBy: z.string().uuid().optional() })
'vat.amendment.detect':  z.object({ orgId: z.string().uuid(), periodStart: z.string().date() })
```
In this repo payloads are built with `tenantPayload({...})` (adds `orgId`) and `defineTenantJob({ name, payload, version: 1, entityId })` (`packages/pipeline/src/jobs.ts`; names are already in `JOB_NAMES`). `entityId`: `periodStart` for evaluate/workbook/detect; `${periodStart}:${kind}` for generate. Use `z.uuid()` / `z.iso.date()` as the file already does for similar fields (copy the local idiom).

Tables (Drizzle, 0342 + existing): `vatLedgerEntries` (`packages/db/src/schema/ledgers.ts`: `documentId, periodStart, periodEnd, vatPointDate, vatPointRule, lineId, vatTreatment, vatRateType, vatRatePct, baseCzk, vatCzk, deductionPct, currency, baseForeign, fxRate, fxAmount, fxRateDate, dphdp3Rows, khSection, khDocumentTotalCzk, shvCode, counterpartyVatId, evidenceNumber, buildVersion`), `documents` (`id, revision, class, status, taxDocStatus, businessFlag, vatPointDate, issueDate, duzp, documentNumber, partnerId, deletedAt`), `documentLines` (`lineType, vatTreatment, vatRateType, businessSharePct, rcCommodityCode, categoryCode, coveredByDocumentId`), `documentLinks` (`fromDocumentId, toDocumentId, kind` — `corrects` link kind: check `DOC_LINK_KIND_VALUES` in `@shoebox/domain` enums for the exact name), `partners` (`dic, vatId, country`; no VIES flag column → `vatIdValid: null` for now, `TODO(P1-REG)`), `validationResults` (grep its columns for severity/open state: `grep -n "severity\|resolved\|state" packages/db/src/schema/document-details.ts`), `taxpayerProfiles` (`validFrom, validTo, vatStatus, vatPeriod, entityType, dic, firstName, lastName, title, address, fuCode, ufoCode, mainActivityNace, filingEmail, filingPhone, foreignServiceDppdPolicy`), `filings`, `filingDocuments`, `filingEntries`, `obligations` (0342). `TenantTx` from `./tenant`; every query is already org-scoped by RLS, add `eq(table.orgId, orgId)` anyway (rule 3). `VatEntryRow` type: `packages/db/src/ledger-rebuild.ts` (0324).

Ledger build hash: `sha256(hex)` of `JSON.stringify(entries.map(e => [e.documentId, e.buildVersion]).sort())` → the "ledger hash" of M05 (changes whenever any document of the period is rebuilt).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/src/jobs.ts` | edit | append `vatPeriodEvaluateJob`, `vatFilingGenerateJob`, `vatWorkbookGenerateJob`, `vatAmendmentDetectJob` (+ payload types) after the ledger jobs |
| `packages/db/src/filings.ts` | create | below |
| `packages/db/src/index.ts` | edit | `export * from './filings';` |
| `packages/db/test/filings.db.test.ts` | create | below |

## 4. Steps

1. jobs.ts. `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30`; `pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30`.
2. `filings.ts` exports exactly:
```ts
export interface PeriodEntryRow extends VatEntryRow { readonly documentId: string; readonly documentRevision: number; readonly buildVersion: string }
export interface PeriodLineRow { readonly lineType: string; readonly vatTreatment: string | null; readonly vatRateType: string; readonly businessSharePct: string; readonly rcCommodityCode: string | null; readonly categoryCode: string | null; readonly linkedIssuedInvoiceId: string | null /* coveredByDocumentId */ }
export interface PeriodDocumentRow { readonly id: string; readonly revision: number; readonly class: string; readonly status: string; readonly taxDocStatus: string; readonly businessFlag: string; readonly vatPointDate: string | null; readonly issueDate: string | null; readonly duzp: string | null; readonly documentNumber: string | null; readonly partner: { readonly dic: string | null; readonly vatId: string | null; readonly country: string | null; readonly vatIdValid: boolean | null; readonly documentShowsDic: boolean } | null; readonly correctsDocumentId: string | null; readonly correctsVatPointDate: string | null; readonly hasBlockingValidation: boolean; readonly lines: readonly PeriodLineRow[] }
export interface ProfileVersionRow { readonly validFrom: string; readonly validTo: string | null; readonly vatStatus: string; readonly vatPeriod: string | null; readonly entityType: string; readonly dic: string | null; readonly firstName: string | null; readonly lastName: string | null; readonly title: string | null; readonly address: unknown; readonly fuCode: string | null; readonly ufoCode: string | null; readonly mainActivityNace: string | null; readonly filingEmail: string | null; readonly filingPhone: string | null; readonly foreignServiceDppdPolicy: string }
export interface PeriodLedger { readonly entries: readonly PeriodEntryRow[]; readonly documents: readonly PeriodDocumentRow[]; readonly profiles: readonly ProfileVersionRow[]; readonly ledgerHash: string }
export function ledgerHashOf(entries: ReadonlyArray<{ documentId: string; buildVersion: string }>): string;
/** Entries with period_start = periodStart; documents = those entries' documents ∪ documents (not deleted, bookable class) whose coalesce(vat_point_date, duzp, issue_date) is in [periodStart, periodEnd]; profiles overlapping the period, ordered by valid_from. `documentShowsDic` = partnerSnapshot?.dic present (documents.partner_snapshot jsonb) — false when unknown. */
export async function readPeriodLedger(tx: TenantTx, orgId: string, periodStart: string, periodEnd: string): Promise<PeriodLedger>;
export interface FilingRow { readonly id: string; readonly type: string; readonly kind: string; readonly origin: string; readonly periodStart: string; readonly periodEnd: string; readonly state: string; readonly amendsFilingId: string | null; readonly bundleId: string | null; readonly formVersion: string | null; readonly totals: unknown; readonly simpleCheck: unknown; readonly xmlPath: string | null; readonly pdfPath: string | null; readonly xlsxPath: string | null; readonly xsdValid: boolean | null; readonly xsdErrors: unknown; readonly generatedAt: string | null; readonly markedFiledAt: string | null; readonly filedOn: string | null; readonly submissionRef: string | null; readonly discoveredOn: string | null; readonly sourceDocumentId: string | null }
export interface FilingInsert { readonly orgId: string; readonly type: string; readonly kind: string; readonly origin?: 'generated' | 'imported'; readonly sourceDocumentId?: string | null; readonly periodStart: string; readonly periodEnd: string; readonly state: string; readonly amendsFilingId?: string | null; readonly bundleId?: string | null; readonly formVersion?: string | null; readonly totals: unknown; readonly simpleCheck: unknown; readonly xmlPath?: string | null; readonly pdfPath?: string | null; readonly xlsxPath?: string | null; readonly xsdValid?: boolean | null; readonly xsdErrors?: unknown; readonly generatedAt?: Date | null; readonly generatedBy?: string | null; readonly discoveredOn?: string | null; readonly markedFiledAt?: Date | null; readonly filedOn?: string | null }
export async function supersedeOpenFilings(tx: TenantTx, orgId: string, type: string, periodStart: string, kind: string): Promise<string[]>;   // ids now superseded
export async function insertFiling(tx: TenantTx, filing: FilingInsert, documents: ReadonlyArray<{ documentId: string; revision: number }>, entries: readonly PeriodEntryRow[]): Promise<string>;   // one transaction: filings + filing_documents + filing_entries
export async function readFiling(tx: TenantTx, orgId: string, filingId: string): Promise<FilingRow | null>;
export async function listFilings(tx: TenantTx, orgId: string, filter: { periodStart?: string; types?: readonly string[]; states?: readonly string[] }): Promise<FilingRow[]>;   // newest generated_at first
export async function readFilingEntries(tx: TenantTx, orgId: string, filingId: string): Promise<PeriodEntryRow[]>;
export async function setFilingState(tx: TenantTx, orgId: string, filingId: string, state: string, patch?: { xmlPath?: string | null; pdfPath?: string | null; xlsxPath?: string | null; xsdValid?: boolean | null; xsdErrors?: unknown }): Promise<boolean>;
export async function markFilingFiled(tx: TenantTx, orgId: string, filingId: string, input: { filedOn: string; submissionRef?: string | null; at: Date }): Promise<'ok' | 'not_found' | 'wrong_state'>;   // generated|downloaded → marked_filed; opravne → amended filing superseded
export async function upsertVatObligations(tx: TenantTx, orgId: string, drafts: readonly ObligationDraft[], generatorVersion: number): Promise<number>;   // on conflict (org_id, kind, period_start) update due dates, amount, state (never downgrade 'done' set by a user: `done_source = 'user'` rows keep state), filing_id untouched, updated_at = now()
export async function completeObligation(tx: TenantTx, orgId: string, kind: string, periodStart: string, filingId: string, at: Date): Promise<boolean>;   // state 'done', done_source 'filing'
```
`ObligationDraft` from `@shoebox/domain` (0330); Money → `toFixed2()` strings for `numeric` columns.
3. Test (skipIf no DB; setup like 0340 with org `dddddddd-…-0343`, one document with revision 1, two `vat_ledger_entries` rows for 2026-08 inserted with the service connection, one profile row). Cases:
```ts
it('readPeriodLedger returns entries, documents, profiles and a stable hash', …)  // hash equal on two reads; differs after updating build_version of one entry
it('insertFiling writes the three tables; supersedeOpenFilings frees the slot; readFiling/listFilings read back', …)
it('markFilingFiled: draft → wrong_state; generated → ok sets filed_on and submission_ref; opravne supersedes the amended filing', …)
it('upsertVatObligations inserts then updates; a user-done row is not reopened; completeObligation marks done by filing', …)
```
Write the four tests fully (≤ 120 lines) with the helpers of `ledgers.db.test.ts`. Command: `pnpm --filter @shoebox/db test -- filings 2>&1 | tail -30`.
4. Index export; typecheck; commit `feat(db): filing I/O and M05 job definitions (0343)`.

## 5. Do not touch

Migrations, schema files, `ledger-rebuild.ts`.

## 6. Commands

`pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30` · `pnpm --filter @shoebox/db test -- filings 2>&1 | tail -30` · `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Four job definitions validate the M05 payloads (add one `it` to `packages/pipeline/test/jobs.test.ts` only if that file has a per-job table; otherwise skip).
- [ ] db tests green or skipped-without-DB (reported); typecheck clean.

## 8. Stop and ask

TEMPLATE §8; a column named in §2 missing from the schema (report the real name, do not guess).

## 9. Report

`docs/tasks/0343-report.md`.

## Risk list

`filings.ts` (snapshots are what amendments diff against).

## Owner steps

None.
