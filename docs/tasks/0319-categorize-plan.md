# 0319: P1-CAT-04c `planCategorization` — the pure stage flow (M04 §4.6) in `apps/worker`

Status: todo
Ticket: P1-CAT-04 | Depends on: 0315, 0316, 0317, 0318 (all merged) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

One pure function that takes the loaded document (0317), the optional LLM output (0315) and the rules, and returns the `CategorizationWrite` (0317) plus whether the LLM is still needed and the request input to call it. The handler (0320) is then a thin shell: load → plan → maybe LLM → plan again → save → enqueue ledger rebuild.

## 2. Context

M04 §4.6 in order: (1) snapshot, profile at `issue_date`, vendor profile, categories; (2) cascade stages 0–5, collect unresolved; (3) if unresolved **or no subject** → LLM, apply as stage 6; (4) `deriveVatTreatment` per line, asset check, business share, deductibility (the cascade does the last three); (5) `deriveVatPointDate`, `vat_rate_pct`, FX → `documents.fx_rate, fx_rate_date`; (6) persist line fields + provenance, skip `user` fields; (7) questions (≤ 2), `summary_cs`, `business_flag`; (8) M03 `post_categorize` checks → `needs_review` or `ready`; (9) enqueue `ledger.rebuild_document`.

Composition rules for this brief:
- **Subject** = user field `summary.subject` (source `user`) > current field `summary.subject` (source `llm`) or this run's `llm.subject` > `vendor.extractionHints.subject_cs` > category label. `needsLlm = cascade.needsLlm.length > 0 || subject source is 'category label'`. (AC-6: a vendor with ≥ 2 confirmations and a stored hint resolves without any LLM call.)
- **User fields** = `applyAnswers(doc.questions, …)` (0318) ∪ current `document_fields` rows with source `user` for keys `lines[{p}].category_code|business_share_pct|supply_kind` ∪ lines whose `classificationSource === 'user'` (their `categoryCode`/`businessSharePct`). They feed `CascadeLine.userCategoryCode/userBusinessSharePct` and the VAT `supplyKind`. Fields produced by `applyAnswers` are also emitted in `write.fields` with `source: 'user'` (idempotent re-application).
- **Cascade input** (0303 types): `doc.personalPurchaseSuspected = llm?.businessLikelihood === 'personal'` (TODO(P1-VAL-08): M03 PERSONAL_LOOKING_PURCHASE will set it); `supplier = {name: partner.name, naceCodes: [], authorityKind: null}`; `vendor` from the vendor row; `original = null`; `settings = {activityKeywords: orgSettings.activity_keywords ?? [], carBusinessSharePct: orgSettings.car?.business_share_pct ?? null, hiddenCategoryCodes: orgSettings.hidden_categories ?? []}`; `vatStatusAtIssue = profileAt(issueDate).vatStatus`; `deductionAllowed = vatStatusAtIssue === 'platce'` (TODO(decision-deduction)); `llm = {lines: output.lines.map(l => ({position, categoryCode, confidence, assetCandidate}))}`; `fxRateToCzk` = `doc.fxRate` or the resolved rate's `perUnit.toFixed(6)` when a foreign currency (resolve FX **before** the cascade using `issueDate`; re-resolve at the VAT point date after step 5 only for `documents.fx_rate_date`).
- **VAT treatment** per line: `supplier = partner ? {country, czDic: dic, vatId, vatIdValid: null, isVatPayer} : null`; `customer = {country: 'CZ', czDic: orgDic, vatId: null, vatIdValid: null, isVatPayer: vatStatus !== 'neplatce'}`; `flags = {reverseCharge92a: false, customsDeclaration: false, placeOfSupplyAbroad: llmLine?.placeOfSupplyAbroad ?? false}`; `supplyKind = userSupplyKind ?? (llmLine.supplyKind ∈ {service, goods} ? it : null)`; `line = {vat, vatRatePct, rcCommodityCode, categoryCode: decision.categoryCode ?? 'exp_other_deductible', isStatementIncomeLine: lineType === 'item' && class === 'platform_statement' && gross > 0}`. `ambiguous === 'supply_kind'` or `llmLine.supplyKind === 'mixed'` → extra line kind `supply_kind` for `buildQuestions`. Lines with `categoryCode === null` get `vatTreatment: null`.
- **VAT point date**: `deriveVatPointDate(vatPointDoc, treatments (non-null), profileAt, [], rules)`; `profileAt(date)` = latest `doc.profiles` row with `validFrom ≤ date` (and `validTo` null or ≥ date), mapped to `{vatStatus, vatPeriod, foreignServiceDppdPolicy ?? 'issue_date'}`; with no profile: `{vatStatus: 'neplatce', vatPeriod: null, foreignServiceDppdPolicy: 'issue_date'}`. `vatPeriod` for the summary = `resolveVatPeriod(profileAt(point), point)` when the dominant treatment is self-assessed.
- **`vat_rate_pct`**: the line's own `vatRatePct` when present; else for a self-assessed treatment the `standard` rate of `rules.at(issueDate).get('vat.rates')` (as string, `'21'`) unless the category is in `vat.reduced_rate_categories` (→ `reduced`); else null.
- **Dominant line** for summary/flag = the item line with the largest `|gross|` (ties: lowest position); documents with no item line use position 1.
- **Status**: `needs_review` when (a) any new or still-open question exists, or (b) any line has `categoryCode === null`, or (c) `postChecks` contains a blocking row; else `ready`. No auto-finalize here (TODO(auto_finalize): 03 §3, owner decision pending).
- **Fields written** (`source`, `confidence` as 3-decimal string): `lines[{p}].category_code` (decision.source / decision.confidence), `lines[{p}].vat_treatment` (`derived`, null), `lines[{p}].business_share_pct` (`derived`, null; skipped when a user share exists), `lines[{p}].supply_kind` (`llm`, line confidence) when the LLM gave service/goods, `summary.subject` (`llm`) when this run's LLM gave one, `document.business_flag` (`derived`). Field keys use the line **position**.
- Existing API: `runCategoryCascade`, `deriveVatTreatment`, `deriveVatRateType`, `deriveVatPointDate`, `resolveVatPeriod`, `resolveFxRate`, `buildSummary`, `getCategory`, `categoryAllowsDirection`, `isCategoryValidOn`, `CATEGORIES`, `parseClassificationRules(rules.at(date))`, `Money.parse(text,'CZK')`, `parseLegalDate`; `buildCategorizeRequest`'s `CategorizeRequestInput` and `CategorizeOutput` (0315); `applyAnswers`, `openKinds`, `buildQuestions` (0318); `DocumentForCategorize`, `CategorizationWrite` (0317). `parseClassificationRules(rules.at(issueDate))` gives `maxQuestionsPerDocument`, `recurringCategories`, `autoAcceptConfidence`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/categorize/plan.ts` | create | `planCategorization` |
| `apps/worker/test/categorize-plan.test.ts` | create | the test below, verbatim |

