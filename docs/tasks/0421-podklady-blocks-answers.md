# 0421: Podklady page blocks and the questions form

Status: review
Ticket: K-D04, P4-POD-07 (rest) | Depends on: 0419, 0420 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The income-tax summary page (`/prehled/podklady/[year]`) shows every block the PDF has, in the order M06 §7 gives:
1. Main numbers (exists);
2. By category;
3. Flat rate vs actual expenses, or Flat-rate tax;
4. Assets and private use;
5. Not in this summary (exists).

Each category row opens a list of its documents. Before preparing the summary, a short questions form (at most 5 questions, each skippable, default "I don't know") sends the answers with the request. The partial DPFDP7 question is never shown, because that feature stays off.

## 2. Context (read only these)

- `apps/web/app/(app)/prehled/podklady/[year]/page.tsx` and `apps/web/src/podklady/card-view.ts` (0419): `wholeCzk` and the summary guards.
- The summary JSON is `PodkladySummary` with every Money turned into a `toFixed2()` string (`serializeMoney`). Read these shapes, and nothing else:
  - `packages/domain/src/income-tax/totals.ts` lines 19–55: `CategoryTotal`, `DrillDownEntry`, `AnnualTotals`;
  - `flat-rate.ts` lines 10–22;
  - `pausalni-dan.ts` lines 8–54;
  - `assets.ts` lines 21–44;
  - `private-use.ts` lines 23–38;
  - `summary.ts` lines 47–90 (`regime`, `flatRate`, `pausalniDan`, `assets`, `privateUse`, `vatNote`).
