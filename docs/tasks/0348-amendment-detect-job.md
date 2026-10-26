# 0348: `vat.amendment.detect` job

Status: todo
Ticket: P3-VAT-10 (part b) | Depends on: 0344, 0347 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 55k tokens

## 1. Objective

After a ledger rebuild of a period with a `marked_filed` filing, recompute, diff against the filed snapshot, and when something changed: propose the amendment kind, open a `draft` amendment filing (`amends_filing_id`), upsert the `vat_amendment` / `kh_nasledne` obligation and log `filing.amendment_needed`. Nothing is generated automatically (the user triggers `vat.filing.generate` with the proposed kind; 0351 route).

## 2. Context

M05 §4.11: `vat.amendment.detect` runs after any ledger rebuild of a period with a `marked_filed` filing: compute the new snapshot and `diffFilings(filed, next)`; empty → nothing; otherwise notification `vat.amendment_needed` and an obligation; kind by `chooseAmendmentKind`. `dodatecne` only when the new verdict is `simple`; otherwise workbook + needs accountant. M05 §4.12: `vat_amendment` / `kh_nasledne`: created when a diff is detected, `amount_estimate` = Δ ř.64, done when the amendment is `marked_filed`. M05 §4.2: 0325's rebuild enqueues `vat.period.evaluate`; this brief makes `evaluatePeriod` (0344) enqueue `vat.amendment.detect` when a `marked_filed`, non-superseded filing exists for the period (one line in `service.ts`).

Filed snapshot = `filings.totals` + `filing_documents` (revisions) + `filing_entries` (KH/SH keys rebuilt with `computeKh`/`computeShv` from the snapshot entries via `toEntryDraft`, 0344 `map.ts`) → `FilingSnapshot` (0347). Next snapshot = recompute from the live ledger (reuse the compute part of `generateBundle`: factor out `computePeriod(tx, orgId, periodStart, deps): Promise<{ status, period, classifier, dp3, kh | null, shvByMonth, ledger, ledgerHash } | { skipped }>` in `service.ts` and call it from both `generateBundle` and this job; behaviour of 0344 unchanged, its tests must stay green).

Obligation kinds: DPHDP3 → `vat_amendment` (period = filing period), DPHKH1 → `kh_nasledne`; `due_date` from the proposal; `amount_estimate` = `next.row64 − filed.row64` (may be negative); `source_rule` = `'m05.amendment.v1'`; `filing_id` = the draft amendment filing. Draft amendment filing: `insertFiling` with `kind = proposal.kind`, `state 'draft'`, `amends_filing_id`, `discovered_on`, `simple_check` = classifier result, `totals = { ledgerHash, diff, proposal }`; if an open filing with that `(type, periodStart, kind)` exists already, update its `totals`/`simple_check` instead (`setFilingState(..., 'draft', …)` plus a new `updateFilingTotals` helper in `packages/db/src/filings.ts`: add it there, 10 lines). `needs_accountant` proposal (amend of dodatečné) or non-simple verdict → no draft; enqueue `vat.workbook.generate`; log `filing.amendment_needs_accountant`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/vat/service.ts` | edit | factor `computePeriod`; enqueue detect from `evaluatePeriod` |
| `apps/worker/src/vat/amendment-detect.ts` | create | `detectAmendments(tx, orgId, periodStart, deps): Promise<DetectResult>` + `createVatAmendmentDetectHandler` |
| `apps/worker/src/vat/register.ts` | edit | register the job |
| `packages/db/src/filings.ts` | edit | `updateFilingTotals(tx, orgId, filingId, totals, simpleCheck)` |
| `apps/worker/test/amendment-detect.test.ts` | create | below |

## 4. Steps

1. Refactor `service.ts` (no behaviour change): `pnpm --filter @shoebox/worker test -- filing-lifecycle 2>&1 | tail -30` stays green.
2. `amendment-detect.ts` exports exactly:
```ts
export type DetectResult = { readonly outcome: 'no_filing' | 'no_change' } | { readonly outcome: 'amendment_proposed'; readonly form: 'DPHDP3' | 'DPHKH1' | 'DPHSHV'; readonly kind: FilingKind; readonly draftFilingId: string; readonly dueDate: LegalDate; readonly diff: FilingDiff } | { readonly outcome: 'needs_accountant'; readonly reason: string };
export async function detectAmendments(tx: TenantTx, orgId: string, periodStart: LegalDate, deps: VatDeps & { readonly today?: () => LegalDate }): Promise<DetectResult[]>;   // one result per filed form of the period
export function createVatAmendmentDetectHandler(deps: VatDeps): TenantHandler<VatAmendmentDetectPayload>;
```
3. Test with the 0344 in-memory store (export its factory from the 0344 test into `apps/worker/test/helpers/vat-store.ts` if not already a helper; moving it is allowed, keep 0344's test green): seed a `marked_filed` DPHDP3 for August IO (filed snapshot: row 5 13 700/2 877, document `b` rev 1, entries), then:
   - unchanged ledger → `no_change`, no filing inserted;
   - ledger now also has a Cloudflare-like row-12 entry (new document `c`) and `today = 2026-09-22` (≤ 25 Sep deadline) → `amendment_proposed` `opravne`, draft filing with `amends_filing_id`, obligation `vat_amendment` due `2026-09-25`, amount `52.00`;
   - same with `today = 2026-11-10` → `dodatecne`, `discovered_on = 2026-11-10`, due `2026-12-31`, `totals.proposal.row66 === 52`;
   - filed filing kind `dodatecne` → `needs_accountant`, workbook enqueued;
   - verdict not simple (add an `iss_domestic_vat` line) → `needs_accountant`.
   Command: `pnpm --filter @shoebox/worker test -- amendment-detect 2>&1 | tail -30`.
4. Commit `feat(worker): vat.amendment.detect (0348)`.

## 5. Do not touch

Serializers, migrations, `apps/web`.

## 6. Commands

`pnpm --filter @shoebox/worker test -- amendment-detect filing-lifecycle 2>&1 | tail -30` · `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` · `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Five cases green; 0344 tests unchanged; `evaluatePeriod` enqueues detect only when a filed filing exists.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0348-report.md`.

## Risk list

`amendment-detect.ts`, the `service.ts` refactor.

## Owner steps

None.
