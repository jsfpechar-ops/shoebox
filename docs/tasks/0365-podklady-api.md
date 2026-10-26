# 0365: Podklady API: preview, generate, download, tax-reserve (contract for lane D)

Status: todo
Ticket: P4-POD-05 (routes), P4-POD-03 (`GET /dashboard/tax-reserve`) | Depends on: 0359, 0363, 0364, 0345 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

Thin Route Handlers plus pure view builders that lane D's screens (P4-POD-07) consume: the live preview with readiness and the "changed since hand-off" diff, the generation request (answers validated, RČ impossible), PDF/XLSX download through the shared filing download route, and the cached tax-reserve tile payload. No screen here.

## 2. Context

M06 §6 routes (`/api/v1`): `GET /podklady/{year}/preview` → `PodkladySummary` + readiness (live, not stored) · `POST /podklady/{year}` `{answers}` → 202 `{filingId}` · `GET /filings/{id}/download?format=pdf|xlsx` · `GET /dashboard/tax-reserve` → cached estimate · `POST /filings/{id}/mark-filed` (shared with M05, 0345). Roles: owner/member generate; accountant read + download; viewer read. M06 §4.13: after `marked_filed`, a change in the year's ledger shows `podklady.changed_after_handoff` with a diff of totals and a regenerate button (no amendment logic). M06 §7 card: Přehled card January–June for the previous year, on demand any time; readiness warnings above the buttons. M06 §8 #8: a year with no data → no card, preview says `podklady.no_data`.

Web conventions (0345 §2): routes under `apps/web/app/api/v1/...` use `requireActiveRole([...])` (`apps/web/src/auth/org-context.ts`, returns `{ ok, orgId, userId, role, code }`); the Supabase server client runs queries under RLS; pure decisions live in `apps/web/src/<area>/*.ts` and are what the tests cover (no HTTP harness). Enqueue helpers: `apps/web/src/documents/enqueue.ts` (`enqueueDocCategorize` shows how the web app sends a pg-boss job; add `enqueuePodkladyGenerate(orgId, year, answersVersion, userId)` there). Reading rows: copy the mechanism 0351's `apps/web/src/vat/periods.ts` uses to call `@shoebox/db` readers; if that file is not in the tree, read with the Supabase server client (`apps/web/src/overview/load.ts` pattern, explicit `.eq('org_id', orgId)` on every select) and map rows in `apps/web/src/podklady/rows.ts` to the 0363 `PodkladyRows` shape (same field names, so the two paths are interchangeable).