- `packages/exports/src/podklady-pdf.ts` lines 87–230: what the PDF shows per block. Mirror its content, not its code.
- `packages/domain/src/income-tax/answers.ts`: `podkladyAnswersSchema`, `FLAT_RATES`, `YES_NO_UNKNOWN`. The POST body is `{ answers }`, and unknown keys give 400.
- `apps/web/src/podklady/podklady-actions.tsx`: `PrepareSummaryButton` posts `{}` today.
- Category labels: `categories.label_en` (code → English label). Load it with the server Supabase client, as `apps/web/src/documents/export-formats.ts` ~line 384 does (`select('code, label_en')`), and fall back to the code.
- Existing en.json keys to use (do not change them):
  - `podklady.section.categories|comparison|pausalni_dan|assets`;
  - `podklady.flat.result|lower|higher|equal|cap` and `podklady.flat.caveat.*`;
  - `pd.band_ok|band_exceeded|regime_limit_exceeded|lower_band_possible|advances_ok|advances_missing|advances_overpaid|notice`;
  - `podklady.assets.note`, `podklady.vat.{payer|io|none|mixed}`.
  - Check each key's params in en.json before you use it.

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/podklady/summary-blocks.ts` | new, pure: parse the summary JSON into typed block models |
| `apps/web/test/podklady-summary-blocks.test.ts` | new |
| `apps/web/src/podklady/summary-blocks.tsx` | new, server components that render the models |
| `apps/web/src/podklady/answers-form.tsx` | new, `'use client'` |
| `apps/web/src/podklady/podklady-actions.tsx` | edit: `PrepareSummaryButton` takes optional `answers` |
| `apps/web/app/(app)/prehled/podklady/[year]/page.tsx` | edit |
| `packages/i18n/messages/en.json` | edit |
| `docs/context/known-issues.md` | edit: delete K-D04 |

## 4. Steps

1. **`summary-blocks.ts`** (pure; input `unknown`; never throws; a missing or ill-typed part gives null or empty):
   - **`categoryBlocks(summary, labels: ReadonlyMap<string, string>)`** returns `{ title: string; rows: { label; amount; count; entries: { documentId; date; amount }[] }[] }[]`. Make three groups:
     - "Income" from `totals.income`, using `amount`;
     - "Expenses" from `totals.deductible`, using `businessAmount`;
     - "Not deductible" from `totals.nonDeductible`, using `amount`.
     - Skip empty groups. Amounts are whole crowns via `wholeCzk`.
     - For the drill-down entries, read the `DrillDownEntry` fields from totals.ts; take date and amount from whatever fields it has, and leave them out if they aren't there.
   - **`comparisonBlock(summary)`**: null when `flatRate` is null. Otherwise `{ text, cap: string | null, caveats: string[] }`:
     - `text` is `podklady.flat.equal` when `better === 'equal'`. Otherwise it is `podklady.flat.result` with `rate`, `difference` (whole crowns, no currency sign, because the copy says Kč) and `direction`. `direction` = `t('podklady.flat.lower')` when `better === 'flat'`, else `t('podklady.flat.higher')`.
     - `cap` is shown when `capReached`, using `capKc`.
     - `caveats` = `caveatKeys` that exist in the catalog.
   - **`pausalniBlock(summary)`**: null when `pausalniDan` is null. Otherwise:
     - a band line (`pd.band_ok` with income, band and limit, when `fitBand` is not null);
     - the advances line (`advancesState` → `pd.advances_ok` with paid and expected, `pd.advances_missing` with delta, or `pd.advances_overpaid` with delta);
     - `pd.notice` with `noticeDue` as D. M. YYYY;
     - `warnings` mapped through their `code` keys with their params.
     - Money params are whole numbers with no currency sign.
   - **`assetsBlock(summary)`** returns:
     - `{ assets: Row[]; small: Row[]; note: string; personal: string | null; shares: { description; total; pct }[] }`;
     - `Row = { description | partnerName | documentNumber, date, price }`;
     - `personal` is `podklady.private.personal` with `{ count, sum }` when `personalCount > 0`.
   - **`vatNoteText(summary)`**: `podklady.vat.{vatNote.kind or the string}`. Read the `VatNote` shape in summary.ts first. Null when the key is missing.
   - Use `catalogs.en` key checks for every dynamic key. Never use `Number()` or `parseFloat` on money.
2. **`test/podklady-summary-blocks.test.ts`**: a small inline summary fixture. Test:
   - the three category groups and their amounts;
   - an unknown label falls back to the code;
   - the comparison texts for flat, actual and equal, plus the cap;
   - the pausalni advances states;
   - assets rows plus the personal line;
   - `null`/garbage input gives empty results without throwing.
3. **`summary-blocks.tsx`**: `CategoryBlocks`, `ComparisonBlock`, `PausalniBlock`, `AssetsBlock`, each a `<section>` with an h2 (the existing `podklady.section.*` key). Use the `card` classes from overview-screen.
   - Category rows are `<details><summary>{label} · {amount} · {count}</summary><ul>entries</ul></details>`, each entry linking to `/inbox/{documentId}` with the date and amount. These are the "tappable numbers".
   - Tables have `<th scope>` headers; tokens only.
4. **`answers-form.tsx`**: `AnswersForm({ year, regime, canWrite }: { year: number; regime: string | null; canWrite: boolean })`. It renders nothing when `!canWrite`. Each question is a `<fieldset>` with a `<legend>` and radios (yes, no, I don't know), default "I don't know":
   - Q1 `otherIncome`, always shown. When the regime is `pausalni_dan` and the answer is yes, a whole-number input `otherIncomeApprox` (`inputMode="numeric"`; parse with `/^\d+$/` and `Number`, which is allowed here because it is a whole-CZK answer, not ledger money).
   - Q2 `employmentBeyondLimits` and Q3 `insolvencyOrPartner`: only when the regime is `pausalni_dan`.
   - Q4 `comparisonRate` (select: none, 80, 60, 40, 30): only when the regime is `danova_evidence`, or whatever value summary.ts uses for actual-expense bookkeeping (grep `TaxRegime`).
   - Q5 `activityClass` (same select): only for `pausalni_dan`.
   - Never ask `includePartialXml`.
   - The submit button is `PrepareSummaryButton` with the collected answers. Send only keys of the schema, with `null` for an empty select.
   - The form sits inside `<details><summary>{t('podklady.answers.open')}</summary>`, under the card, so the one-click path stays "Prepare summary" with defaults.
5. **`podklady-actions.tsx`**: `PrepareSummaryButton({ year, answers? })` posts `answers === undefined ? {} : { answers }`.
6. **`page.tsx`**:
   - Load the labels (`categories` `code,label_en`, in a try/catch; empty map on error).
   - After Main numbers, render the VAT note line, CategoryBlocks, then ComparisonBlock or PausalniBlock, then AssetsBlock, then the existing checklist.
   - Put AnswersForm right after the card when `canGenerate` (it already passes `canWrite`). The regime comes from `summary.regime` via a string guard.
7. **`en.json`**: add these keys. Plain English, no em-dashes.
   - `podklady.group.income`: "Income"
   - `podklady.group.expenses`: "Expenses"
   - `podklady.group.not_deductible`: "Not deductible"
   - `podklady.documents_count`: "{count, plural, one {# document} other {# documents}}"
   - `podklady.assets.list`: "Assets"
   - `podklady.assets.small`: "Small assets"
   - `podklady.private.personal`: "{count, plural, one {# personal document} other {# personal documents}} ({sum} Kč), not counted."
   - `podklady.private.shares`: "Partly business"
   - `podklady.answers.open`: "Answer a few questions first (optional)"
   - `podklady.answers.yes`: "Yes"
   - `podklady.answers.no`: "No"
   - `podklady.answers.unknown`: "I don't know"
   - `podklady.answers.none`: "Not set"
   - `podklady.answers.other_income`: "Did you have other income (employment, rent, investments)?"
   - `podklady.answers.other_income_approx`: "Roughly how much, in Kč?"
   - `podklady.answers.employment`: "Were you employed beyond the DPP or DPČ limits?"
   - `podklady.answers.insolvency`: "Are you in insolvency, or a partner in a v.o.s. or k.s.?"
   - `podklady.answers.comparison_rate`: "Flat rate to compare with (%)"
   - `podklady.answers.activity_class`: "Your flat-rate class (%)"
8. **`known-issues.md`**: delete the K-D04 row.

## 5. Do not touch

The podklady API files (`view.ts`, `preview.ts`, `load.ts`, `generate.ts`, `db.ts`, `dpfdp7.ts`), routes, `packages/domain`, `packages/exports`, migrations, `cs.json`, existing en.json values. No new dependency.

## 6. Commands

- `pnpm --filter @shoebox/web test 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm exec biome check apps/web packages/i18n/messages/en.json --write 2>&1 | tail -20`
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -15`
- `python3 scripts/context_lint.py 2>&1 | tail -3`

## 7. Acceptance

- [ ] Tests, typecheck, biome, i18n, context lint pass.
- [ ] Every block hides when its data is missing; no raw JSON; never asks for a rodné číslo or the partial XML.

## 8. Stop and ask

As TEMPLATE §8. If a field named here does not exist in the domain type, use the real one and note it in the report.

## 9. Report

`docs/tasks/0421-report.md`, 150 tokens at most. Set `Status: review`.
