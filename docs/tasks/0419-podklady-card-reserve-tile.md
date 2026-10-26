# 0419: Income-tax summary card, its page, and the tax-reserve tile

Status: review
Ticket: P4-POD-07 (card + page, no partial-XML dialog), M11 §5.2 reserve tile | Depends on: 0365 (lane C, merged), 0418 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

From January to June, Přehled shows a card, "Income-tax summary for {last year}". The card has readiness warnings above the buttons and these buttons:
- View, which opens `/prehled/podklady/{year}`;
- Prepare summary;
- Download PDF and Download XLSX;
- "Handed to the accountant / filed".

The rest of the year, a small text link to the same page, for this year, sits under the cards instead.

Přehled also gets the tax-reserve tile: "≈ 151 600 Kč · estimate", with a "?" that explains how we count. It has no red colour and never says "you owe".

## 2. Context (read only these)

- `apps/web/src/podklady/view.ts`: `PodkladyPreviewView`, `TaxReserveView`. Money fields are `toFixed2()` strings.
- `apps/web/src/podklady/preview.ts`: `shouldShowPodkladyCard(today, year, hasData)`, `PODKLADY_WRITE_ROLES`, `parseYearParam`.
- `apps/web/src/podklady/load.ts`:
  - `loadPodkladyPreview(orgId, year, role)` returns a `PodkladyPreviewView` and can throw when `WORKER_DATABASE_URL` is missing, so always wrap it in try/catch;
  - `loadTaxReserve(orgId)` returns a `TaxReserveView`.
