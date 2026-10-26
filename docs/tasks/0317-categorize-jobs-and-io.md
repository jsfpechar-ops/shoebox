# 0317: P1-CAT-04a job definitions (`doc.categorize`, `ledger.*`) and the categorize DB I/O

Status: done
Ticket: P1-CAT-04, P1-LEDG-03 | Depends on: 0314 (Drizzle ledgers; only for `packages/db` typecheck) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

Define the four M04 jobs as zod payloads in `@shoebox/pipeline` and add the two Drizzle I/O functions the categorize worker (0319) needs: load one document with everything the cascade reads, and save one categorization atomically. No behaviour yet: the decision logic is 0318.

## 2. Context

- M04 §6.3 (jobs; payloads carry ids only, hard rule 4):
  - `doc.categorize`: `{orgId, documentId, revision, trigger: 'pipeline'|'question_answered'|'vendor_memory_changed'|'prior_changed'|'profile_changed'|'catalog_upgrade'|'user_reprocess'}`.
  - `ledger.rebuild_document`: `{orgId, documentId, reason: 'categorized'|'status_changed'|'revised'|'deleted'|'partner_changed'|'payment_link'|'profile_changed'|'fx_imported'|'rules_changed'|'verify'}`.
  - `ledger.rebuild_org`: `{orgId, from?: date, reason: 'profile_changed'|'rules_changed'|'manual'}`.
  - `ledger.verify` (system cron `45 3 * * *`): `{samplePct: number 0..100, default 1}`.
  - `ledger.rebuild_transaction` is **not** defined here (M07 transactions do not exist yet; TODO(P0-DB-08)).
- The registry derives the pg-boss job id from `jobKey(def, payload)` = `{orgId}:{name}:{entityId}:{version}`; a second enqueue with the same key while the first is still in the queue is a no-op. User actions (an answer, a line edit) must never be swallowed, so those payloads carry an optional `nonce` (integer, e.g. epoch ms) that the enqueuer sets and `entityId` appends. Key parts may not contain `:` or whitespace (`idempotencyKey`).
- Existing code (`packages/pipeline/src/jobs.ts`): `JOB_NAMES` already contains the four names; `tenantPayload(shape)`, `defineTenantJob`, `defineSystemJob`, `docExtractJob` show the pattern. zod 4: `z.uuid()`, `z.iso.date()`, `z.enum([...])`, `z.strictObject`.
- `packages/db/src/document-reading.ts` is the pattern for the I/O (select with joins, `tx.update(documents).set(...)`, flipping `document_fields.is_current`). Schema: `documents` (columns listed in `schema/documents.ts`: `issueDate, duzp, receivedDate, servicePeriodFrom, servicePeriodTo, vatPointDate, paidAt, currency, fxRate, fxRateDate, totalGross, paymentMethod, isPaidPerDocument, businessFlag, summaryCs, partnerId, partnerSnapshot, buyerSnapshot, stageVersion, revision, status, class, direction, taxDocStatus, deletedAt`), `documentLines`, `documentFields`, `reviewQuestions`, `extractionRuns` (stage `'categorize'`), `vendorProfiles`, `partners`, `taxpayerProfiles` (`validFrom, validTo, vatStatus, vatPeriod, foreignServiceDppdPolicy, mainActivityNace`), `organizations.settings`, `fxRates` (`schema/partners.ts`), `categories`.
- M04 §4.6 step 6: persist line fields + `document_fields` provenance in one transaction; **skip fields whose current source is `user`** (a user value is never overwritten by llm/rule/vendor_memory).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/src/jobs.ts` | edit | append four definitions |
| `packages/pipeline/test/jobs.test.ts` | edit | append one describe block |
| `packages/db/src/document-categorize.ts` | create | `loadDocumentForCategorize`, `saveCategorization` |
| `packages/db/src/index.ts` | edit | one export line |

## 4. Steps

1. Edit `packages/pipeline/src/jobs.ts`. Anchor: the final block starting `/** M02: read one document (Haiku 5.5), then run the checks. Enqueued by the upload API. */`. Append after it:

```ts
export const CATEGORIZE_TRIGGERS = ['pipeline', 'question_answered', 'vendor_memory_changed', 'prior_changed', 'profile_changed', 'catalog_upgrade', 'user_reprocess'] as const;
export type CategorizeTrigger = (typeof CATEGORIZE_TRIGGERS)[number];
export const LEDGER_REASONS = ['categorized', 'status_changed', 'revised', 'deleted', 'partner_changed', 'payment_link', 'profile_changed', 'fx_imported', 'rules_changed', 'verify'] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];
export const ORG_REBUILD_REASONS = ['profile_changed', 'rules_changed', 'manual'] as const;

