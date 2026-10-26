# 0418: VAT cards on Přehled and the period preview page

Status: todo
Ticket: P3-VAT-12 (screens part) | Depends on: 0351 (lane C VAT API, merged) | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A VAT payer or identified person sees one card per VAT period on Přehled. The card says, in plain words, what is ready, what is missing, or that an accountant is needed. One click opens the period preview page (`/prehled/dph/{periodStart}`), with plain row labels and a drill-down to the documents. From there the user downloads the file(s), follows the short filing guide, and presses "I've filed it". Money is shown from the API's decimal strings and never parsed into a float.

## 2. Context (read only these)

- `apps/web/src/vat/periods.ts`: `PeriodCard`, `CardKind`, `buildPeriodCards`, `loadPeriodCardInputs(supabase, orgId, year, today)` (returns null when the org has no VAT status), `loadPreviewInputs`, `computePreview(form, inputs)`, `parsePeriodStart`, `parseForm`.
- `apps/web/src/vat/filings.ts`: `FILING_WRITE_ROLES`, `FILING_DOWNLOAD_ROLES`.
- `packages/domain/src/vat/preview.ts` lines 1–69: `PeriodPreview`, `PreviewRow`, `PreviewEntry`, `PreviewKhRow`, `PreviewShvRow`. Money fields are `toFixed2()` strings.
- Routes the client calls (all exist):
  - `POST /api/v1/vat/periods/{periodStart}/filings`, body `{ kind: 'radne'|'opravne'|'dodatecne'|'nasledne' }`, returns 202 `{ jobId }`.
  - `POST /api/v1/vat/periods/{periodStart}/workbook`, returns 202 `{ jobId }`.
  - `GET /api/v1/filings/{id}/download?format=xml|zip`, which returns 409 `period_changed` when documents changed after generation.
  - `POST /api/v1/filings/{id}/mark-filed`, body `{ filedOn: 'YYYY-MM-DD', submissionRef?: string }`.
- Patterns to copy:
  - `apps/web/src/overview/overview-screen.tsx`: `card`, `primaryLink` and `textLink` class strings, and `HelpTip`.
  - `apps/web/src/settings/forget-vendor-button.tsx`: client POST, `router.refresh()`, and `role="status"`/`role="alert"`.