- `apps/web/app/(app)/prehled/page.tsx`: it already loads the VAT cards. Add to it in the same style.
- `apps/web/src/overview/overview-screen.tsx`: it has the `vat?: ReactNode` prop, the `card`/`primaryLink`/`textLink` class strings, and `HelpTip` from `./help-tip`.
- `apps/web/src/vat/vat-actions.tsx`: reuse `MarkFiledForm` as it is (it POSTs `/api/v1/filings/{id}/mark-filed`), and copy the `PrepareButton` pattern.
- `apps/web/src/vat/preview-view.tsx` lines 1–45: the `whole()`, `fullDate()` and `label()` helpers.
- `POST /api/v1/podklady/{year}`, body `{}`, returns 202 `{ filingId, answersVersion }`. The browser sends the Origin header itself.
- Existing en.json keys (do not change them):
  - `podklady.title` `{year}`, `podklady.disclaimer`, `podklady.watermark` `{date}`, `podklady.no_data` `{year}`, `podklady.changed_after_handoff` `{diff}`;
  - `podklady.headline.income|expenses|expenses_flat|base|advances`;
  - `podklady.readiness.{code lowercased}` (params come from `readiness[].params`);
  - `podklady.checklist.*` (the summary's `checklistKeys` are full keys);
  - `podklady.card.view|pdf|xlsx|mark_filed`;
  - `reserve.label`, `reserve.badge`, `reserve.how`, `reserve.pausalni_dan` `{paid}` `{due}`.

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/podklady/card-view.ts` | new, pure |
| `apps/web/test/podklady-card-view.test.ts` | new |
| `apps/web/src/podklady/podklady-card.tsx` | new, server component |
| `apps/web/src/podklady/podklady-actions.tsx` | new, `'use client'` |
| `apps/web/src/podklady/reserve-tile.tsx` | new, server component |
| `apps/web/app/(app)/prehled/podklady/[year]/page.tsx` | new |
| `apps/web/src/overview/overview-screen.tsx` | edit: add `tax?: ReactNode`, rendered right after `{vat}` |
| `apps/web/app/(app)/prehled/page.tsx` | edit |
| `packages/i18n/messages/en.json` | edit: new keys in step 7 only |
| `docs/context/known-issues.md` | edit: add K-D04 |

## 4. Steps

1. **`card-view.ts`** (pure):
   ```ts
   export interface PodkladyCardModel {
     readonly year: number;
     readonly title: string;                 // t('podklady.title', { year: String(year) })
     readonly warnings: readonly string[];   // readiness texts, severity 'block' first, then the rest, in API order
     readonly changed: string | null;        // podklady.changed_after_handoff with diff text, when changedSinceHandoff
     readonly watermark: string | null;      // podklady.watermark with { date: summary.generatedOn as D. M. YYYY } when watermark
     readonly viewHref: string;              // /prehled/podklady/{year}
     readonly pdfHref: string | null;        // downloadUrls.pdf
     readonly xlsxHref: string | null;       // downloadUrls.xlsx
     readonly canPrepare: boolean;           // canGenerate && (latestFiling === null || changedSinceGeneration)
     readonly markFiledId: string | null;    // latestFiling.id when state is 'generated' or 'downloaded' and canGenerate
   }
   export function readinessText(c: { code: string; params: Record<string, string | number> }): string | null;
   export function podkladyCardModel(p: PodkladyPreviewView): PodkladyCardModel;
   export function reserveText(r: TaxReserveView): { main: string; badge: string } | null;
   ```
   - **`readinessText`**: the key is `podklady.readiness.${code.toLowerCase()}`. When the key is in `catalogs.en`, return `t(key, params)`; else return null, and the caller drops it. Number params pass through. Read the severity values with `grep -n "ReadinessSeverity" packages/domain/src/income-tax/readiness.ts`; if there is no `'block'`, use the most severe value it has.
   - **Diff text**: each `diff` item becomes `"{label}: {before} → {after}"`. The label comes from `podklady.headline.{field}`, and `before`/`after` are whole crowns, formatted the way `whole()` in `preview-view.tsx` does. Join the items with `'; '`.
   - **`summary.generatedOn`**: `summary` is `unknown`, so read it with a small type guard: `typeof s === 'object' && s !== null && 'generatedOn' in s && typeof s.generatedOn === 'string'`.
   - **`reserveText`**: returns null for kind `none`. For `estimate` with `display` it returns `{ main: '≈ ' + whole(display), badge: t('reserve.badge') }`. For `pausalni_dan` with both `paid` and `due` it returns `{ main: t('reserve.pausalni_dan', { paid, due }), badge: t('reserve.badge') }`. There, `paid` and `due` are whole numbers with no currency sign, because the copy already says Kč: use `new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value as unknown as number)`. Any other case returns null.
   - Never use `Number()` or `parseFloat` on money.
2. **`test/podklady-card-view.test.ts`**: build `PodkladyPreviewView` fixtures inline. Test:
   - the warnings order;
   - an unknown code is dropped;
   - `canPrepare` when there is no filing, and when `changedSinceGeneration` is true;
   - `markFiledId` only for generated or downloaded;
   - the changed text contains both amounts (use a regex for the digits, since `Intl` may use non-breaking spaces);
   - `reserveText` for none, estimate (`'151600.00'` gives a string matching `/151\s?600/`) and pausalni_dan.
3. **`podklady-actions.tsx`** (`'use client'`): `PrepareSummaryButton({ year })`. It POSTs `/api/v1/podklady/${year}` with `{}`. On 202 it shows `role="status"` `podklady.action.preparing` and calls `router.refresh()`. Otherwise it shows `role="alert"` `podklady.action.failed`. The label is `podklady.action.prepare`. Use the `Button` from `@shoebox/ui`.
4. **`podklady-card.tsx`**: `PodkladyCard({ model, canWrite })` renders a `<section aria-labelledby="podklady-title">` with the `card` classes from overview-screen. Inside:
   - the h2 title;
   - the watermark, as plain text;
   - `<ul>` warnings, above the buttons;
   - the changed text;
   - the buttons row: View (`primaryLink`), PDF and XLSX as `<a href download>` (`textLink`), and `PrepareSummaryButton` when `canWrite && canPrepare`;
   - when `canWrite && markFiledId`, `<details><summary>{t('podklady.card.mark_filed')}</summary><MarkFiledForm filingId=… periodEnd={`${year}-12-31`} /></details>`. Check `MarkFiledForm`'s prop names in vat-actions.tsx first;
   - `podklady.disclaimer` as small text.

   `ReserveTile({ text })` (in `reserve-tile.tsx`) renders a `card` section with the h2 `reserve.label`, then `<p className="num text-kpi">{main}</p>`, then a badge `<span>` with `badge`, then `<HelpTip term={t('reserve.label')} text={t('reserve.how')} />`. Use no warning or destructive tokens.
5. **`prehled/page.tsx`**:
   - Season year: `const lastYear = Number(asOf.slice(0, 4)) - 1` (a year, not money).
   - With an `orgId` and a role, do two separate try/catch blocks, each failing to "nothing":
     - `preview = await loadPodkladyPreview(orgId, lastYear, role)`, and `show = shouldShowPodkladyCard(asOf, lastYear, !preview.empty).show`;
     - `reserve = reserveText(await loadTaxReserve(orgId))`.
   - `canWritePodklady = PODKLADY_WRITE_ROLES.includes(role)`.
   - Pass `tax={<>{show && preview ? <PodkladyCard model={podkladyCardModel(preview)} canWrite={canWritePodklady} /> : <p><Link href={`/prehled/podklady/${thisYear}`} className={textLink-like classes}>{t('podklady.link')}</Link></p>}{reserve ? <ReserveTile text={reserve} /> : null}</>}`.
   - Define the link classes locally, copying `textLink` from overview-screen.
6. **`prehled/podklady/[year]/page.tsx`**: `parseYearParam(params.year, asOf)` → `notFound()` on null. Get the role from `getOrgContext()` (`ctx.active.role`, as `prehled/page.tsx` does). Load the preview in a try/catch; on an error show `podklady.page.unavailable`. Metadata title: `podklady.page.title`. Render:
   - a back link `vat.preview.back` to `/prehled`;
   - h1 `podklady.title`;
   - when `empty`: `podklady.no_data` and stop;
   - otherwise the same block as the card (reuse `PodkladyCard` with the model). Then a "Main numbers" `<dl>` (h2 `podklady.page.numbers`) with income, expenses (`podklady.headline.expenses_flat` with `{ rate }` when `summary.headline.label === 'flat'` and `summary.flatRate.rate` is a number or string; else `podklady.headline.expenses`), base and advances (`summary.advancesPaid`), each as whole crowns. Read them from `summary` with small guards; skip a line whose value is not a string;
   - then h2 `podklady.page.not_included` with a `<ul>` of `t(key)` for each `summary.checklistKeys` entry that is in `catalogs.en`.
   - Do not show the partial-XML option (K-D04).
7. **`en.json`**: add only these keys. Plain English, no em-dashes.
   - `podklady.link`: "Income-tax summary"
   - `podklady.action.prepare`: "Prepare summary"
   - `podklady.action.preparing`: "Preparing. This page updates in a minute."
   - `podklady.action.failed`: "That didn't work. Try again."
   - `podklady.page.title`: "Income-tax summary"
   - `podklady.page.unavailable`: "The summary can't be shown right now. Try again later."
   - `podklady.page.numbers`: "Main numbers"
   - `podklady.page.not_included`: "Not in this summary"
8. **`known-issues.md`**: add a row `K-D04`: "Podklady page shows the headline numbers, readiness and checklist only: no category, flat-rate comparison, asset blocks or tappable drill-down yet, no answers form, and no partial DPFDP7 dialog (hidden until `partialXmlEligible`)." Follow the file's table format.

## 5. Do not touch

`apps/web/src/podklady/{view,preview,load,generate,db,dpfdp7}.ts`, the API routes, `packages/domain`, migrations, `cs.json`, and existing en.json values. No new dependency. Hard rule 1: money stays a string, and is formatted only with `Intl`/`Money` as in `formatCzkWhole`.

## 6. Commands

- `pnpm --filter @shoebox/web test -- test/podklady-card-view.test.ts 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm exec biome check apps/web/src/podklady apps/web/app/\(app\)/prehled apps/web/src/overview apps/web/test/podklady-card-view.test.ts packages/i18n/messages/en.json --write 2>&1 | tail -20`
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -15`
- `python3 scripts/context_lint.py 2>&1 | tail -3`

## 7. Acceptance

- [ ] Tests pass; typecheck clean; biome clean; i18n tests and context lint OK.
- [ ] The card shows only in January–June for last year; the tile hides for kind `none`; no float on money.

## 8. Stop and ask

As TEMPLATE §8. If a name in §2 differs, use what the code has and note it in the report.

## 9. Report

`docs/tasks/0419-report.md`, 150 tokens at most. Set `Status: review`.