## 4. Steps

1. Create `apps/worker/src/categorize/plan.ts` exporting exactly:
```ts
import type { CategorizationWrite, DocumentForCategorize } from '@shoebox/db';
import type { LegalDate, RULE_SCHEMAS, RuleResolver } from '@shoebox/domain';
import type { CategorizeOutput, CategorizeRequestInput } from '@shoebox/extraction';
export interface PostCheckRow { readonly ruleId: string; readonly severity: 'blocking' | 'warning' | 'info'; }
export interface PlanInput {
  readonly doc: DocumentForCategorize;
  readonly llm: CategorizeOutput | null;
  readonly rules: RuleResolver<typeof RULE_SCHEMAS>;
  readonly today: LegalDate;
  readonly model: string;                       // for the LLM request input
  readonly categorizeVersion: number;           // docCategorizeJob.version
  readonly postChecks?: readonly PostCheckRow[]; // TODO(P1-VAL-08): lane B's post_categorize checks; default []
}
export interface PlanResult {
  readonly needsLlm: boolean;
  readonly llmRequest: CategorizeRequestInput | null;   // set when needsLlm
  readonly write: Omit<CategorizationWrite, 'runs'>;
  readonly event: { readonly lowConfidenceLines: number[]; readonly questions: string[]; readonly deferred: string[]; readonly dominantLineId: string };  // dominantLineId feeds vendor memory (0322)
}
export class CategorizeInputError extends Error { /* name = 'CategorizeInputError': direction null, no lines, or issue_date null */ }
export function planCategorization(input: PlanInput): PlanResult;
```
   `llmRequest.categories` = `CATEGORIES` filtered by `categoryAllowsDirection(c, direction) && isCategoryValidOn(c, issueDate)` and not hidden, mapped to `{code, direction, taxEffect, label: labelEn, explanation: explanationEn}`; `resolved[pos]` = the cascade's decided code or null; `business = {activities: settings.activityKeywords, nace: profile.mainActivityNace, vatStatus}`.
   Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → 0 errors.

