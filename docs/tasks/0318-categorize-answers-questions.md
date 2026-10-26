# 0318: P1-CAT-04b answers → user fields, and review-question payloads (pure, `apps/worker`)

Status: done
Ticket: P1-CAT-04 | Depends on: 0317 (types), 0303 (merged) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 55k tokens

## 1. Objective

Two pure modules the categorize planner (0319) composes: `applyAnswers` turns answered `review_questions` into `user`-source line fields (so the cascade's stage 0 honours them and nothing else ever overwrites them), and `buildQuestions` turns the cascade's question kinds into the payload shape lane D's review deck renders, grouped per kind and capped at `classification.max_questions_per_document`. English copy keys land in `en.json`.

## 2. Context

**Review-deck contract (lane D, fixed):** `review_questions.payload = {"question":"<i18n key>","params"?:{...},"options":[{"value":"<string>","label":"<i18n key>"}] (1–4 options),"suggested"?:"<value>"}`. The deck stores `answer = {"value": "<one of options[].value>"}`, `answered_by/at`, and applies the effect itself **only** for kind `business_or_personal` (`documents.business_flag`). Every other effect is applied here, on the next `doc.categorize` run. Extra keys inside `params` are allowed (`line_ids`, `merchant`, `item`, `amount_czk`, `top`); an option may carry an extra `text` (plain English label) when no i18n key exists — used for category options; lane D is told.

**M04 §4.5 kinds → answer effect** (as user fields keyed by line position, 05 `document_fields.field_key`):
| kind | option values | effect on `lines[{position}].*` of `params.line_ids` lines |
|---|---|---|
| `business_or_personal` | `business`, `personal`, `mixed` | business → `business_share_pct='100'`; personal → `category_code='private_expense'`, `business_share_pct='0'`; mixed → `business_share_pct='50'` (TODO(decision-mixed-share): deck has no custom % yet) |
| `which_category` | ≤ 3 category codes | `category_code=value` |
| `small_asset_business_use` | `100`, `80`, `50`, `0` | `business_share_pct=value` |
| `asset_over_threshold` | `yes`, `no` | yes → `category_code='asset_long_term'`; no → `category_code='exp_small_assets'` (TODO(cat-04-picker): spec says "user picks expense category"; the user can still edit the line) |
| `supply_kind` | `service`, `goods` | `supply_kind=value` |
| `car_regime` | `actual_costs`, `flat_rate_km`, `not_business_car` | not applied here (TODO(cat-04-car): `organizations.settings.car` is an org write; brief later) |
| `relearn_vendor` | `this_only`, `from_now_on` | not applied here (brief 0322) |

Budget: ≤ `maxQuestionsPerDocument` (2) new questions per document; further ones are deferred. Priority order: `business_or_personal`, `asset_over_threshold`, `small_asset_business_use`, `supply_kind`, `car_regime`, `which_category`. One question per kind per document (lines grouped into `params.line_ids`); a kind with an unanswered question already open is not asked again; an answered kind is not asked again for the same line ids.

Copy (new keys in `packages/i18n/messages/en.json`, English, ICU plurals allowed; `{merchant}`, `{item}`, `{amount}`, `{threshold}` params):
```
"categorize.question.business_or_personal": "Is {item} from {merchant} a personal or a business purchase?"
"categorize.question.which_category": "Where does {item} belong?"
"categorize.question.small_asset_business_use": "Do you also use {item} privately? What share is for the business?"
"categorize.question.asset_over_threshold": "{item} for {amount} is a long-term asset (over {threshold}). Is it one thing you will use for more than a year?"
"categorize.question.car_regime": "How do you use the car for the business?"
"categorize.question.supply_kind": "Is {item} from {merchant} a service or goods?"
"categorize.question.relearn_vendor": "You changed the category for {merchant}. Apply the new one from now on?"
"categorize.option.business": "Business"  "categorize.option.personal": "Personal"  "categorize.option.mixed": "Both"
"categorize.option.pct_100": "100 %"  "categorize.option.pct_80": "80 %"  "categorize.option.pct_50": "50 %"  "categorize.option.pct_0": "0 %"
"categorize.option.yes": "Yes"  "categorize.option.no": "No"
"categorize.option.service": "Service"  "categorize.option.goods": "Goods"
"categorize.option.actual_costs": "Actual costs"  "categorize.option.flat_rate_km": "Flat rate per km"  "categorize.option.not_business_car": "I do not use a car for the business"
"categorize.option.category": "Category"
"categorize.option.this_only": "Only this document"  "categorize.option.from_now_on": "From now on"
```
Types you import: `CategorizeQuestionRow`, `CategorizeLineRow` from `@shoebox/db` (0317); `CascadeResult`, `CategoryDecision`, `CascadeQuestionKind`, `getCategory`, `Money` from `@shoebox/domain`. `amount_czk` is a decimal string (`Money.toString()`), never a number.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/categorize/answers.ts` | create | `applyAnswers` |
| `apps/worker/src/categorize/questions.ts` | create | `buildQuestions`, `QUESTION_PRIORITY` |
| `packages/i18n/messages/en.json` | edit | append the keys above |
| `apps/worker/test/categorize-questions.test.ts` | create | the test below, verbatim |

## 4. Steps

1. Create `apps/worker/src/categorize/answers.ts` exporting exactly:
```ts
import type { CategorizeQuestionRow } from '@shoebox/db';
export type QuestionKind = 'business_or_personal' | 'which_category' | 'small_asset_business_use' | 'asset_over_threshold' | 'car_regime' | 'supply_kind' | 'relearn_vendor';
export interface UserLineField { readonly position: number; readonly key: 'category_code' | 'business_share_pct' | 'supply_kind'; readonly value: string; }
export interface QuestionPayload { readonly question: string; readonly params?: Record<string, unknown>; readonly options: readonly { readonly value: string; readonly label: string; readonly text?: string }[]; readonly suggested?: string; }
/** Parses a stored payload; null when it does not match the deck contract (never throws). */
export function parseQuestionPayload(payload: unknown): QuestionPayload | null;
/** The user line fields implied by the answered questions (answer.value ∈ options; unknown kinds/values ignored). `lineIdToPosition` maps `params.line_ids` to positions; a `business_or_personal` question without line_ids applies to every position. Later answers win (by answeredAt). */
export function applyAnswers(questions: readonly CategorizeQuestionRow[], lineIdToPosition: ReadonlyMap<string, number>): UserLineField[];
/** Kinds with an open (unanswered) question. */
export function openKinds(questions: readonly CategorizeQuestionRow[]): ReadonlySet<string>;
```

2. Create `apps/worker/src/categorize/questions.ts` exporting exactly:
```ts
import type { CategorizeQuestionRow } from '@shoebox/db';
import type { CascadeResult } from '@shoebox/domain';
import type { QuestionKind, QuestionPayload } from './answers';
export const QUESTION_PRIORITY: readonly QuestionKind[] = ['business_or_personal', 'asset_over_threshold', 'small_asset_business_use', 'supply_kind', 'car_regime', 'which_category'];
export interface QuestionContext {
  readonly merchant: string | null;                      // partner name
  readonly lines: readonly { readonly lineId: string; readonly position: number; readonly description: string | null; readonly grossCzk: string | null }[];
  readonly extraLineKinds: readonly { readonly lineId: string; readonly kind: 'supply_kind' }[];   // from VAT ambiguity (0319)
  readonly thresholdCzk: string;                         // rules asset.capitalization_threshold as decimal string
  readonly suggested: Partial<Record<QuestionKind, string>>;   // e.g. business_or_personal from vendor default / LLM likelihood
  readonly topCategories: ReadonlyMap<string, readonly { code: string; label: string; confidence: number }[]>;  // lineId → ≤3 for which_category
  readonly maxQuestions: number;
}
export interface PlannedQuestion { readonly kind: QuestionKind; readonly payload: QuestionPayload; }
/** Groups the cascade's line questions and document questions per kind, skips kinds already open or answered for the same line ids, orders by QUESTION_PRIORITY, caps at maxQuestions. `params` always has `line_ids` (sorted), `item` (first line description or 'this item'), `merchant` ('' when null), `amount_czk` (sum of |grossCzk| of those lines, or null). */
export function buildQuestions(cascade: CascadeResult, existing: readonly CategorizeQuestionRow[], ctx: QuestionContext): { readonly asked: PlannedQuestion[]; readonly deferred: QuestionKind[] };
```
   Options per kind exactly as §2: labels `categorize.option.<value>` except percentages (`categorize.option.pct_<value>`) and category options (`label: 'categorize.option.category'`, `text: <label from topCategories>`, `value: code`).

3. Edit `packages/i18n/messages/en.json`: anchor is the last entry `"help.term.pausal_dan": "flat-rate tax"`; add a comma and the keys of §2 (one per line, same order). Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → passes (keys parse as ICU).

4. Create `apps/worker/test/categorize-questions.test.ts` verbatim; implement until it passes, do not edit it:
```ts
import type { CategorizeQuestionRow } from '@shoebox/db';
import type { CascadeResult, CategoryDecision } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { applyAnswers, openKinds, parseQuestionPayload } from '../src/categorize/answers';
import { buildQuestions, type QuestionContext } from '../src/categorize/questions';

const L1 = '33333333-3333-4333-8333-333333333331';
const L2 = '33333333-3333-4333-8333-333333333332';
const positions = new Map([[L1, 1], [L2, 2]]);

function q(over: Partial<CategorizeQuestionRow>): CategorizeQuestionRow {
  return { id: 'q1', kind: 'which_category', payload: { question: 'categorize.question.which_category', params: { line_ids: [L1] }, options: [{ value: 'exp_cleaning', label: 'categorize.option.category', text: 'Cleaning' }] }, answer: null, answeredAt: null, ...over };
}
function decision(over: Partial<CategoryDecision>): CategoryDecision {
  return { lineId: L1, position: 1, categoryCode: 'exp_other_deductible', taxEffect: 'deductible_expense', decidedBy: 'llm', source: 'llm', confidence: 0.9, ruleId: null, accepted: true, lowValue: false, businessSharePct: '100', deductibility: 'deductible', questions: [], ...over };
}
function cascade(lines: CategoryDecision[], documentQuestions: CascadeResult['documentQuestions'] = []): CascadeResult {
  return { lines, needsLlm: [], documentQuestions, businessFlag: 'business' };
}
function ctx(over: Partial<QuestionContext> = {}): QuestionContext {
  return { merchant: 'Decathlon', lines: [{ lineId: L1, position: 1, description: 'Quechua backpack', grossCzk: '249.00' }, { lineId: L2, position: 2, description: 'Socks', grossCzk: '99.00' }], extraLineKinds: [], thresholdCzk: '80000', suggested: { business_or_personal: 'personal' }, topCategories: new Map([[L1, [{ code: 'exp_other_deductible', label: 'Other deductible', confidence: 0.5 }, { code: 'private_expense', label: 'Personal expense', confidence: 0.4 }]]]), maxQuestions: 2, ...over };
}

describe('parseQuestionPayload', () => {
  it('accepts the deck contract and rejects anything else', () => {
    expect(parseQuestionPayload(q({}).payload)).not.toBeNull();
    expect(parseQuestionPayload({ question: 'k', options: [] })).toBeNull();
    expect(parseQuestionPayload({ question: 'k', options: [{ value: 'a', label: 'l' }, { value: 'b', label: 'l' }, { value: 'c', label: 'l' }, { value: 'd', label: 'l' }, { value: 'e', label: 'l' }] })).toBeNull();
    expect(parseQuestionPayload(null)).toBeNull();
  });
});

describe('applyAnswers', () => {
  it('personal → private_expense and share 0 on the question lines', () => {
    const rows = [q({ kind: 'business_or_personal', payload: { question: 'x', params: { line_ids: [L1, L2] }, options: [{ value: 'business', label: 'a' }, { value: 'personal', label: 'b' }, { value: 'mixed', label: 'c' }] }, answer: { value: 'personal' }, answeredAt: new Date('2026-10-01T00:00:00Z') })];
    expect(applyAnswers(rows, positions)).toEqual(expect.arrayContaining([
      { position: 1, key: 'category_code', value: 'private_expense' }, { position: 1, key: 'business_share_pct', value: '0' },
      { position: 2, key: 'category_code', value: 'private_expense' }, { position: 2, key: 'business_share_pct', value: '0' },
    ]));
  });
  it('business → share 100 only; which_category → category; small_asset 80 → share; supply_kind → service', () => {
    const rows = [
      q({ id: 'a', kind: 'business_or_personal', payload: { question: 'x', params: { line_ids: [L1] }, options: [{ value: 'business', label: 'a' }] }, answer: { value: 'business' }, answeredAt: new Date('2026-10-01T00:00:00Z') }),
      q({ id: 'b', answer: { value: 'exp_cleaning' }, answeredAt: new Date('2026-10-01T00:00:00Z') }),
      q({ id: 'c', kind: 'small_asset_business_use', payload: { question: 'x', params: { line_ids: [L2] }, options: [{ value: '80', label: 'p' }] }, answer: { value: '80' }, answeredAt: new Date('2026-10-01T00:00:00Z') }),
      q({ id: 'd', kind: 'supply_kind', payload: { question: 'x', params: { line_ids: [L2] }, options: [{ value: 'service', label: 's' }] }, answer: { value: 'service' }, answeredAt: new Date('2026-10-01T00:00:00Z') }),
    ];
    const fields = applyAnswers(rows, positions);
    expect(fields).toContainEqual({ position: 1, key: 'business_share_pct', value: '100' });
    expect(fields).toContainEqual({ position: 1, key: 'category_code', value: 'exp_cleaning' });
    expect(fields).toContainEqual({ position: 2, key: 'business_share_pct', value: '80' });
    expect(fields).toContainEqual({ position: 2, key: 'supply_kind', value: 'service' });
    expect(fields.some((f) => f.position === 1 && f.key === 'category_code' && f.value === 'private_expense')).toBe(false);
  });
  it('ignores unanswered rows, values outside the options, unknown kinds and car_regime; the later answer wins', () => {
    const rows = [
      q({ id: 'a', answer: null }),
      q({ id: 'b', answer: { value: 'exp_not_offered' }, answeredAt: new Date('2026-10-01T00:00:00Z') }),
      q({ id: 'c', kind: 'car_regime', payload: { question: 'x', options: [{ value: 'actual_costs', label: 'l' }] }, answer: { value: 'actual_costs' }, answeredAt: new Date('2026-10-01T00:00:00Z') }),
      q({ id: 'd', answer: { value: 'exp_cleaning' }, answeredAt: new Date('2026-10-01T00:00:00Z') }),
      q({ id: 'e', payload: { question: 'x', params: { line_ids: [L1] }, options: [{ value: 'exp_other_deductible', label: 'l' }] }, answer: { value: 'exp_other_deductible' }, answeredAt: new Date('2026-10-02T00:00:00Z') }),
    ];
    expect(applyAnswers(rows, positions)).toEqual([{ position: 1, key: 'category_code', value: 'exp_other_deductible' }]);
    expect([...openKinds(rows)]).toEqual(['which_category']);
  });
});

describe('buildQuestions', () => {
  it('Decathlon: a document-level business_or_personal question with three options and the suggestion', () => {
    const { asked } = buildQuestions(cascade([decision({ accepted: false, questions: ['which_category'] })], ['business_or_personal']), [], ctx());
    expect(asked.map((a) => a.kind)).toEqual(['business_or_personal', 'which_category']);
    const bp = asked[0]?.payload;
    expect(bp).toMatchObject({ question: 'categorize.question.business_or_personal', suggested: 'personal', params: { merchant: 'Decathlon', item: 'Quechua backpack', line_ids: [L1, L2], amount_czk: '348.00' } });
    expect(bp?.options.map((o) => [o.value, o.label])).toEqual([['business', 'categorize.option.business'], ['personal', 'categorize.option.personal'], ['mixed', 'categorize.option.mixed']]);
    const wc = asked[1]?.payload;
    expect(wc?.options).toEqual([{ value: 'exp_other_deductible', label: 'categorize.option.category', text: 'Other deductible' }, { value: 'private_expense', label: 'categorize.option.category', text: 'Personal expense' }]);
    expect(wc?.params).toMatchObject({ line_ids: [L1], amount_czk: '249.00' });
  });
  it('MacBook: small_asset_business_use with the four percentage options', () => {
    const { asked } = buildQuestions(cascade([decision({ categoryCode: 'exp_small_assets', questions: ['small_asset_business_use'] })]), [], ctx({ lines: [{ lineId: L1, position: 1, description: 'MacBook Air', grossCzk: '26990.00' }] }));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.payload.options.map((o) => o.value)).toEqual(['100', '80', '50', '0']);
    expect(asked[0]?.payload.options[1]?.label).toBe('categorize.option.pct_80');
    expect(asked[0]?.payload.params).toMatchObject({ item: 'MacBook Air', amount_czk: '26990.00' });
  });
  it('groups one kind across lines, orders by priority, caps at maxQuestions and reports the deferred kinds', () => {
    const lines = [decision({ accepted: false, questions: ['which_category'] }), decision({ lineId: L2, position: 2, accepted: false, questions: ['which_category'] })];
    const { asked, deferred } = buildQuestions(cascade(lines, ['business_or_personal']), [], ctx({ extraLineKinds: [{ lineId: L2, kind: 'supply_kind' }] }));
    expect(asked.map((a) => a.kind)).toEqual(['business_or_personal', 'supply_kind']);
    expect(deferred).toEqual(['which_category']);
    expect(asked[1]?.payload.params?.line_ids).toEqual([L2]);
  });
  it('does not repeat a kind that is open, nor one answered for the same lines; asks it again for new lines', () => {
    const open = [q({ id: 'o', kind: 'business_or_personal', payload: { question: 'x', params: { line_ids: [L1, L2] }, options: [{ value: 'business', label: 'l' }] } })];
    expect(buildQuestions(cascade([decision({})], ['business_or_personal']), open, ctx()).asked).toEqual([]);
    const answered = [q({ id: 'a', answer: { value: 'exp_cleaning' }, answeredAt: new Date('2026-10-01T00:00:00Z') })];
    expect(buildQuestions(cascade([decision({ accepted: false, questions: ['which_category'] })]), answered, ctx()).asked).toEqual([]);
    const other = buildQuestions(cascade([decision({ lineId: L2, position: 2, accepted: false, questions: ['which_category'] })]), answered, ctx({ topCategories: new Map([[L2, [{ code: 'exp_cleaning', label: 'Cleaning', confidence: 0.6 }]]]) })).asked;
    expect(other.map((a) => a.kind)).toEqual(['which_category']);
  });
  it('asset_over_threshold carries the threshold and yes/no', () => {
    const { asked } = buildQuestions(cascade([decision({ categoryCode: 'asset_long_term', taxEffect: 'asset', questions: ['asset_over_threshold'] })]), [], ctx({ lines: [{ lineId: L1, position: 1, description: 'Camera', grossCzk: '92000.00' }] }));
    expect(asked[0]?.payload).toMatchObject({ question: 'categorize.question.asset_over_threshold', params: { threshold: '80000', amount_czk: '92000.00' } });
    expect(asked[0]?.payload.options.map((o) => o.value)).toEqual(['yes', 'no']);
  });
});
```
   Command: `pnpm --filter @shoebox/worker test -- categorize-questions 2>&1 | tail -30` → all pass; `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → 0 errors.

## 5. Do not touch

`apps/worker/src/doc-extract/*`, `registry.ts`, `worker.ts`, `main.ts`; `cs.json`; `packages/*` except the en.json edit. Hard rules 1 (threshold and max come in via ctx from rules), 6 (keys only in en.json).

## 6. Commands

`pnpm --filter @shoebox/worker test -- categorize-questions 2>&1 | tail -30`; `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`; `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`.

## 7. Acceptance

- [ ] Tests pass; typecheck clean; i18n test passes with the new keys. - [ ] No Czech string added.

## 8. Stop and ask

Per TEMPLATE §8. If `CascadeResult`/`CategoryDecision` are not exported from `@shoebox/domain` (0303 not merged), stop.

## 9. Report

`docs/tasks/0318-report.md`.

## Risk list

`answers.ts` (a wrong mapping silently reclassifies lines).

## Owner steps

None.
