# 0364: Worker jobs `podklady.generate`, `podklady.reserve.refresh` (+ nightly), income-tax obligations

Status: todo
Ticket: P4-POD-05 (service), P4-POD-03 (obligations job) | Depends on: 0358, 0359, 0360, 0361, 0363, 0343 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

The podklady generation service as a pg-boss job (idempotent per ledger hash and answers version, M06 §6, §4.13), the reserve refresh (debounced on ledger rebuild, nightly fan-out) that also upserts the income-tax obligations, and their registration. No screen, no e-mail, no submission.

## 2. Context

M06 §6 jobs (pasted):
```ts
'podklady.generate':        { orgId, year ≥ 2024, answersVersion: int, requestedBy: uuid }   // idempotency {org}:podklady:{year}:{ledgerBuildHash}:{answersVersion}
'podklady.reserve.refresh': { orgId, reason: 'ledger_rebuilt' | 'nightly' | 'profile_changed' }   // debounce 60 s per org; nightly 02:30 Europe/Prague fan-out
```
Job definitions live in `packages/pipeline/src/jobs.ts` (`defineTenantJob`, `defineSystemJob`, `tenantPayload`, see `ledgerRebuildOrgJob` / `ledgerVerifyJob` at the end of the file; add the new names to `JOB_NAMES` at the top). Worker registration: `apps/worker/src/ledger/register.ts` shows `registerLedgerJobs(registry, db, logger)`; `apps/worker/src/main.ts` calls it (`registerLedgerJobs(registry, db, logger);`): add `registerPodkladyJobs(registry, db, logger);` on the next line. Handlers get `(payload, ctx)` with `ctx.tx` (tenant) per `apps/worker/src/registry.ts` (`TenantHandler`, `TenantJobContext`).

**Answers hand-over:** the route (0365) stores the wizard answers as a `PODKLADY_DPFO` filing in state `draft` with `inputs = answers` and `totals = { answersVersion }`; the job reads that draft (`listFilings(tx, orgId, { periodStart: '⟨year⟩-01-01', types: ['PODKLADY_DPFO'], states: ['draft'] })`, the one whose `totals.answersVersion` matches), falls back to `EMPTY_ANSWERS`, and supersedes the draft when done.