/** Id-safe key part (no ':' or whitespace). */
const nonceField = z.number().int().min(0).optional();

export const docCategorizePayload = tenantPayload({ documentId: z.uuid(), revision: z.number().int().min(1), trigger: z.enum(CATEGORIZE_TRIGGERS), nonce: nonceField });
export type DocCategorizePayload = z.infer<typeof docCategorizePayload>;
/** M04 §4.6: cascade → LLM → VAT → questions → summary → status; enqueues ledger.rebuild_document. Version = categorize stage version. */
export const docCategorizeJob = defineTenantJob({
  name: 'doc.categorize',
  payload: docCategorizePayload,
  version: 1,
  entityId: (p) => `${p.documentId}-${p.revision}-${p.trigger}${p.nonce === undefined ? '' : `-${p.nonce}`}`,
});

export const ledgerRebuildDocumentPayload = tenantPayload({ documentId: z.uuid(), reason: z.enum(LEDGER_REASONS), nonce: nonceField });
export type LedgerRebuildDocumentPayload = z.infer<typeof ledgerRebuildDocumentPayload>;
/** M04 §4.13: rebuild both ledgers for one document under an advisory lock; no-op when the input hash is unchanged. */
export const ledgerRebuildDocumentJob = defineTenantJob({
  name: 'ledger.rebuild_document',
  payload: ledgerRebuildDocumentPayload,
  version: 1,
  entityId: (p) => `${p.documentId}-${p.reason}${p.nonce === undefined ? '' : `-${p.nonce}`}`,
});

export const ledgerRebuildOrgPayload = tenantPayload({ from: z.iso.date().optional(), reason: z.enum(ORG_REBUILD_REASONS), nonce: nonceField });
export type LedgerRebuildOrgPayload = z.infer<typeof ledgerRebuildOrgPayload>;
/** M04 §4.13: enqueues ledger.rebuild_document for the org's documents (issue_date order, batches of 200). */
export const ledgerRebuildOrgJob = defineTenantJob({
  name: 'ledger.rebuild_org',
  payload: ledgerRebuildOrgPayload,
  version: 1,
  entityId: (p) => `org-${p.reason}-${p.from ?? 'all'}${p.nonce === undefined ? '' : `-${p.nonce}`}`,
  retry: { retryLimit: 1 },
});