- `apps/web/app/(app)/prehled/page.tsx`, the page that hosts the cards.
- `packages/i18n/src/index.ts`: `MessageKey` is typed. For a dynamic key, check `key in catalogs.en` before calling `t(key as MessageKey)`.

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/vat/card-view.ts` | new, pure |
| `apps/web/src/vat/card-view.test.ts` | new |
| `apps/web/src/vat/vat-cards.tsx` | new, server component |
| `apps/web/src/vat/vat-actions.tsx` | new, `'use client'` |
| `apps/web/src/vat/preview-view.tsx` | new, server component |
| `apps/web/app/(app)/prehled/dph/[periodStart]/page.tsx` | new |
| `apps/web/src/overview/overview-screen.tsx` | edit: optional `vat?: ReactNode` prop, rendered right after `<NextPayment>` |
| `apps/web/app/(app)/prehled/page.tsx` | edit: load cards and pass `vat` |
| `packages/i18n/messages/en.json` | edit: `vat.*` keys below |
| `docs/context/known-issues.md` | edit: add K-D03 |

## 4. Steps

1. **`card-view.ts`** (pure, no React). Export:
   ```ts
   export type VatAction =
     | { kind: 'open'; href: string }                       // preview page
     | { kind: 'download'; href: string; label: 'zip' | 'xml' }
     | { kind: 'prepare'; periodStart: string; filingKind: 'radne' | 'opravne' | 'dodatecne' | 'nasledne' }
     | { kind: 'workbook'; periodStart: string }
     | { kind: 'mark_filed'; filingId: string; periodEnd: string };
   export interface VatCardView {
     readonly periodStart: string;
     readonly tone: 'done' | 'ready' | 'todo' | 'warn';
     readonly title: string;          // "VAT for September 2026"
     readonly body: string;           // the situation sentence
     readonly reasons: readonly string[];
     readonly due: string | null;     // "Due 25. 10." or null
     readonly actions: readonly VatAction[];
   }
   export function groupCards(cards: readonly PeriodCard[]): PeriodCard[][]; // by periodStart, newest first; inside a group DPHDP3, DPHKH1, DPHSHV
   export function vatCardView(group: readonly PeriodCard[]): VatCardView;
   ```
   - **The main card** is the DPHDP3 card of the group, or else the first card. `kind` is the main card's kind. Exception: if any card in the group is `not_ready`, `needs_accountant` or `amendment_needed`, that one wins, in this order: `amendment_needed` > `needs_accountant` > `not_ready`.
   - **`title`** = `t('vat.card.title', { period })`. `period` is the month name and year from `periodStart`, in English: build it with `Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })` from `${periodStart}T00:00:00Z`.
   - **`due`** = `t('vat.card.due', { date: 'D. M.' })` from the main card's `dueDate`, or null.
   - **`open`** = `/prehled/dph/${periodStart}`, which every card gets first.
   - **Per kind, `tone` / `body` key / extra actions:**
     - `ready` → `ready` / `vat.card.ready` with `{ amount }` / `download` (`zip` with `/api/v1/filings/{filingId}/download?format=zip` when the group has more than one card, else `xml` with `format=xml`), plus `mark_filed`.
       - `amount` = whole crowns from `amountDue`. Format it with `formatCzkWhole(Money.of(amountDue, 'CZK'))` from `../overview/format`; check the `Money` factory name in `packages/domain/src/money` with grep.
       - If `amountDue` is null, use `vat.card.ready_no_amount`.
     - `draft_unvalidated` → `todo` / `vat.card.preparing` / none.
     - `not_ready` → `todo` / `vat.card.not_ready` with `{ count }` / none. `reasons` = each code mapped by `reasonText(code)`: `vat.reason.{code}` when that key exists, else `vat.reason.other`.
     - `needs_accountant` → `warn` / `vat.card.needs_accountant` / `workbook`.
     - `filed` → `done` / `vat.card.filed` with `{ date }` (filedOn as `D. M. YYYY`) / none.
     - `imported_matches` → `done` / `vat.card.matches_filed` / none.
     - `amendment_needed` → `warn` / `vat.card.amendment` with `{ date }` (the proposal's dueDate) / `prepare` with `filingKind` = `proposal.kind` when it is one of the four kinds, else `opravne`.
     - `overdue_missing` → `warn` / `vat.card.overdue` / `prepare` with `radne`.
2. **`card-view.test.ts`**: one test per kind; one test that a group with DPHDP3 `ready` and DPHKH1 `not_ready` gives `not_ready`; one that a two-card ready group gives the `zip` download; one that an unknown reason code gives the `vat.reason.other` text; and one that `amountDue: '2877'` shows `2 877` (match the number with a regex, because `Intl` may use a non-breaking space).
3. **`vat-actions.tsx`** (`'use client'`). Export `PrepareButton`, `WorkbookButton` and `MarkFiledForm`.
   - Each one POSTs with `fetch`, then shows `role="status"` text on success and calls `router.refresh()`, or shows `role="alert"` `vat.action.failed` on failure.
   - `PrepareButton` posts `{ kind }` and then shows `vat.action.preparing`.
   - `WorkbookButton` shows `vat.action.workbook_preparing`.
   - `MarkFiledForm` is a small form:
     - a date `<input type="date">` labelled `vat.mark_filed.date`, with default today and `max` today;
     - a text input labelled `vat.mark_filed.ref` (optional, `maxLength` 60);
     - a submit button labelled `vat.mark_filed.submit`.
     - On a 400 it shows `vat.mark_filed.bad_date`. Use the `Button` from `@shoebox/ui`.
   - Write no `DownloadLink` component: use a plain `<a href download>` with the `primaryLink` class.
4. **`vat-cards.tsx`**: `VatCards({ views, canWrite }: { views: readonly VatCardView[]; canWrite: boolean })`. It renders a `<section aria-labelledby="vat-title">`:
   - an h2 `vat.section.title` with a `HelpTip` (`vat.help.term`, `vat.help.text`);
   - one `<article>` per view, holding the title (h3), the due line, the body, the reasons as a `<ul>`, and the actions;
   - the disclaimer `vat.disclaimer` as small text under the list.
   - `prepare`, `workbook` and `mark_filed` actions render only when `canWrite`.
   - The `mark_filed` action renders inside `<details><summary>{t('vat.mark_filed.open')}</summary>…</details>`, so there are few buttons.
   - The tone shows as a text badge (`vat.tone.{tone}`) and never as color alone. Use tokens only: `bg-muted` for done, `bg-card` for the rest, and `border-warning` for warn. Check the token names in `packages/ui` with grep.
   - When `views` is empty, render nothing.
5. **`prehled/page.tsx`**:
   - With an `orgId`: `const supabase = await createSupabaseServerClient()`, then `inputs = await loadPeriodCardInputs(supabase, orgId, Number(asOf.slice(0, 4)), asOf)`, wrapped in try/catch so that an error means no cards.
   - `views = inputs === null ? [] : groupCards(buildPeriodCards(inputs)).map(vatCardView)`.
   - `canWrite = FILING_WRITE_ROLES.includes(ctx.active.role)`; check the field name in `src/auth/org-context.ts`.
   - Pass `vat={<VatCards views={views} canWrite={canWrite} />}` to `OverviewScreen`.
6. **`preview-view.tsx`** and **`prehled/dph/[periodStart]/page.tsx`**.
   - **Page**: run `parsePeriodStart` and `parseForm(searchParams.form)`, and call `notFound()` when either is invalid. Load `loadPreviewInputs`; when it is null, show `vat.preview.empty`. Also load this period's cards the way step 5 does, for the year of `periodStart`, and keep the group with this `periodStart`. Metadata title: `vat.preview.title`.
   - **Header**: a back link `vat.preview.back` to `/prehled`, the h1 `vat.card.title`, and the disclaimer.
   - **Form tabs**: links `?form=DPHDP3|DPHKH1|DPHSHV` with `aria-current="page"` on the active one. Show DPHKH1 and DPHSHV only when `inputs.status === 'platce'`. Labels: `vat.form.DPHDP3`, `vat.form.DPHKH1`, `vat.form.DPHSHV`.
   - **DPHDP3**: a `<table>` with columns for the label (`t(row.labelKey)` when the key exists, else `vat.row.unknown` with `{ row }`), the base and the tax, using `row.rounded` and whole crowns. Each row has a `<details>` drill-down listing its entries as one line each: partner, number, `vatPointDate` as `D. M. YYYY`, and `baseCzk`/`vatCzk` formatted with 2 decimals (`Intl` cs-CZ currency CZK). When `fxRate` is present, add `vat.preview.fx` with `{ amount, currency, rate, rateDate }`. After the table, the result: `row64` as `vat.preview.to_pay` and `row65` as `vat.preview.refund`, shown when not `'0'`.
   - **DPHKH1**: one block per `khSections` entry: an h3 from `t(labelKey)` when the key exists, then rows of counterparty, evidence number, `dppd`, `zaklDane1`/`dan1` and `zaklDane2`/`dan2`.
   - **DPHSHV**: rows of country + VAT ID, the `labelKey` text, `plnHodnota` and `plnPocet`.
   - **Actions block** (the same actions as the period's card, minus `open`):
     - When the card kind is `ready`, show the download, then the guide: an h2 `vat.submit.title`, an `<ol>` of `vat.submit.step1`…`vat.submit.step6`, and `vat.submit.checked` (literal text with `TODO(verify)`: see step 7). Then the mark-filed form.
     - When the download returns 409, the browser shows the JSON. That is acceptable for now; K-D03 notes it.
7. **`en.json`**: add these keys. Use plain English, no fine print, and no em-dashes. `{count}` and `{amount}` placeholders follow the existing ICU style; check one plural key in en.json with grep first.
   - `vat.section.title`: "VAT"
   - `vat.help.term`: "VAT return"
   - `vat.help.text`: "Each month you tell the tax office how much VAT you owe. We prepare the file from your documents; you submit it."
   - `vat.card.title`: "VAT for {period}"
   - `vat.card.due`: "Due {date}"
   - `vat.card.ready`: "Your VAT return is ready. You pay {amount}."
   - `vat.card.ready_no_amount`: "Your VAT return is ready."
   - `vat.card.preparing`: "We're preparing your VAT return."
   - `vat.card.not_ready`: "{count, plural, one {# thing} other {# things}} to sort out before we can prepare it."
   - `vat.card.needs_accountant`: "This month needs an accountant. We'll prepare a spreadsheet for them."
   - `vat.card.filed`: "Filed on {date}."
   - `vat.card.matches_filed`: "Matches the return you already filed. Marked as filed."
   - `vat.card.amendment`: "A document changed after you filed. We'll prepare a corrected return, due {date}."
   - `vat.card.overdue`: "The deadline has passed and nothing was filed. Prepare it now."
   - `vat.tone.done`: "Done"
   - `vat.tone.ready`: "Ready"
   - `vat.tone.todo`: "To do"
   - `vat.tone.warn`: "Needs attention"
   - `vat.action.open`: "Show"
   - `vat.action.download_zip`: "Download files"
   - `vat.action.download_xml`: "Download file"
   - `vat.action.prepare`: "Prepare return"
   - `vat.action.preparing`: "Preparing. This page updates in a minute."
   - `vat.action.workbook`: "Prepare spreadsheet for accountant"
   - `vat.action.workbook_preparing`: "Preparing the spreadsheet."
   - `vat.action.failed`: "That didn't work. Try again."
   - `vat.mark_filed.open`: "I've filed it"
   - `vat.mark_filed.date`: "When did you file?"
   - `vat.mark_filed.ref`: "Submission number (optional)"
   - `vat.mark_filed.submit`: "Save"
   - `vat.mark_filed.bad_date`: "Pick a date between the end of the month and today."
   - `vat.mark_filed.done`: "Saved as filed."
   - `vat.disclaimer`: "We prepare the file from your documents. Check it before you submit: you (or your accountant) submit it."
   - `vat.preview.title`: "VAT preview"
   - `vat.preview.back`: "Back to Overview"
   - `vat.preview.empty`: "No VAT entries for this month yet."
   - `vat.preview.base`: "Base"
   - `vat.preview.tax`: "VAT"
   - `vat.preview.documents`: "Documents"
   - `vat.preview.fx`: "{amount} {currency} × ČNB rate {rate} ({rateDate})"
   - `vat.preview.to_pay`: "To pay: {amount}"
   - `vat.preview.refund`: "Refund: {amount}"
   - `vat.row.unknown`: "Row {row}"
   - `vat.form.DPHDP3`: "VAT return"
   - `vat.form.DPHKH1`: "Control statement"
   - `vat.form.DPHSHV`: "EC Sales List"
   - `vat.submit.title`: "How to submit"
   - `vat.submit.step1`: "Open MOJE daně (mojedane.gov.cz) and sign in with your bank identity or eObčanka."
   - `vat.submit.step2`: "Choose Electronic forms, then Load from file."
   - `vat.submit.step3`: "Load the VAT return first, then the control statement and the EC Sales List if you have them."
   - `vat.submit.step4`: "Press Check and fix anything it reports."
   - `vat.submit.step5`: "Press Submit and save the receipt with the submission number."
   - `vat.submit.step6`: "Pay the VAT to your tax office's account, with your DIČ digits as the variable symbol. Then press I've filed it."
   - `vat.submit.checked`: "Steps written from the official MOJE daně help. Labels on the site may differ slightly."
   - `vat.reason.other`: "Something in this month needs a check."
   - One `vat.reason.{CODE}` for each code: `S_BLOCKING_VALIDATION`, `S_DATE_MISSING`, `S_FX_MISSING`, `S_KH_DIC_MISSING`, `S_KH_EVIDENCE_NUMBER_MISSING`, `S_PENDING_DOCUMENTS`, `S_PRIOR_PERIOD_CREDIT_NOTE`, `S_RC_COMMODITY`, `S_PARTIAL_SHARE_DEDUCTION`, `S_BUSINESS_FLAG_UNKNOWN`. Write one short plain sentence each, without the `{doc}` parameter (the card has no document id):
     - `S_PENDING_DOCUMENTS`: "Some documents still wait for your check."
     - `S_FX_MISSING`: "We're waiting for the ČNB exchange rate."
     - `S_KH_DIC_MISSING`: "A supplier's VAT number (DIČ) is missing."
     - the rest in the same style.
8. **`known-issues.md`**: add a row `K-D03`: "VAT screens: no TOTP/aal2 step before download (P3-VAT-12 MFA part), a 409 on download shows raw JSON, and the accountant spreadsheet cannot be downloaded from the card yet (the download route has no xlsx format)." Follow the table format of the file.

## 5. Do not touch

`apps/web/src/vat/periods.ts`, `filings.ts`, the API routes, `packages/domain`, migrations, `cs.json`. No new dependency. Hard rules 1 and 6: money is never parsed with `Number`/`parseFloat` for display; use `Money` or `Intl` on the string as `formatCzkWhole` does.

## 6. Commands

- `pnpm --filter @shoebox/web test -- src/vat/card-view.test.ts 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm exec biome check apps/web/src/vat apps/web/app/\(app\)/prehled apps/web/src/overview packages/i18n/messages/en.json --write 2>&1 | tail -20`
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -15`
- `python3 scripts/context_lint.py 2>&1 | tail -3`

## 7. Acceptance

- [ ] Card view tests pass; web typecheck clean; i18n tests pass; biome clean; context lint OK.
- [ ] No float math on money; every string comes through `t`; tone is never shown by color alone.

## 8. Stop and ask

As TEMPLATE §8. If a name in §2 differs (the `Money` factory, the role field, a token class), use what the code has and note it in the report.

## 9. Report

`docs/tasks/0418-report.md`, 150 tokens at most. Set `Status: review`. Commit with the trailers your orchestrator gives you.