**Generate flow** (`generatePodklady(tx, orgId, payload, deps)`):
1. `rows = readPodkladyRows(tx, orgId, year, LEDGER_ALGO_VERSION)` (0363); `latest = latestPodkladyFiling(tx, orgId, year)`.
2. Idempotency: if `latest` is in `generated|downloaded|marked_filed` and `latest.totals.ledgerHash === rows.ledgerHash` and `latest.totals.answersVersion === payload.answersVersion` → return `{ filingId: latest.id, created: false }` (nothing written).
3. `summary = buildPodkladySummary({ year, taxpayer: rows.taxpayer, profiles, entries, assetLines, privateUse, vatFilings, transactions, readiness, answers, partialXmlAvailable: false }, deps.rules, today)`. `blocked` → return `{ filingId: null, created: false, blocked: true }` (the preview shows the blocking check).
4. `pdf = await buildPodkladyPdf(summary, deps.translate)`, `xlsx = buildPodkladyXlsx(summary, { appOrigin, label }, now)`; PDF failure: retry 3× in-process, then continue with the XLSX only and log `podklady.pdf_failed` (M06 §8 #12).
5. `insertPodkladyFiling(tx, orgId, { year, totals: { ledgerHash, answersVersion, regime, headline: {income, expenses, base}, incomeTotal, deductibleTotal, privatePart }, answers, answersVersion, pdfPath: null, xlsxPath: null, generatedBy, at }, rows)` → `filingId`; `blobs.put(blobPath(orgId, 'filings', filingId, 'podklady-⟨year⟩.pdf'), pdf, PDF_MIME)` and the `.xlsx` with `XLSX_MIME`; `setFilingState(tx, orgId, filingId, 'generated', { pdfPath, xlsxPath })`. The draft and any older open podklady are superseded by `insertPodkladyFiling` (0363).
6. Log `podklady.generated { orgId, year, filingId, created: true }` (no amounts, no names).

**Reserve refresh** (`refreshReserve(tx, serviceTx, orgId, reason, deps)`): `year = today.year`; `rows = readPodkladyRows(...)`; regime/rates from the segment covering today; `estimate = computeTaxReserve({ year, regime, pausalRate, pausalDanBand, entries: rows.entries, payments: rows.transactions }, rules, today)`; `null` → delete nothing, write nothing; else `upsertReserveEstimate(serviceTx, orgId, { asOf: today, taxYear: year, kind, payload: serialize(estimate), ledgerHash })`. Then obligations: `drafts = incomeTaxObligationsFor({ year, profiles, advances: tax_pausal_advance transactions, pausalniDanReturnRequired: (PD ? checkPausalniDan(...).returnRequired : false), eligibleForEntry: regime ≠ PD && no 'platce' segment && incomeTotal ≤ pausalni_dan.eligibility.max_income }, today, rules)` → `upsertVatObligations(tx, orgId, drafts, 1)` (0343; widen its `drafts` parameter type to `ReadonlyArray<Omit<ObligationDraft, 'kind'> & { kind: string; isOptional?: boolean; note?: string | null }>` — one-line edit in `packages/db/src/filings.ts`; `kind` is `text` in the table; write `is_optional` when the column exists (0044 has it)). Debounce: pass `singletonSeconds: 60` (or the registry's equivalent) when enqueuing `podklady.reserve.refresh`; if the registry has no such option, the `entityId` `reserve-${reason}` dedupes queued-but-not-started jobs and you note it in the report.

**Nightly** (`podklady.reserve.nightly`, system job, cron `30 2 * * *` Europe/Prague as the registry schedules it): fan out one `podklady.reserve.refresh { reason: 'nightly' }` per active organization (the pattern of `createLedgerVerifyHandler` for iterating orgs under the service role).

**Hook:** in `apps/worker/src/ledger/handler.ts`, where `createLedgerRebuildDocumentHandler` awaits `rebuildDocument(...)` (grep `rebuildDocument(` for the one call inside the handler), add after it: `await deps.enqueue(podkladyReserveRefreshJob, { orgId: payload.orgId, reason: 'ledger_rebuilt' })` (the `Enqueue` type in that file; if `LedgerDeps` has no `enqueue` for the document handler, add it as optional and skip when absent). The 60 s debounce makes a rebuild of 200 documents one refresh.

Money in JSON: `serialize(x)` = `JSON.parse(JSON.stringify(x, (_, v) => (v instanceof Money ? v.toFixed2() : v)))`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/src/jobs.ts` | edit | `podkladyGenerateJob`, `podkladyReserveRefreshJob`, `podkladyReserveNightlyJob` + names in `JOB_NAMES` |
| `packages/pipeline/test/jobs.test.ts` | edit | add the three names to the existing "every job name is defined" case if there is one; else one `it` that parses a valid and an invalid payload of each |
| `apps/worker/src/podklady/generate.ts` | create | `PodkladyDeps`, `generatePodklady`, `createPodkladyGenerateHandler` |
| `apps/worker/src/podklady/reserve.ts` | create | `refreshReserve`, `createReserveRefreshHandler`, `createReserveNightlyHandler` |
| `apps/worker/src/podklady/register.ts` | create | `registerPodkladyJobs(registry, db, logger)` wiring `dbPodkladyDeps` (real `@shoebox/db` functions, `createSupabaseBlobStore`, `createCzRules()`, en.json translate via `@shoebox/i18n`) |
| `apps/worker/src/main.ts` | edit | one line after `registerLedgerJobs(registry, db, logger);` |
| `apps/worker/src/ledger/handler.ts` | edit | the enqueue hook |
| `packages/db/src/filings.ts` | edit | widen `upsertVatObligations` drafts type |
| `apps/worker/test/podklady-job.test.ts` | create | below |

## 4. Steps

1. Job defs + pipeline test. `pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30`.
2. `generate.ts` exports exactly:
```ts
export interface PodkladyStore {
  readRows(tx: TenantTx, orgId: string, year: number, buildVersion: bigint): Promise<PodkladyRows>;
  latestFiling(tx: TenantTx, orgId: string, year: number): Promise<FilingRow | null>;
  listDrafts(tx: TenantTx, orgId: string, year: number): Promise<FilingRow[]>;
  insertFiling(tx: TenantTx, orgId: string, input: PodkladyFilingInsert, rows: PodkladyRows): Promise<{ filingId: string; supersededIds: string[] }>;
  setPaths(tx: TenantTx, orgId: string, filingId: string, paths: { pdfPath: string | null; xlsxPath: string | null }): Promise<void>;
  readReserve(tx: TenantTx, orgId: string): Promise<ReserveRow | null>;
  upsertReserve(orgId: string, row: Omit<ReserveRow, 'computedAt'>): Promise<void>;          // service role inside
  upsertObligations(tx: TenantTx, orgId: string, drafts: readonly IncomeTaxObligationDraft[]): Promise<number>;
  listActiveOrgIds(): Promise<string[]>;
}
export interface PodkladyDeps { readonly store: PodkladyStore; readonly blobs: Pick<BlobStore, 'put'>; readonly rules: CzRules; readonly now: () => Date; readonly appOrigin: string; readonly translate: Translate; readonly logger: Logger; readonly enqueue: Enqueue }
export interface GenerateResult { readonly filingId: string | null; readonly created: boolean; readonly blocked: boolean; readonly pdfFailed: boolean }
export async function generatePodklady(tx: TenantTx, orgId: string, payload: PodkladyGeneratePayload, deps: PodkladyDeps): Promise<GenerateResult>;
export function createPodkladyGenerateHandler(deps: PodkladyDeps): TenantHandler<PodkladyGeneratePayload>;
```
3. `reserve.ts`: `refreshReserve(tx, orgId, reason, deps): Promise<{ kind: 'estimate' | 'pausalni_dan' | 'none'; obligations: number }>`, the two handler factories.
4. Test file (fake store in memory, fake blobs recording `put` calls, fixed clock `2027-02-10T09:00:00Z`, fixture rows = the S2 input of 0359's test mapped to `PodkladyRows` with `ledgerHash 'h1'`, two documents):
```ts
describe('podklady.generate', () => {
  it('first run: one generated filing, PDF and XLSX put under org/{org}/filings/{filingId}/podklady-2026.{pdf,xlsx}, paths set, totals carry ledgerHash and answersVersion', …);
  it('same ledger hash and answers version → created=false, no new filing, no blob put', …);
  it('ledger hash h2 → a new filing; the old one is superseded (store records supersedeOpenFilings)', …);
  it('a draft with answers {comparisonRate: 80} is used: totals.headline.base is 880000.00 for the S2 rows; draft superseded', …);
  it('blocked (ucetnictvi profile) → nothing written, blocked=true', …);
  it('PDF builder throws 3× → filing still generated with xlsxPath only, pdfFailed=true (inject a failing buildPodkladyPdf through deps.pdf if you add it; otherwise make the blob put of the pdf throw)', …);
});
describe('podklady.reserve.refresh', () => {
  it('DE org: upsertReserve called with kind estimate, taxYear 2027 (today), payload.display a string; dap obligation upserted for 2027: legal 2028-05-01, due 2028-05-02 (1 May is a public holiday)', …);
  it('PD org: kind pausalni_dan; 12 pausalni_dan_advance obligations for 2027', …);
  it('nightly fan-out enqueues one refresh per active org with reason nightly', …);
});
```
If `shiftDate` in the holiday table gives another date for 2028, stop and report (the 2028 holidays may be missing from `calendar.cz_public_holidays`). Command: `pnpm --filter @shoebox/worker test -- podklady-job 2>&1 | tail -30`.
5. `register.ts`, `main.ts` line, the ledger hook. `pnpm --filter @shoebox/worker test -- ledger-rebuild 2>&1 | tail -30` stays green (the fake deps there may need `enqueue` to be optional).
6. Typechecks: worker, pipeline, db. Commit `feat(worker): podklady.generate, reserve refresh, income-tax obligations (0364)`.

## 5. Do not touch

`apps/worker/src/vat/*` (0344), `packages/domain`, screens.

## 6. Commands

`pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30` · `pnpm --filter @shoebox/worker test -- podklady-job 2>&1 | tail -30` · `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Same inputs → no new filing (M06 §9 P4-POD-05 first half); blob paths `org/{org}/filings/{filing}/podklady-{year}.pdf|.xlsx`; reserve row written; `dap` and advances upserted; no amount or name in any log line.

## 8. Stop and ask

TEMPLATE §8. Stop if 0343's `filings.ts` or 0363's `podklady.ts` is missing.

## 9. Report

`docs/tasks/0364-report.md`. State whether the registry supports a 60 s debounce.

## Risk list

Idempotency key (double generation wastes storage, never money); obligations writer (single writer rule: lane C until M09's generator).

## Owner steps

1. Decisions line: "2026-10-26 podklady answers travel as a draft PODKLADY_DPFO filing (inputs), never in the job payload; the changed-after-handoff notice is computed live by the preview (no notifications table yet)".