2. Create `apps/worker/test/categorize-plan.test.ts` verbatim; implement until it passes, do not edit it:
```ts
import type { CategorizeLineRow, CategorizeQuestionRow, DocumentForCategorize } from '@shoebox/db';
import { createCzRules, parseLegalDate } from '@shoebox/domain';
import type { CategorizeOutput } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { planCategorization, type PlanInput } from '../src/categorize/plan';

const ORG = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333331';
const L2 = '33333333-3333-4333-8333-333333333332';
const rules = createCzRules();
const today = parseLegalDate('2026-10-26');

function line(over: Partial<CategorizeLineRow> = {}): CategorizeLineRow {
  return { id: L1, position: 1, lineType: 'item', description: 'Quechua backpack', quantity: '1', net: '205.79', vat: '43.21', gross: '249.00', vatRateType: 'standard', vatRatePct: '21', vatTreatment: null, categoryCode: null, businessSharePct: '100', deductibility: null, coveredByDocumentId: null, rcCommodityCode: null, classificationSource: null, classificationConfidence: null, ...over };
}
function doc(over: Partial<DocumentForCategorize> = {}): DocumentForCategorize {
  return {
    id: DOC, orgId: ORG, status: 'validating', revision: 1, class: 'received_receipt', direction: 'in', taxDocStatus: 'simplified_tax_document',
    issueDate: '2026-09-12', duzp: '2026-09-12', receivedDate: null, servicePeriodFrom: null, servicePeriodTo: null, paidAt: '2026-09-12', vatPointDate: null,
    currency: 'CZK', fxRate: null, fxRateDate: null, totalGross: '249.00', paymentMethod: 'card', isPaidPerDocument: true,
    businessFlag: 'business', summaryCs: null, partnerId: 'p1', partnerSnapshot: null, buyerSnapshot: null, stageVersion: {},
    orgIco: '12345678', orgDic: 'CZ12345678', orgSettings: { activity_keywords: ['short-term apartment rental'] },
    lines: [line()], fields: [], questions: [],
    partner: { id: 'p1', name: 'Decathlon', ico: '26151006', dic: 'CZ26151006', vatId: null, country: 'CZ', isVatPayer: true },
    vendor: null,
    profiles: [{ validFrom: '2026-01-01', validTo: null, vatStatus: 'identifikovana_osoba', vatPeriod: 'monthly', foreignServiceDppdPolicy: 'issue_date', mainActivityNace: '55.20' }],
    fxRates: [],
    ...over,
  };
}
function llm(over: Partial<CategorizeOutput> = {}, lineOver: Partial<CategorizeOutput['lines'][number]> = {}): CategorizeOutput {
  return { subject: 'Backpack', dominantCategoryCode: 'exp_other_deductible', businessLikelihood: 'personal', personalReason: 'sports gear', lines: [{ position: 1, categoryCode: 'exp_other_deductible', alternativeCategoryCode: 'private_expense', confidence: 0.55, supplyKind: 'goods', assetCandidate: false, mixedUseItem: false, placeOfSupplyAbroad: false, reason: 'sports gear', ...lineOver }], ...over };
}
function plan(over: Partial<PlanInput> = {}) {
  return planCategorization({ doc: doc(), llm: null, rules, today, model: 'claude-haiku-5-5', categorizeVersion: 1, ...over });
}
const answered = (kind: string, value: string, lineIds: string[] = [L1]): CategorizeQuestionRow => ({ id: `q-${kind}`, kind, payload: { question: `categorize.question.${kind}`, params: { line_ids: lineIds }, options: [{ value, label: 'x' }] }, answer: { value }, answeredAt: new Date('2026-10-01T00:00:00Z') });

describe('planCategorization', () => {
  it('asks for the LLM when a line is unresolved and builds the request for that position only', () => {
    const r = plan();
    expect(r.needsLlm).toBe(true);
    expect(r.llmRequest?.resolved).toEqual({ '1': null });
    expect(r.llmRequest?.document.direction).toBe('in');
    expect(r.llmRequest?.categories.every((c) => c.direction !== 'out')).toBe(true);
    expect(r.llmRequest?.business.vatStatus).toBe('identifikovana_osoba');
  });

  it('Decathlon (AC-9h): personal-looking → business_or_personal question, flag unknown, needs_review', () => {
    const r = plan({ llm: llm() });
    expect(r.needsLlm).toBe(false);
    expect(r.write.status).toBe('needs_review');
    expect(r.write.document.businessFlag).toBe('unknown');
    expect(r.write.questions.map((q) => q.kind)).toEqual(['business_or_personal', 'which_category']);
    expect(r.write.questions[0]?.payload).toMatchObject({ suggested: 'personal', params: { merchant: 'Decathlon', line_ids: [L1] } });
    expect(r.write.lines[0]).toMatchObject({ lineId: L1, categoryCode: 'exp_other_deductible', vatTreatment: 'rcv_domestic_vat', vatRatePct: '21', classificationSource: 'llm' });
    expect(r.write.fields).toContainEqual(expect.objectContaining({ fieldKey: 'lines[1].category_code', source: 'llm', valueText: 'exp_other_deductible' }));
    expect(r.write.fields).toContainEqual(expect.objectContaining({ fieldKey: 'summary.subject', source: 'llm', valueText: 'Backpack' }));
    expect(r.write.document.summaryCs).toBe('Backpack – tax-deductible expense, VAT 21 % is part of the cost');
    expect(r.event.questions).toEqual(['business_or_personal', 'which_category']);
  });

  it('Decathlon answered "personal": private_expense, share 0, non_deductible, ready, no LLM', () => {
    const r = plan({ doc: doc({ questions: [answered('business_or_personal', 'personal')], fields: [{ fieldKey: 'summary.subject', valueText: 'Backpack', valueJson: null, source: 'llm' }] }) });
    expect(r.needsLlm).toBe(false);
    expect(r.write.lines[0]).toMatchObject({ categoryCode: 'private_expense', businessSharePct: '0', deductibility: 'non_deductible', classificationSource: 'user' });
    expect(r.write.fields).toContainEqual(expect.objectContaining({ fieldKey: 'lines[1].category_code', source: 'user', valueText: 'private_expense' }));
    expect(r.write.fields).toContainEqual(expect.objectContaining({ fieldKey: 'lines[1].business_share_pct', source: 'user', valueText: '0' }));
    expect(r.write.questions).toEqual([]);
    expect(r.write.status).toBe('ready');
    expect(r.write.document.businessFlag).toBe('personal');
    expect(r.write.document.summaryCs).toBe('Backpack – personal expense, not counted for the business');
  });

  it('MacBook (AC-9i): durable 26 990 → exp_small_assets + question; answer 80 → partially deductible, flag mixed, ready', () => {
    const mac = doc({ lines: [line({ description: 'MacBook Air 13', net: '22305.79', vat: '4684.21', gross: '26990.00' })], partner: { id: 'p2', name: 'Alza.cz', ico: '27082440', dic: 'CZ27082440', vatId: null, country: 'CZ', isVatPayer: true }, issueDate: '2026-03-10', duzp: '2026-03-10', paidAt: '2026-03-10' });
    const out = llm({ subject: 'MacBook Air laptop', businessLikelihood: 'mixed', dominantCategoryCode: 'exp_other_deductible' }, { categoryCode: 'exp_other_deductible', confidence: 0.9, assetCandidate: true, mixedUseItem: true });
    const first = plan({ doc: mac, llm: out });
    expect(first.write.lines[0]).toMatchObject({ categoryCode: 'exp_small_assets', businessSharePct: '100', deductibility: 'deductible' });
    expect(first.write.questions.map((q) => q.kind)).toEqual(['small_asset_business_use']);
    expect(first.write.status).toBe('needs_review');
    const second = plan({ doc: { ...mac, questions: [answered('small_asset_business_use', '80')], fields: [{ fieldKey: 'summary.subject', valueText: 'MacBook Air laptop', valueJson: null, source: 'llm' }] }, llm: out });
    expect(second.write.lines[0]).toMatchObject({ categoryCode: 'exp_small_assets', businessSharePct: '80', deductibility: 'partially_deductible' });
    expect(second.write.document.businessFlag).toBe('mixed');
    expect(second.write.status).toBe('ready');
    expect(second.write.document.summaryCs).toBe('MacBook Air laptop – 80 % tax-deductible, VAT 21 % is part of the cost');
    expect(second.write.fields.some((f) => f.fieldKey === 'lines[1].business_share_pct' && f.source === 'derived')).toBe(false);
  });

  it('cleaning (AC-9b) via vendor memory: zero LLM, no VAT, subject from the vendor hint, ready', () => {
    const r = plan({ doc: doc({ class: 'received_invoice', taxDocStatus: 'not_tax_document', issueDate: '2026-10-02', duzp: null, servicePeriodFrom: '2026-09-01', servicePeriodTo: '2026-09-30', lines: [line({ description: 'Úklid apartmánu září', net: '11600.00', vat: null, gross: '11600.00', vatRateType: 'none', vatRatePct: null })], partner: { id: 'p3', name: 'Čistá s.r.o.', ico: '11223344', dic: null, vatId: null, country: 'CZ', isVatPayer: false }, vendor: { id: 'v1', partnerId: 'p3', defaultCategoryCode: 'exp_cleaning', defaultVatTreatment: 'rcv_domestic_no_vat', defaultBusinessFlag: 'business', confirmations: 2, pinned: false, multiCategory: false, extractionHints: { subject_cs: 'Apartment cleaning' } } }) });
    expect(r.needsLlm).toBe(false);
    expect(r.llmRequest).toBeNull();
    expect(r.write.lines[0]).toMatchObject({ categoryCode: 'exp_cleaning', vatTreatment: 'rcv_domestic_no_vat', classificationSource: 'vendor_memory', deductibility: 'deductible' });
    expect(r.write.status).toBe('ready');
    expect(r.write.document.summaryCs).toBe('Apartment cleaning for September – tax-deductible expense, no VAT');
    expect(r.write.document.categorizeVersion).toBe(1);
  });

  it('Booking July (AC-9c): EU reverse charge, VAT point = issue date (policy issue_date), rate 21, summary names August', () => {
    const booking = doc({ class: 'received_invoice', taxDocStatus: 'foreign_document', issueDate: '2026-08-03', duzp: null, servicePeriodFrom: '2026-07-01', servicePeriodTo: '2026-07-31', paidAt: null, totalGross: '13699.77',
      lines: [line({ description: 'Commission', net: '12990.12', vat: null, gross: '12990.12', vatRateType: 'none', vatRatePct: null }), line({ id: L2, position: 2, lineType: 'fee', description: 'Payments service fee', net: '709.65', vat: null, gross: '709.65', vatRateType: 'none', vatRatePct: null })],
      partner: { id: 'p4', name: 'Booking.com B.V.', ico: null, dic: null, vatId: 'NL805734958B01', country: 'NL', isVatPayer: null } });
    const out: CategorizeOutput = { subject: 'Booking.com commission', dominantCategoryCode: 'exp_platform_commission', businessLikelihood: 'business', personalReason: null, lines: [
      { position: 1, categoryCode: 'exp_platform_commission', alternativeCategoryCode: null, confidence: 0.95, supplyKind: 'service', assetCandidate: false, mixedUseItem: false, placeOfSupplyAbroad: false, reason: 'x' },
      { position: 2, categoryCode: 'exp_payment_fees', alternativeCategoryCode: null, confidence: 0.9, supplyKind: 'service', assetCandidate: false, mixedUseItem: false, placeOfSupplyAbroad: false, reason: 'x' } ] };
    const r = plan({ doc: booking, llm: out });
    expect(r.write.lines.map((l) => [l.categoryCode, l.vatTreatment, l.vatRatePct])).toEqual([['exp_platform_commission', 'rcv_eu_service_reverse_charge', '21'], ['exp_payment_fees', 'rcv_eu_service_reverse_charge', '21']]);
    expect(r.write.document.vatPointDate).toBe('2026-08-03');
    expect(r.write.fields).toContainEqual(expect.objectContaining({ fieldKey: 'lines[2].supply_kind', source: 'llm', valueText: 'service' }));
    expect(r.write.document.summaryCs).toBe('Booking.com commission for July – tax-deductible expense, you pay VAT 21 % yourself in the return for August');
    expect(r.write.status).toBe('ready');
  });

  it('foreign currency: resolves the CNB rate for the document and stores fx_rate / fx_rate_date', () => {
    const r = plan({ doc: doc({ currency: 'USD', totalGross: '10.46', issueDate: '2026-10-05', duzp: null, paidAt: null, class: 'received_invoice', taxDocStatus: 'foreign_document', lines: [line({ description: 'Cloudflare Pro', net: '10.46', vat: null, gross: '10.46', vatRateType: 'none', vatRatePct: null })], partner: { id: 'p5', name: 'Cloudflare, Inc.', ico: null, dic: null, vatId: null, country: 'US', isVatPayer: null }, fxRates: [{ rateDate: '2026-10-02', currency: 'USD', amount: 1, rate: '23.456' }] }), llm: llm({ subject: 'Cloudflare hosting', businessLikelihood: 'business' }, { categoryCode: 'exp_hosting_domains', confidence: 0.95, supplyKind: 'service' }) });
    expect(r.write.document.fxRate).toBe('23.456000');
    expect(r.write.document.fxRateDate).toBe('2026-10-02');
    expect(r.write.lines[0]?.vatTreatment).toBe('rcv_non_eu_service_reverse_charge');
  });

  it('a blocking post-check or an open question keeps needs_review; a null direction throws', () => {
    const base = doc({ questions: [answered('business_or_personal', 'business')], fields: [{ fieldKey: 'summary.subject', valueText: 'Backpack', valueJson: null, source: 'llm' }] });
    expect(plan({ doc: base, llm: llm({ businessLikelihood: 'business' }, { confidence: 0.9 }) }).write.status).toBe('ready');
    expect(plan({ doc: base, llm: llm({ businessLikelihood: 'business' }, { confidence: 0.9 }), postChecks: [{ ruleId: 'X', severity: 'blocking' }] }).write.status).toBe('needs_review');
    expect(() => plan({ doc: doc({ direction: null }) })).toThrow('CategorizeInputError');
  });

  it('never emits a non-user field for a key the user already set', () => {
    const r = plan({ doc: doc({ fields: [{ fieldKey: 'lines[1].category_code', valueText: 'exp_office_supplies', valueJson: null, source: 'user' }, { fieldKey: 'summary.subject', valueText: 'Pens', valueJson: null, source: 'user' }] }) });
    expect(r.needsLlm).toBe(false);
    expect(r.write.lines[0]).toMatchObject({ categoryCode: 'exp_office_supplies', classificationSource: 'user' });
    expect(r.write.fields.filter((f) => f.fieldKey === 'lines[1].category_code')).toEqual([]);
    expect(r.write.document.summaryCs?.startsWith('Pens')).toBe(true);
  });
});
```
   The thrown error's message must contain `CategorizeInputError` (or set `name` and let vitest match: `toThrow('CategorizeInputError')` matches the message — put the class name in the message, e.g. `CategorizeInputError: direction`).
   Command: `pnpm --filter @shoebox/worker test -- categorize-plan 2>&1 | tail -30` → all pass; `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → 0 errors.

## 5. Do not touch

Everything outside the two files. Hard rules 1 (every threshold via `rules`), 2 (LLM output passes through the cascade's acceptance; never written as `user`), 6 (summary via `buildSummary`).

## 6. Commands

`pnpm --filter @shoebox/worker test -- categorize-plan 2>&1 | tail -30`; `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`.

## 7. Acceptance

- [ ] Tests pass; typecheck clean. - [ ] `plan.ts` imports nothing from `@shoebox/db` except types, and no I/O.

## 8. Stop and ask

Per TEMPLATE §8. If a golden expectation disagrees with what 0303/0304/0305 actually return (e.g. `vatRatePct` shape), stop after the second failure and report the actual value: the orchestrator decides which brief is wrong.

## 9. Report

`docs/tasks/0319-report.md`.

## Risk list

`plan.ts` entirely (money strings, user-field protection, status rule).

## Owner steps

None.