export const ledgerVerifyPayload = z.strictObject({ samplePct: z.number().min(0).max(100).default(1) });
export type LedgerVerifyPayload = z.infer<typeof ledgerVerifyPayload>;
/** M04 §4.13 determinism check: nightly dry-run rebuild of a sample; any diff is logged as an alert. */
export const ledgerVerifyJob = defineSystemJob({
  name: 'ledger.verify',
  payload: ledgerVerifyPayload,
  cron: '45 3 * * *',
  retry: { retryLimit: 0 },
});
```
   Command: `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30` → 0 errors. If `z.iso.date()` does not exist in the installed zod, use `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` and report it.

2. Edit `packages/pipeline/test/jobs.test.ts`: extend the import of `../src/jobs` with `docCategorizeJob, ledgerRebuildDocumentJob, ledgerRebuildOrgJob, ledgerVerifyJob` and append at the end of the file:

```ts
describe('M04 jobs', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const DOC = '22222222-2222-4222-8222-222222222222';
  it('doc.categorize keys on document, revision and trigger, plus the nonce when given', () => {
    expect(jobKey(docCategorizeJob, { orgId: ORG, documentId: DOC, revision: 2, trigger: 'pipeline' })).toBe(`${ORG}:doc.categorize:${DOC}-2-pipeline:1`);
    expect(jobKey(docCategorizeJob, { orgId: ORG, documentId: DOC, revision: 2, trigger: 'question_answered', nonce: 17 })).toBe(`${ORG}:doc.categorize:${DOC}-2-question_answered-17:1`);
    expect(docCategorizeJob.payload.safeParse({ orgId: ORG, documentId: DOC, revision: 1, trigger: 'nope' }).success).toBe(false);
    expect(docCategorizeJob.payload.safeParse({ orgId: ORG, documentId: DOC, revision: 1, trigger: 'pipeline', text: 'x' }).success).toBe(false);
  });
  it('ledger.rebuild_document keys on document and reason', () => {
    expect(jobKey(ledgerRebuildDocumentJob, { orgId: ORG, documentId: DOC, reason: 'categorized' })).toBe(`${ORG}:ledger.rebuild_document:${DOC}-categorized:1`);
  });
  it('ledger.rebuild_org accepts an optional from date and is retried once', () => {
    expect(ledgerRebuildOrgJob.payload.parse({ orgId: ORG, reason: 'manual' })).toEqual({ orgId: ORG, reason: 'manual' });
    expect(jobKey(ledgerRebuildOrgJob, { orgId: ORG, reason: 'profile_changed', from: '2026-01-01' })).toBe(`${ORG}:ledger.rebuild_org:org-profile_changed-2026-01-01:1`);
    expect(ledgerRebuildOrgJob.payload.safeParse({ orgId: ORG, reason: 'manual', from: '01.01.2026' }).success).toBe(false);
    expect(ledgerRebuildOrgJob.retry.retryLimit).toBe(1);
  });
  it('ledger.verify is a nightly system cron with samplePct defaulting to 1', () => {
    expect(ledgerVerifyJob.scope).toBe('system');
    expect(ledgerVerifyJob.cron).toBe('45 3 * * *');
    expect(ledgerVerifyJob.payload.parse({})).toEqual({ samplePct: 1 });
  });
});
```
   Command: `pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30` → all pass.

3. Create `packages/db/src/document-categorize.ts` exporting exactly:

```ts
import type { TenantTx } from './tenant';
export interface CategorizeLineRow { readonly id: string; readonly position: number; readonly lineType: string; readonly description: string | null; readonly quantity: string | null; readonly net: string | null; readonly vat: string | null; readonly gross: string | null; readonly vatRateType: string; readonly vatRatePct: string | null; readonly vatTreatment: string | null; readonly categoryCode: string | null; readonly businessSharePct: string; readonly deductibility: string | null; readonly coveredByDocumentId: string | null; readonly rcCommodityCode: string | null; readonly classificationSource: string | null; readonly classificationConfidence: string | null; }
export interface CategorizeFieldRow { readonly fieldKey: string; readonly valueText: string | null; readonly valueJson: unknown; readonly source: string; }   // current rows only
export interface CategorizeQuestionRow { readonly id: string; readonly kind: string; readonly payload: unknown; readonly answer: unknown; readonly answeredAt: Date | null; }
export interface CategorizeProfileRow { readonly validFrom: string; readonly validTo: string | null; readonly vatStatus: string; readonly vatPeriod: string | null; readonly foreignServiceDppdPolicy: string | null; readonly mainActivityNace: string | null; }
export interface CategorizePartnerRow { readonly id: string; readonly name: string; readonly ico: string | null; readonly dic: string | null; readonly vatId: string | null; readonly country: string; readonly isVatPayer: boolean | null; }
export interface CategorizeVendorRow { readonly id: string; readonly partnerId: string; readonly defaultCategoryCode: string | null; readonly defaultVatTreatment: string | null; readonly defaultBusinessFlag: string | null; readonly confirmations: number; readonly pinned: boolean; readonly multiCategory: boolean; readonly extractionHints: unknown; }
export interface CategorizeFxRow { readonly rateDate: string; readonly currency: string; readonly amount: number; readonly rate: string; }
export interface DocumentForCategorize {
  readonly id: string; readonly orgId: string; readonly status: string; readonly revision: number; readonly class: string; readonly direction: string | null; readonly taxDocStatus: string;
  readonly issueDate: string | null; readonly duzp: string | null; readonly receivedDate: string | null; readonly servicePeriodFrom: string | null; readonly servicePeriodTo: string | null; readonly paidAt: string | null; readonly vatPointDate: string | null;
  readonly currency: string; readonly fxRate: string | null; readonly fxRateDate: string | null; readonly totalGross: string | null; readonly paymentMethod: string | null; readonly isPaidPerDocument: boolean | null;
  readonly businessFlag: string; readonly summaryCs: string | null; readonly partnerId: string | null; readonly partnerSnapshot: unknown; readonly buyerSnapshot: unknown; readonly stageVersion: unknown;
  readonly orgIco: string | null; readonly orgDic: string | null; readonly orgSettings: unknown;
  readonly lines: readonly CategorizeLineRow[]; readonly fields: readonly CategorizeFieldRow[]; readonly questions: readonly CategorizeQuestionRow[];
  readonly partner: CategorizePartnerRow | null; readonly vendor: CategorizeVendorRow | null; readonly profiles: readonly CategorizeProfileRow[];
  /** fx_rates rows of the document's currency within 120 days before issue_date (empty for CZK). */
  readonly fxRates: readonly CategorizeFxRow[];
}
/** Not-deleted document with lines (position order), current fields, all questions of the document, partner, vendor profile of that partner, the org's taxpayer profiles (valid_from order) and fx rows. Null when absent. */
export async function loadDocumentForCategorize(tx: TenantTx, documentId: string): Promise<DocumentForCategorize | null>;

