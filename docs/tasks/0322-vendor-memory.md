# 0322: P1-CAT-05a vendor memory: learning from confirmations, relearn question, retroactive re-categorize

Status: todo
Ticket: P1-CAT-05 | Depends on: 0320, 0321 (merged) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 55k tokens

## 1. Objective

Teach `vendor_profiles` from user decisions (M04 §4.7) inside the categorize job: a user-triggered run (`question_answered`, `user_reprocess`) that leaves the document with a user-set dominant line counts as one confirmation; after `classification.vendor_memory_min_confirmations` (2) the vendor's next document is resolved by the cascade's stage 2 with no LLM call (AC-6); a contradiction against a learned profile asks `relearn_vendor`; the threshold being reached re-queues the partner's open documents.

## 2. Context

M04 §4.7 `recordConfirmation`, verbatim logic (`obs` = the dominant line's `(categoryCode, vatTreatment, businessFlag)`):
```
p = vendor profile or new {confirmations: 0}
if p.default_category_code is null:            p.default_* = obs; p.confirmations = 1
elif p.default_category_code == obs.category:  p.confirmations += 1; p.default_vat_treatment = obs.treatment; p.default_business_flag = obs.flag
elif p.pinned:                                 no change; relearn question only if the user explicitly changed it
elif p.confirmations <= 1:                     p.default_* = obs; p.confirmations = 1
else:                                          create review_question relearn_vendor (once per (partner, new_code))
p.last_confirmed_at = now(); p.extraction_hints.subject_cs = current subject (when user-confirmed)
```
Confirmation events here: a `doc.categorize` run with trigger `question_answered` or `user_reprocess` whose dominant line has `classificationSource === 'user'` **or** whose document has a `lines[*].remember` user field with value `vendor` or `always` (0321 writes it). **Not** confirmations: trigger `pipeline`, `vendor_memory_changed`, `profile_changed`, `catalog_upgrade`, `prior_changed`; auto-finalized documents; LLM agreement. `always` additionally sets `pinned = true`. The `relearn_vendor` answer (`from_now_on`): default replaced by the new code, `confirmations = 1`, `pinned = true`; `this_only`: no change. Applied in this same step from answered `relearn_vendor` questions (payload `params.partner_id, old_code, new_code`).
`multi_category := document has ≥ 2 item lines with different confirmed categories` (the 12-month history part is TODO(cat-05-history)).
Retroactive application: when `confirmations` crosses `vendorMemoryMinConfirmations` (from below to ≥) or `pinned` becomes true → enqueue `doc.categorize {trigger: 'vendor_memory_changed', revision}` for the partner's documents in `needs_review | ready` other than the current one (never finalized; the cascade itself never overrides `user` lines).
Lane C owns only the category fields of `vendor_profiles` (`default_category_code, default_vat_treatment, default_business_flag, confirmations, last_confirmed_at, pinned, multi_category, extraction_hints.subject_cs`); never touch other `extraction_hints` keys (merge).
Existing: `CategorizeVendorRow`, `CategorizationWrite` (0317), `planCategorization` result (0319), handler (0320: add one step after `save`), `parseClassificationRules(rules.at(date)).vendorMemoryMinConfirmations`, `ledgerRebuildDocumentJob`, `docCategorizeJob` (0317), `openKinds` (0318).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/categorize/vendor-memory.ts` | create | pure `learnVendorProfile`, `confirmationOf` |
| `packages/db/src/vendor-memory.ts` + `packages/db/src/index.ts` | create + edit (one export line) | `saveVendorProfile`, `openDocumentsOfPartner`, `insertRelearnQuestion` |
| `apps/worker/src/categorize/handler.ts` | edit | learning step after save |
| `apps/worker/test/vendor-memory.test.ts` | create | the test below, verbatim |

## 4. Steps

1. Create `apps/worker/src/categorize/vendor-memory.ts` exporting exactly:
```ts
import type { CategorizeVendorRow, CategorizationWrite, DocumentForCategorize } from '@shoebox/db';
import type { QuestionPayload } from './answers';
export interface VendorObservation { readonly categoryCode: string; readonly vatTreatment: string | null; readonly businessFlag: 'business' | 'personal' | 'mixed'; readonly subject: string | null; readonly pin: boolean; readonly multiCategory: boolean; }
export interface VendorProfileState { readonly defaultCategoryCode: string | null; readonly defaultVatTreatment: string | null; readonly defaultBusinessFlag: string | null; readonly confirmations: number; readonly pinned: boolean; readonly multiCategory: boolean; readonly extractionHints: Record<string, unknown>; readonly lastConfirmedAt: Date | null; }
export interface LearnResult { readonly profile: VendorProfileState; readonly changed: boolean; readonly relearn: { readonly oldCode: string; readonly newCode: string; readonly count: number } | null; readonly reachedThreshold: boolean; }
export function emptyProfile(): VendorProfileState;
/** §4.7 recordConfirmation as a pure state transition. `now` is the confirmation time. */
export function learnVendorProfile(profile: VendorProfileState, obs: VendorObservation, minConfirmations: number, now: Date): LearnResult;
/** The relearn_vendor answer: from_now_on → defaults = new code (treatment/flag kept), confirmations 1, pinned; this_only → unchanged. */
export function applyRelearnAnswer(profile: VendorProfileState, newCode: string, value: 'this_only' | 'from_now_on'): VendorProfileState;
/** The observation of a user-confirmed run, or null when the run is not a confirmation (trigger, source and remember rules of §2). `dominantLineId` is the planner's dominant line. */
export function confirmationOf(trigger: string, doc: DocumentForCategorize, write: Omit<CategorizationWrite, 'runs'>, dominantLineId: string): VendorObservation | null;
export function relearnPayload(partnerId: string, merchant: string, oldCode: string, newCode: string, count: number): QuestionPayload;  // question 'categorize.question.relearn_vendor', options this_only / from_now_on, params {partner_id, old_code, new_code, count, merchant}
```
   `reachedThreshold` = `profile.confirmations < min && result.confirmations >= min`, or pinned turned true. `businessFlag` of an observation: `'business'` when the dominant line's share is `100`, `'personal'` when `0`, else `'mixed'`. Expose the dominant line id from the planner: add `readonly dominantLineId: string` to `PlanResult.event` in `plan.ts` **only if it is not there already** — if it is missing, stop and report (0319 should carry it; the orchestrator patches 0319 instead).
   Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → may show the missing field; that is the stop condition above.

2. Create `packages/db/src/vendor-memory.ts` exporting exactly (and add `export * from './vendor-memory';` to `packages/db/src/index.ts` after the `document-categorize` line):
```ts
import type { TenantTx } from './tenant';
export interface VendorProfileWrite { readonly orgId: string; readonly partnerId: string; readonly defaultCategoryCode: string | null; readonly defaultVatTreatment: string | null; readonly defaultBusinessFlag: string | null; readonly confirmations: number; readonly pinned: boolean; readonly multiCategory: boolean; readonly subjectHint: string | null; readonly lastConfirmedAt: Date | null; }
/** Upsert on (org_id, partner_id); extraction_hints = extraction_hints || {"subject_cs": subjectHint} (key removed when null). Returns the profile id. */
export async function saveVendorProfile(tx: TenantTx, write: VendorProfileWrite): Promise<string>;
/** Ids and revisions of the partner's documents in needs_review|ready, not deleted, excluding `exceptDocumentId`. */
export async function openDocumentsOfPartner(tx: TenantTx, orgId: string, partnerId: string, exceptDocumentId: string | null): Promise<{ id: string; revision: number }[]>;
/** Inserts a relearn_vendor question unless an unanswered one with the same partner_id and new_code exists (any document of the org). */
export async function insertRelearnQuestion(tx: TenantTx, orgId: string, documentId: string, payload: unknown): Promise<boolean>;
```
   Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → 0 errors.

3. Edit `apps/worker/src/categorize/handler.ts`: add to `CategorizeStore` the three functions (`saveVendorProfile`, `openDocumentsOfPartner`, `insertRelearnQuestion`, typed `typeof …`) and to `dbCategorizeStore`; after the `save` call and before the ledger enqueue insert the learning step:
   - `relearn` answers: for each answered `relearn_vendor` question of the document (0318 `parseQuestionPayload`) whose `params.partner_id === doc.partnerId`: `applyRelearnAnswer` → `saveVendorProfile`.
   - `obs = confirmationOf(payload.trigger, doc, final.write, final.event.dominantLineId)`; when `obs && doc.partnerId`: `learned = learnVendorProfile(stateOf(doc.vendor), obs, parseClassificationRules(rules.at(issueDate)).vendorMemoryMinConfirmations, new Date(clock.now()))`; `changed` → `saveVendorProfile`; `relearn` → `insertRelearnQuestion(relearnPayload(...))`; `reachedThreshold` → for each of `openDocumentsOfPartner` enqueue `docCategorizeJob {orgId, documentId, revision, trigger: 'vendor_memory_changed'}` (try/catch → warn). Log `event: 'vendor_profile.changed'` with ids and `confirmations` only.
   Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → 0 errors; `pnpm --filter @shoebox/worker test -- categorize-job 2>&1 | tail -30` → still passes (extend the test harness's fake store in your head: the existing test passes `store` objects without the three new functions, so make them **optional** in `CategorizeStore` and skip learning when absent).

4. Create `apps/worker/test/vendor-memory.test.ts` verbatim; implement until it passes, do not edit it:
```ts
import { describe, expect, it } from 'vitest';
import { applyRelearnAnswer, emptyProfile, learnVendorProfile, type VendorObservation, type VendorProfileState } from '../src/categorize/vendor-memory';

const now = new Date('2026-10-26T10:00:00Z');
const obs = (over: Partial<VendorObservation> = {}): VendorObservation => ({ categoryCode: 'exp_cleaning', vatTreatment: 'rcv_domestic_no_vat', businessFlag: 'business', subject: 'Apartment cleaning', pin: false, multiCategory: false, ...over });
const learned = (over: Partial<VendorProfileState> = {}): VendorProfileState => ({ ...emptyProfile(), defaultCategoryCode: 'exp_cleaning', defaultVatTreatment: 'rcv_domestic_no_vat', defaultBusinessFlag: 'business', confirmations: 2, extractionHints: { subject_cs: 'Apartment cleaning', other: 1 }, ...over });

describe('learnVendorProfile (M04 §4.7)', () => {
  it('first confirmation sets the defaults and the subject hint; the second reaches the threshold (AC-6)', () => {
    const first = learnVendorProfile(emptyProfile(), obs(), 2, now);
    expect(first.profile).toMatchObject({ defaultCategoryCode: 'exp_cleaning', defaultVatTreatment: 'rcv_domestic_no_vat', defaultBusinessFlag: 'business', confirmations: 1, pinned: false, lastConfirmedAt: now, extractionHints: { subject_cs: 'Apartment cleaning' } });
    expect(first).toMatchObject({ changed: true, relearn: null, reachedThreshold: false });
    const second = learnVendorProfile(first.profile, obs(), 2, now);
    expect(second.profile.confirmations).toBe(2);
    expect(second.reachedThreshold).toBe(true);
    const third = learnVendorProfile(second.profile, obs(), 2, now);
    expect(third.profile.confirmations).toBe(3);
    expect(third.reachedThreshold).toBe(false);
  });
  it('agreement refreshes treatment and flag; other hint keys survive', () => {
    const r = learnVendorProfile(learned(), obs({ businessFlag: 'mixed', vatTreatment: 'rcv_domestic_vat' }), 2, now);
    expect(r.profile).toMatchObject({ confirmations: 3, defaultBusinessFlag: 'mixed', defaultVatTreatment: 'rcv_domestic_vat', extractionHints: { subject_cs: 'Apartment cleaning', other: 1 } });
  });
  it('a contradiction with ≤ 1 confirmation replaces the default; with ≥ 2 it asks relearn_vendor and changes nothing else', () => {
    const weak = learnVendorProfile(learned({ confirmations: 1 }), obs({ categoryCode: 'exp_services_general' }), 2, now);
    expect(weak.profile).toMatchObject({ defaultCategoryCode: 'exp_services_general', confirmations: 1 });
    expect(weak.relearn).toBeNull();
    const strong = learnVendorProfile(learned(), obs({ categoryCode: 'exp_services_general' }), 2, now);
    expect(strong.profile.defaultCategoryCode).toBe('exp_cleaning');
    expect(strong.profile.confirmations).toBe(2);
    expect(strong.relearn).toEqual({ oldCode: 'exp_cleaning', newCode: 'exp_services_general', count: 2 });
  });
  it('a pinned profile never changes on a contradiction and asks nothing', () => {
    const r = learnVendorProfile(learned({ pinned: true }), obs({ categoryCode: 'exp_services_general' }), 2, now);
    expect(r.profile).toMatchObject({ defaultCategoryCode: 'exp_cleaning', pinned: true });
    expect(r.relearn).toBeNull();
    expect(r.changed).toBe(false);
  });
  it('"always" pins and counts as reaching the threshold; multi-category is recorded', () => {
    const r = learnVendorProfile(emptyProfile(), obs({ pin: true, multiCategory: true }), 2, now);
    expect(r.profile).toMatchObject({ pinned: true, multiCategory: true, confirmations: 1 });
    expect(r.reachedThreshold).toBe(true);
  });
  it('a null subject keeps the existing hint', () => {
    const r = learnVendorProfile(learned(), obs({ subject: null }), 2, now);
    expect(r.profile.extractionHints).toMatchObject({ subject_cs: 'Apartment cleaning' });
  });
});

describe('applyRelearnAnswer', () => {
  it('from_now_on replaces the default, resets confirmations to 1 and pins; this_only changes nothing', () => {
    expect(applyRelearnAnswer(learned(), 'exp_services_general', 'from_now_on')).toMatchObject({ defaultCategoryCode: 'exp_services_general', confirmations: 1, pinned: true, defaultVatTreatment: 'rcv_domestic_no_vat' });
    expect(applyRelearnAnswer(learned(), 'exp_services_general', 'this_only')).toEqual(learned());
  });
});
```
   Command: `pnpm --filter @shoebox/worker test -- vendor-memory 2>&1 | tail -30` → all pass.

## 5. Do not touch

`vendor_profiles` columns outside the category fields; `packages/db/migrations`; lane D screens. Hard rules 3, 4, 7.

## 6. Commands

`pnpm --filter @shoebox/worker test -- vendor-memory 2>&1 | tail -30`; `pnpm --filter @shoebox/worker test -- categorize-job 2>&1 | tail -30`; `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`; `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`.

## 7. Acceptance

- [ ] Both worker tests pass; typechecks clean. - [ ] A `pipeline`-triggered run never writes `vendor_profiles` (code review of `confirmationOf`).

## 8. Stop and ask

Per TEMPLATE §8, plus the `dominantLineId` condition in step 1.

## 9. Report

`docs/tasks/0322-report.md`.

## Risk list

`vendor-memory.ts` (pinned rule), handler learning step (trigger gate), `packages/db/src/vendor-memory.ts` (hints merge).

## Owner steps

None.
