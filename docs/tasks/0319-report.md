# 0319 report

Status: blocked

## Files changed
None. `git diff --stat` is empty. `plan.ts` and the test file were not created.

## Steps
- Done: none.
- Left: steps 1 to 2 (create `apps/worker/src/categorize/plan.ts`, then the verbatim test and its implementation).

## Commands
None run. No step was completed, so no test or typecheck ran.

## §7 acceptance
None ticked.

## Deviations
- Stopped at the executor checkpoint before step 1. Step 1 needs the body of `planCategorization`, and that depends on types the brief does not spell out.
- Confirmed present on this branch: 0315 (`packages/extraction/src/categorize/run.ts`, `schema.ts`), 0317 (`packages/db/src/document-categorize.ts`), 0318 (`apps/worker/src/categorize/answers.ts`, `questions.ts`), and the 0303/0304/0305 exports in `packages/domain` (`runCategoryCascade`, `deriveVatTreatment`, `deriveVatPointDate`, `resolveFxRate`, `buildSummary`, `parseClassificationRules`, `CATEGORIES`).
- Types still unread: `buildQuestions` context (`QuestionContext`), `buildSummary` input (`SummaryInput`), `deriveVatTreatment` input (`VatTreatmentInput`), `CategorizeRequestInput` remainder and `CategorizeLineOutput`, `CategorizationLineWrite`/`FieldWrite`/`QuestionWrite`, and the `Money` API. Reading them was outside the named-file rule, so I used grep and short ranges only.

## Questions
- Should a fresh session read those types and implement step 1 in one go, or should the brief be split (for example, the LLM request builder as a separate step)? Guessing those shapes is not allowed.

## Owner steps left
None.

## Update: signatures read (coordinator authorized)
Read-only, for the next session. Status stays blocked: no code written.
- `SummaryInput` (domain/taxonomy/summary.ts): asOf, subject{user,llm,vendorHint}, dominant{categoryCode,taxEffect,deductibility,businessSharePct,vatTreatment,vatRatePct}, otherTaxEffects, servicePeriodFrom/To, duzp, issueDate, recurringCategories, vatStatus, deductionAllowed, vatPeriod. Other fields may exist before line 40; not read.
- `VatTreatmentInput` / `VatTreatmentLine` / `VatTreatmentParty` / `VatTreatmentFlags` (domain/vat/treatment.ts) read in full; `VatTreatmentResult` = {treatment, ambiguous?, provisional?, note?}.
- `deriveVatPointDate(doc: VatPointDocument, treatments, profileAt: ProfileAt, payments: PaymentEvidenceDate[], rules)` returns `VatPointResult | null` ({date, rule}); `resolveVatPeriod(profile, date)`.
- `resolveFxRate(currency, date, rates: FxRateRow[], rule: CnbRateRule, maxLookbackDays)` returns `FxRate | null` (perUnit: Decimal). `CnbRateRule` not read.
- `applyAnswers` returns `UserLineField[]` ({position, key, value}). `openKinds` returns ReadonlySet<string>.
- `buildQuestions(cascade, existing, ctx: QuestionContext)` returns {asked: PlannedQuestion[], deferred}. QuestionContext: merchant, lines[{lineId,position,description,grossCzk}], extraLineKinds, thresholdCzk, suggested, topCategories, maxQuestions. `QuestionKind` in apps/worker/src/categorize/answers.ts.
- `CategorizeRequestInput` (extraction run.ts): model, document, business, lines: CategorizeRequestLine[], resolved, categories: CategorizeCategory[], fewShots?. `CategorizeOutput` / `CategorizeLineOutput` (schema.ts) read in full.
- DB write types (db document-categorize.ts): CategorizationLineWrite, FieldWrite (source 'llm'|'rule'|'vendor_memory'|'derived'|'user', confidence string|null), QuestionWrite {kind,payload}, RunWrite.
- Money: `Money.parse(text, currency)`, `negate`, `abs`, `multiply`, `divide`, `compare`, `equals`, `isZero`, `toFixed2`, `toString`. `createCzRules` in domain/rules/cz/index.ts; `parseLegalDate` in domain/dates/index.ts.
- Not yet read: CascadeInput assembly details beyond the brief, `CategorizeRequestLine` use, `resolveFxRate` rule type, `QuestionPayload`.