export interface CategorizationLineWrite { readonly lineId: string; readonly categoryCode: string | null; readonly vatTreatment: string | null; readonly vatRatePct: string | null; readonly businessSharePct: string; readonly deductibility: string | null; readonly classificationSource: string | null; readonly classificationConfidence: string | null; }
export interface CategorizationFieldWrite { readonly fieldKey: string; readonly valueText: string | null; readonly valueJson?: unknown; readonly source: 'llm' | 'rule' | 'vendor_memory' | 'derived' | 'user'; readonly confidence: string | null; readonly setBy?: string | null; }
export interface CategorizationQuestionWrite { readonly kind: string; readonly payload: unknown; }
export interface CategorizationRunWrite { readonly model: string; readonly promptVersion: string; readonly attempt: number; readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens: number; readonly cacheWriteTokens: number; readonly latencyMs: number; readonly ok: boolean; readonly error: string | null; }
export interface CategorizationWrite {
  readonly orgId: string; readonly documentId: string;
  readonly status: 'ready' | 'needs_review';
  readonly document: { readonly businessFlag: string; readonly summaryCs: string | null; readonly vatPointDate: string | null; readonly fxRate: string | null; readonly fxRateDate: string | null; readonly categorizeVersion: number };
  readonly lines: readonly CategorizationLineWrite[];
  readonly fields: readonly CategorizationFieldWrite[];
  readonly questions: readonly CategorizationQuestionWrite[];
  readonly runs: readonly CategorizationRunWrite[];
}
/**
 * One transaction (the caller's tx): inserts the runs (stage 'categorize', method 'llm'); for each field: when a current
 * row of the same key has source 'user' and the new source is not 'user' → skip; else flip current rows of that key and
 * insert the new one; updates each line; inserts each question unless an unanswered question of the same kind already
 * exists for the document; updates documents (status, business_flag, summary_cs, vat_point_date, fx_rate, fx_rate_date,
 * stage_version = stage_version || {"categorize": categorizeVersion}). Returns the number of fields written.
 */
export async function saveCategorization(tx: TenantTx, write: CategorizationWrite): Promise<number>;
```
   Column mapping notes: `lineType`, `vatRateType` etc. are the enum columns as strings; numeric columns come back as strings (never convert to `number`); `fxRates.amount` is an integer column. `stage_version` merge: `sql\`${documents.stageVersion} || ${JSON.stringify({ categorize: v })}::jsonb\``.
   Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → 0 errors.

4. Edit `packages/db/src/index.ts`: after `export * from './document-reading';` add `export * from './document-categorize';`. Commands: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → 0 errors; `pnpm --filter @shoebox/db test -- rls 2>&1 | tail -30` → unchanged (no schema change here).

## 5. Do not touch

`packages/db/migrations`, `schema/*`, `document-reading.ts`, `apps/*`, `packages/domain`. Hard rules 3 (every query runs in the caller's `withTenant` tx; still filter by `documents.id` and join through `org_id`), 4 (no content in logs), 5 (no schema change).

## 6. Commands

`pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30`; `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30`; `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`.

## 7. Acceptance

- [ ] Jobs test passes; both typechecks clean. - [ ] `saveCategorization` never overwrites a current `user` field with a non-user one (code review).

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0317-report.md`.

## Risk list

`document-categorize.ts` (user-field protection, stage_version merge), `jobs.ts` (idempotency keys).

## Owner steps

None.
