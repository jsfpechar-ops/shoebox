# 0344: `vat.period.evaluate` and `vat.filing.generate` (worker service, handlers, registration)

Status: todo
Ticket: P3-VAT-09 (part b) | Depends on: 0332, 0335, 0338, 0339, 0343 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Sonnet 5.5 (reason: orchestration of many pure parts; second-attempt risk) | Fits one session: 30 tool calls, 70k tokens

## 1. Objective

The worker side of M05 §4.11: evaluate a period (classifier verdict + obligations), and generate a filing bundle all-or-nothing on XSD validity (DPHDP3 for an IO; DPHDP3 + DPHKH1 + DPHSHV per month for a payer), with snapshots, idempotency on the ledger hash and supersession of open filings. Never submits anywhere (AGENTS rule 8).

## 2. Context

M05 §4.11 (pasted): Generate (`vat.filing.generate`): in one DB transaction: classifier → computation → XML → XSD → write files → insert `filing_documents` and `filing_entries` → `totals = { rows: {"5": {"base": 13700, "tax": 2877}, …}, kh: {...}, shv: [...] }` → state `generated`. Idempotency key `{org}:{type}:{period_start}:{kind}:{ledger_build_hash}`; same hash → return the existing filing. Payers: DPHDP3 + DPHKH1 (+ DPHSHV for each month of the period with SH entries) are a **bundle** (same `generated_at`, same `bundle_id`); KH and DP3 must both be XSD-valid or neither becomes `generated`. Regenerate before filing: open filings for the same `(type, period_start, kind)` → `superseded`. Invalid XSD → state stays `draft`, `xsd_valid=false`, errors saved, maintainer alert (`logger.warn({event:'tax_xml_invalid'})`), no user download. Until the official XSD is vendored (0336): `method === 'structural'` → `xsd_valid = null`, state `draft` (`TODO(decision-xsd)`). Filing XML is never generated unless the verdict is `simple`. `vat.period.evaluate` runs after every ledger rebuild of a period (0325's handler enqueues it) and computes verdict + obligations; it refreshes a `draft` filing only when no `generated|downloaded` filing is open for the period (otherwise 0348 amendment detection owns the diff). `needs_accountant` → enqueue `vat.workbook.generate` (0350). Family: `IO` when status `identifikovana_osoba`, else `PAYER`. Events: log `filing.state_changed {filingId, from, to}` (M09 turns it into notifications later).

Pieces to wire (all exist): `readPeriodLedger, insertFiling, supersedeOpenFilings, listFilings, setFilingState, upsertVatObligations, ledgerHashOf` (0343, `@shoebox/db`); `classifyPeriod, PeriodClassifierInput` (0331/0332), `computeDphdp3` (0333), `computeKh, computeShv` (0334), `reconcileKhDp3` (0335), `buildEpoHeader, missingVetaP` (0329), `vatObligationsFor, vatDueDate, periodEndOf` (0330), `resolveVatPeriod`/`periodFor` (0305, `VatProfileSlice`), `createCzRules`, `Money`, `parseLegalDate` (`@shoebox/domain`); `serializeDphdp3, serializeKh, serializeShv, validateXml` (`@shoebox/tax-xml`); `vatPeriodEvaluateJob, vatFilingGenerateJob, vatWorkbookGenerateJob` (`@shoebox/pipeline`); `BlobStore.put(path, bytes, contentType)` and `createSupabaseBlobStore` (`@shoebox/platform`); `JobRegistry`, `TenantHandler` (`../registry`); `LedgerDeps.enqueue` and the rebuild handler in `apps/worker/src/ledger/handler.ts` (0325). Row → domain mapping: numeric strings → `Money.parse(s, 'CZK')`, dates → `parseLegalDate`, enums cast after a `z.enum` check (never `as any` without a check; unknown value → throw with the column name, no document content).

Blob paths: `org/{orgId}/filings/{bundleId}/{FORM}.xml` (`application/xml`). `form_version` = `'DPHDP3 03.01.04'` from `epo.forms` (0328). `verzePis` from the same rule. Status of the period = profile overlapping `periodStart` (latest `validFrom ≤ periodStart`). `appVersion` = `process.env.SHOEBOX_APP_VERSION ?? '0.0.0'`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/vat/map.ts` | create | pure row→domain mapping |
| `apps/worker/src/vat/service.ts` | create | `evaluatePeriod`, `generateBundle` |
| `apps/worker/src/vat/register.ts` | create | handlers + `registerVatJobs` |
| `apps/worker/src/main.ts` | edit | `registerVatJobs(registry, process.env, logger);` after the ledger line |
| `apps/worker/src/ledger/handler.ts` | edit | after a successful `rebuildDocument` with `changed: true`: for each `periodsAffected` start enqueue `vatPeriodEvaluateJob { orgId, periodStart, family }` (family from the document's profile status: `deps.familyFor?.(tx, orgId, periodStart)` default `'IO'` when unknown → keep simple: add `familyFor` to `LedgerDeps` as optional with default `async () => 'PAYER'`); one line + the dep, nothing else |
| `apps/worker/test/filing-lifecycle.test.ts` | create | below |

## 4. Steps

1. `map.ts` exports exactly:
```ts
export function toEntryDraft(row: PeriodEntryRow): VatLedgerEntryDraft;
export function toClassifierInput(ledger: PeriodLedger, status: VatStatus, period: { start: LegalDate; end: LegalDate }, evaluatedAt: string): PeriodClassifierInput;   // ledgerIssues: [] (ledger issues are recomputed by 0325's build and will be joined later: TODO(0325-issues))
export function toEpoProfile(p: ProfileVersionRow, status: VatStatus): EpoTaxpayerProfile;
export function profileAt(profiles: readonly ProfileVersionRow[], date: LegalDate): ProfileVersionRow | null;
export function khLookup(ledger: PeriodLedger): KhDocumentLookup;
```
2. `service.ts` exports exactly:
```ts
export interface VatStore { readonly readPeriodLedger: typeof readPeriodLedger; readonly insertFiling: typeof insertFiling; readonly supersedeOpenFilings: typeof supersedeOpenFilings; readonly listFilings: typeof listFilings; readonly setFilingState: typeof setFilingState; readonly upsertVatObligations: typeof upsertVatObligations }
export const dbVatStore: VatStore;
export type Validate = typeof validateXml;
export interface VatDeps { readonly store?: VatStore; readonly blobs: Pick<BlobStore, 'put'>; readonly rules?: ReturnType<typeof createCzRules>; readonly logger: Pick<Logger, 'info' | 'warn'>; readonly now?: () => number; readonly appVersion?: string; readonly validate?: Validate; readonly enqueue: <P extends { orgId: string }>(def: TenantJobDefinition<P>, payload: P) => Promise<string | null> }
export interface EvaluateResult { readonly verdict: SimpleVerdict; readonly family: 'IO' | 'PAYER'; readonly ledgerHash: string; readonly draftFilingId: string | null; readonly obligations: number }
export async function evaluatePeriod(tx: TenantTx, orgId: string, periodStart: LegalDate, deps: VatDeps): Promise<EvaluateResult | { readonly skipped: 'no_profile' | 'not_vat_registered' }>;
export type GenerateOutcome = { readonly outcome: 'generated' | 'draft_invalid_xsd' | 'draft_unvalidated'; readonly bundleId: string; readonly filingIds: readonly string[] } | { readonly outcome: 'not_simple'; readonly verdict: SimpleVerdict; readonly draftFilingId: string | null } | { readonly outcome: 'exists'; readonly filingIds: readonly string[] } | { readonly outcome: 'header_missing'; readonly missing: readonly string[] } | { readonly outcome: 'skipped'; readonly reason: 'no_profile' | 'not_vat_registered' | 'nothing_to_file' };
export interface GenerateRequest { readonly periodStart: LegalDate; readonly kind: FilingKind; readonly amendsFilingId?: string; readonly discoveredOn?: LegalDate; readonly requestedBy: string }
export async function generateBundle(tx: TenantTx, orgId: string, req: GenerateRequest, deps: VatDeps): Promise<GenerateOutcome>;
```
`generateBundle` order: ledger → profile → period (`periodFor(periodStart, slice)`; IO = month) → classify → not simple → refresh draft (supersede older draft only; insert draft with `simpleCheck`, `totals: { ledgerHash }`) + enqueue workbook when `needs_accountant` → return. Simple → `ledgerHash`; existing open `generated|downloaded` DPHDP3 for `(periodStart, kind)` whose `totals.ledgerHash === ledgerHash` → `exists` (all filings of its `bundleId`). Else header (`buildEpoHeader`; `!ok` → `header_missing`/`skipped`), compute DP3; payer: KH + `reconcileKhDp3` (not ok → throw: maintainer bug, dead-letter), SH per month in the period with SH entries; serialize; validate each; `allXsd = every r.valid && r.method === 'xsd'`; `anyInvalid = some !r.valid`; state = `allXsd ? 'generated' : 'draft'`; `xsdValid = anyInvalid ? false : allXsd ? true : null`; write blobs only when `!anyInvalid`; `supersedeOpenFilings` per form; `insertFiling` per form with `bundleId` (one `crypto.randomUUID()`), `generatedAt = new Date(now)`, `totals` = `{ ledgerHash, rounding, rows: {row: {base, tax}} (numbers, whole Kč), row62..row65 (numbers), trans, kh: { a2: n, a4: n, a5: bool, b2: n, b3: bool, c: {…} } | null, shv: [{ monthStart, rows: n, total }] | null }`; snapshots = all entries/documents of the period for DPHDP3 and DPHKH1, the month's SH entries for DPHSHV. Then `upsertVatObligations(vatObligationsFor(...))` with `periods` built from the computation (`row64/row65`, `hasReturnRows`, `shMonths`) and `filings` from `listFilings`. Log `filing.state_changed` per filing and `tax_xml_invalid` (warn) when `anyInvalid`. Return `generated` / `draft_invalid_xsd` / `draft_unvalidated`.
3. `register.ts`: `createVatPeriodEvaluateHandler(deps)`, `createVatFilingGenerateHandler(deps)` (payload → `generateBundle(ctx.tx, …)`; result logged at info), `registerVatJobs(registry, env, logger): boolean` (needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` for the blob store; warns and returns false otherwise; `enqueue` = `registry.enqueue`).
4. main.ts + ledger handler hook. `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`.
5. Test `filing-lifecycle.test.ts`: an in-memory `VatStore` (arrays; `supersedeOpenFilings` flips states; `listFilings` filters), `blobs.put` recorder, `validate` stub (`{ valid: true, method: 'xsd', xsdAvailable: true, errors: [] }` by default), `enqueue` recorder, fixed `now`. Fixtures: the P4 August IO ledger (one entry row Booking 13699.77/2876.95, document finalized, profile IO from 2026-01-01 with the 0329 FULL header fields) and a payer September ledger (0334's SEP rows incl. SH). Cases (each an `it`):
   - August IO: `generateBundle` → `generated`, one filing, `totals.rows['5']` = `{ base: 13700, tax: 2877 }`, `row64: 2877`, blob path `org/<org>/filings/<bundleId>/DPHDP3.xml`, XML contains `p_sl23_e="13700"`, snapshot has 1 document / 1 entry, obligations upserted (`vat_return` 2026-09-25, `vat_payment` 2877).
   - Same again → `exists` with the same filing id (#11 idempotency); after bumping `buildVersion` of the entry → new filing, the old one `superseded`, unique slot respected (store asserts at most one open per key).
   - Payer September: three filings share a `bundleId`; KH XML has `VetaC obrat23="26529.00"`; SH filing for 2026-09.
   - KH invalid (validate stub returns invalid for `DPHKH1`): all three stay `draft`, `xsd_valid = false` on KH, no blobs written, `tax_xml_invalid` warned (bundle all-or-nothing).
   - Structural-only validation (`method: 'structural'`): state `draft`, `xsd_valid = null`, outcome `draft_unvalidated`.
   - `needs_accountant` (IO with an `iss_domestic_vat` line): `not_simple`, draft filing carries `simple_check.checks` with `S_IO_OUTPUT_VAT`, workbook job enqueued.
   - `evaluatePeriod` on the IO ledger: verdict simple, draft created; with an open generated filing present: no new draft; obligations count ≥ 1.
   - Missing `fu_code` → `header_missing: ['fu_code']`, nothing written.
   Command: `pnpm --filter @shoebox/worker test -- filing-lifecycle 2>&1 | tail -30`.
6. Commit `feat(worker): vat.period.evaluate and vat.filing.generate (0344)`.

## 5. Do not touch

`packages/*` (import only), `apps/web`, `worker.ts`. No HTTP call to any tax authority host; no `epo_podani`.

## 6. Commands

`pnpm --filter @shoebox/worker test -- filing-lifecycle 2>&1 | tail -30` · `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` · `pnpm --filter @shoebox/worker test -- ledger-rebuild 2>&1 | tail -30` (unchanged after the hook)

## 7. Acceptance

- [ ] The eight cases green; typecheck clean; `main.ts` registers the jobs; ledger rebuild enqueues `vat.period.evaluate`.
- [ ] `grep -rn 'mojedane\|epo_podani' apps/worker/src` → empty.

## 8. Stop and ask

TEMPLATE §8; `reconcileKhDp3` failing on a fixture (report the issue list).

## 9. Report

`docs/tasks/0344-report.md`.

## Risk list

`service.ts` (writes filings), `map.ts` (type casts), ledger hook.

## Owner steps

None (download/mark-filed routes: 0345).