Download (0345's `decideDownload` in `apps/web/src/vat/filings.ts`): for `filing.type === 'PODKLADY_DPFO'` the allowed formats are `pdf` and `xlsx` (file = `pdfPath` / `xlsxPath`, content types `application/pdf` / `XLSX_MIME`, filename `podklady-{year}.pdf|xlsx`), the `xsd_invalid` and `period_changed` rules do not apply (a hash change is reported by the preview instead), `markDownloaded` as before. `format=xml|zip` on a podklady filing → 400 `bad_format`. Mark-filed works unchanged (`generated|downloaded → marked_filed`, no obligation to complete: skip `completeObligation` when `type` is `PODKLADY_DPFO`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/podklady/view.ts` | create | the JSON contract types + `serializeMoney` |
| `apps/web/src/podklady/preview.ts` | create | `buildPodkladyPreview`, `shouldShowPodkladyCard`, `podkladyYearsFor`, `diffTotals`, role constants |
| `apps/web/src/podklady/load.ts` | create | `loadPodkladyPreview(orgId, year, role)`, `loadTaxReserve(orgId)` (server only) |
| `apps/web/src/podklady/generate.ts` | create | `decideGenerate(role, body)`, `storeAnswersDraft(...)` |
| `apps/web/src/documents/enqueue.ts` | edit | `enqueuePodkladyGenerate` |
| `apps/web/src/vat/filings.ts` | edit | `decideDownload` podklady formats; mark-filed skip |
| `apps/web/app/api/v1/podklady/[year]/preview/route.ts` | create | GET |
| `apps/web/app/api/v1/podklady/[year]/route.ts` | create | POST |
| `apps/web/app/api/v1/dashboard/tax-reserve/route.ts` | create | GET |
| `apps/web/test/podklady-api.test.ts` | create | below |

## 4. Steps

1. `view.ts` exports exactly (this is the lane D contract; Money as `toFixed2()` strings, dates `YYYY-MM-DD`):
```ts
export type MoneyString = string;
export interface PodkladyFilingView { readonly id: string; readonly state: string; readonly generatedAt: string | null; readonly markedFiledAt: string | null; readonly pdf: boolean; readonly xlsx: boolean; readonly ledgerHash: string | null; readonly answersVersion: number | null }
export interface TotalsDiff { readonly field: 'income' | 'expenses' | 'base'; readonly before: MoneyString; readonly after: MoneyString }
export interface PodkladyPreviewView {
  readonly year: number; readonly empty: boolean; readonly blocked: boolean; readonly watermark: boolean;
  readonly summary: unknown;                        // PodkladySummary with Money serialized (serializeMoney)
  readonly readiness: ReadonlyArray<{ code: string; severity: string; params: Record<string, string | number> }>;
  readonly latestFiling: PodkladyFilingView | null;
  readonly changedSinceGeneration: boolean; readonly changedSinceHandoff: boolean; readonly diff: readonly TotalsDiff[];
  readonly canGenerate: boolean; readonly canDownload: boolean; readonly partialXmlEligible: boolean;
  readonly downloadUrls: { pdf: string | null; xlsx: string | null };   // /api/v1/filings/{id}/download?format=pdf|xlsx
}
export interface PodkladyCardView { readonly year: number; readonly show: boolean; readonly reason: 'season' | 'on_demand' | 'no_data' }
export interface TaxReserveView { readonly kind: 'estimate' | 'pausalni_dan' | 'none'; readonly asOf: string | null; readonly computedAt: string | null; readonly display: MoneyString | null; readonly paid: MoneyString | null; readonly due: MoneyString | null; readonly labelKey: 'reserve.label' | 'reserve.pausalni_dan'; readonly badgeKey: 'reserve.badge'; readonly howKey: 'reserve.how'; readonly payload: unknown }
export function serializeMoney<T>(value: T): unknown;   // JSON round-trip with Money → toFixed2()
```
2. `preview.ts` exports exactly:
```ts
export const PODKLADY_READ_ROLES: readonly MemberRole[] = ['owner', 'member', 'accountant', 'viewer'];
export const PODKLADY_WRITE_ROLES: readonly MemberRole[] = ['owner', 'member'];
export const PODKLADY_DOWNLOAD_ROLES: readonly MemberRole[] = ['owner', 'member', 'accountant'];
export function diffTotals(before: { income: string; expenses: string; base: string } | null, after: { income: string; expenses: string; base: string }): TotalsDiff[];
export function buildPodkladyPreview(summary: PodkladySummary, latest: FilingRow | null, role: MemberRole, ledgerHash: string): PodkladyPreviewView;
export function shouldShowPodkladyCard(today: LegalDate, year: number, hasData: boolean): PodkladyCardView;   // show when hasData and (today in Jan–Jun and year = today.year − 1) → 'season'; hasData otherwise → 'on_demand' with show=false (the card is opened from the menu); !hasData → 'no_data'
export function podkladyYearsFor(today: LegalDate, firstYearWithData: number | null): number[];              // firstYearWithData..today.year, newest first; [] when null
```
`changedSinceGeneration = latest !== null && latest.state ∈ {generated, downloaded, marked_filed} && latest.totals.ledgerHash !== ledgerHash`; `changedSinceHandoff = changedSinceGeneration && latest.state === 'marked_filed'`; `diff = diffTotals(latest.totals.headline, summary.headline)` when changed, else `[]`. `canGenerate = role ∈ WRITE && !blocked && !empty`; `canDownload = role ∈ DOWNLOAD && latest in generated|downloaded|marked_filed`.
3. `generate.ts`: `decideGenerate(role, body: unknown): { ok: true; answers: PodkladyAnswers } | { ok: false; status: 400 | 403; code: 'forbidden' | 'bad_answers' }` (parse with `podkladyAnswersSchema.safeParse(body?.answers ?? {})`); `storeAnswersDraft(supabase, orgId, year, answers, userId)`: `answersVersion = (count of PODKLADY_DPFO filings of the year) + 1`, insert a `draft` filing (`inputs: answers`, `totals: { answersVersion }`, `period_start/end`, `kind 'radne'`, `generated_by`) → `{ filingId, answersVersion }`; then `enqueuePodkladyGenerate(orgId, year, answersVersion, userId)`; route answers 202 `{ filingId, answersVersion }`.
4. `load.ts`: `loadPodkladyPreview(orgId, year, role)` → rows → `buildPodkladySummary(..., createCzRules(), pragueToday(clock))` with `partialXmlAvailable` from `isPartialXmlAvailable(year)` (0367 provides it; until merged, `false` with `TODO(0367)`) → `buildPodkladyPreview`. `loadTaxReserve(orgId)` → `tax_reserve_estimates` row → `TaxReserveView` (`kind 'none'` when no row; `display = payload.display`, `paid/due` for paušál).
5. Routes: preview → `requireActiveRole(PODKLADY_READ_ROLES)`, 200 JSON, `Cache-Control: private, no-store`. POST → `requireActiveRole(PODKLADY_WRITE_ROLES)`, JSON body, `decideGenerate`, 202. Tax reserve → READ roles, 200 JSON, `Cache-Control: private, max-age=300`. Year param: integer 2024..today.year, else 400.
6. `filings.ts` download/mark-filed edits (0345 tests stay green: `pnpm --filter @shoebox/web test -- vat-filings 2>&1 | tail -30`).
7. Test file `apps/web/test/podklady-api.test.ts` (pure only):
```ts
describe('buildPodkladyPreview', () => {
  it('no filing: canGenerate for owner/member only, canDownload false, no diff', …);
  it('generated filing with the same hash: canDownload for accountant, urls pdf/xlsx, changedSinceGeneration false', …);
  it('marked_filed filing with another hash: changedSinceHandoff true, diff lists income/expenses/base before→after', …);
  it('viewer: canGenerate false, canDownload false; blocked summary: canGenerate false', …);
});
describe('shouldShowPodkladyCard and years', () => {
  it('15 March 2027 for 2026 with data → season; 15 August → on_demand; no data → no_data', …);
  it('podkladyYearsFor(2027-02-10, 2025) → [2027, 2026, 2025]; null → []', …);
});
describe('decideGenerate', () => {
  it('viewer → 403; body with rodneCislo → 400 bad_answers; valid answers parse with defaults', …);
});
describe('decideDownload for PODKLADY_DPFO (0345 extension)', () => {
  it('pdf and xlsx allowed with the filing paths and names; xml → 400 bad_format; a changed hash does not 409; first download marks downloaded', …);
});
describe('serializeMoney', () => { it('Money becomes toFixed2 strings, nested; other values untouched', …); });
```
Command: `pnpm --filter @shoebox/web test -- podklady-api 2>&1 | tail -30`.
8. `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. Commit `feat(web): podklady preview/generate/download/tax-reserve API (0365)`.

## 5. Do not touch

Screens under `apps/web/app/(app)` (lane D), `apps/worker`, `packages/domain`.

## 6. Commands

`pnpm --filter @shoebox/web test -- podklady-api 2>&1 | tail -30` · `pnpm --filter @shoebox/web test -- vat-filings 2>&1 | tail -30` · `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Accountant may read and download, viewer read only (P4-POD-05 second acceptance); answers with an RČ never reach the database (400 before any write).
- [ ] The report pastes the final `PodkladyPreviewView`, `PodkladyCardView` and `TaxReserveView` types for lane D.

## 8. Stop and ask

TEMPLATE §8. Stop if the web app has no way to call `@shoebox/db` readers and the Supabase fallback would need more than the selects listed in 0363 §2.

## 9. Report

`docs/tasks/0365-report.md`.

## Risk list

Authorization per route; the download extension in shared `filings.ts`.

## Owner steps

1. Decisions line: "2026-10-26 podklady API under /api/v1/podklady; the Přehled card shows itself January–June for the previous year, otherwise on demand (M06 §7)".
