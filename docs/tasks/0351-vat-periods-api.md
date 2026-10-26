# 0351: VAT periods API: filing cards data, preview, generate, workbook (no screen)

Status: todo
Ticket: P3-VAT-12 (API/data part) | Depends on: 0345, 0349, 0350 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

The data behind the Přehled filing cards and the preview sheet, and the two triggers (generate a filing, generate a workbook), as API routes with pure, tested helpers. Lane D builds the screens (`apps/web/app/(app)/prehled/dph/`, `packages/ui/.../filing-card.tsx`) on top of these. Owner MFA: `TODO(decision-mfa)`, skipped.

## 2. Context

M05 §6 routes (pasted): `GET /vat/periods?year=2026` → list of periods with verdict, totals, obligation status · `GET /vat/periods/{periodStart}/preview?form=DPHDP3|DPHKH1|DPHSHV` · `POST /vat/periods/{periodStart}/filings {kind, discoveredOn?}` → 202 `{bundleId}` (here: 202 `{ jobId }`, the bundle id is known once the job ran) · `POST /vat/periods/{periodStart}/workbook` → 202 `{ jobId }`. Roles: owner/member write; accountant read + workbook; viewer read. M09 §4.9 filing cards (one per verdict): `simple` → "ready to download" with ř.64 and the due date; `not_ready` → the fixable reasons; `needs_accountant` → workbook; `nothing_to_file` → no card for an IO; `marked_filed` → filed on date; `amendment_needed` → the proposal. Click budget (07 §2): IO return ≤ 3 clicks: card → preview → download.

Data sources (Supabase, user RLS): `filings` of the year (`period_start` between), `obligations` (`kind in vat_return, kh, sh, vat_payment, vat_amendment, kh_nasledne`), `vat_ledger_entries` (period starts with entries), `taxpayer_profiles` (status/period). Pure helpers compute the cards from rows. Enqueue from web like `apps/web/src/documents/enqueue.ts` (pg-boss sender, `jobKey`/`jobIdFromKey`); add `enqueueVatFilingGenerate(orgId, payload)` and `enqueueVatWorkbookGenerate(orgId, payload)` to that file (two small functions following `enqueueDocExtract`). Preview: load the period's `vat_ledger_entries` + documents/partners meta via Supabase, map rows → `VatLedgerEntryDraft` (a web copy of 0344's `toEntryDraft` is not allowed twice: move `toEntryDraft` into `packages/db/src/filings.ts` as `entryRowToDraft(row: PeriodEntryRow): VatLedgerEntryDraft` in a step of this brief and import it in both places; the worker file keeps re-exporting it), compute `computeDphdp3`/`computeKh`/`computeShv` and `buildPeriodPreview` (0349) in the route (pure domain code runs fine in the web server).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/filings.ts` | edit | `entryRowToDraft` (moved from worker `map.ts`, which imports it) |
| `apps/web/src/vat/periods.ts` | create | pure card builder + loaders + body parsers |
| `apps/web/src/documents/enqueue.ts` | edit | the two enqueue functions |
| `apps/web/app/api/v1/vat/periods/route.ts`, `apps/web/app/api/v1/vat/periods/[periodStart]/preview/route.ts`, `apps/web/app/api/v1/vat/periods/[periodStart]/filings/route.ts`, `apps/web/app/api/v1/vat/periods/[periodStart]/workbook/route.ts` | create | thin routes |
| `apps/web/test/vat-periods.test.ts` | create | below |

## 4. Steps

1. `periods.ts` exports exactly:
```ts
export type CardKind = 'ready' | 'not_ready' | 'needs_accountant' | 'draft_unvalidated' | 'filed' | 'amendment_needed' | 'imported_matches' | 'overdue_missing';
export interface PeriodCard { readonly periodStart: string; readonly periodEnd: string; readonly form: 'DPHDP3' | 'DPHKH1' | 'DPHSHV'; readonly kind: CardKind; readonly filingId: string | null; readonly bundleId: string | null; readonly amountDue: string | null; readonly dueDate: string | null; readonly obligationState: string | null; readonly reasons: readonly string[]; readonly filedOn: string | null; readonly proposal: { kind: string; dueDate: string } | null }
export interface CardInputs { readonly status: 'platce' | 'identifikovana_osoba'; readonly today: string; readonly filings: ReadonlyArray<{ id: string; type: string; kind: string; origin: string; periodStart: string; periodEnd: string; state: string; bundleId: string | null; xsdValid: boolean | null; totals: Record<string, unknown>; simpleCheck: Record<string, unknown>; filedOn: string | null; amendsFilingId: string | null; discoveredOn: string | null }>; readonly obligations: ReadonlyArray<{ kind: string; periodStart: string | null; dueDate: string; state: string; amountEstimate: string | null }>; readonly periodsWithEntries: readonly string[] }
export function buildPeriodCards(input: CardInputs): PeriodCard[];
export function parseYear(raw: string | null, today: string): number | null;      // 2000..2100 else current year; garbage → null (400)
export function parseGenerateBody(body: unknown): { kind: 'radne' | 'opravne' | 'dodatecne' | 'nasledne'; discoveredOn?: string } | null;
export function parsePeriodStart(raw: string): string | null;                      // 'YYYY-MM-01' or 'YYYY-(01|04|07|10)-01' only
export function parseForm(raw: string | null): 'DPHDP3' | 'DPHKH1' | 'DPHSHV' | null;
```
Card rules (one card per non-superseded filing; plus one `overdue_missing` card for a period that has entries, no filing of that form, and an `open|overdue` obligation past `today`): `marked_filed` + `origin 'generated'` → `filed`; `origin 'imported'` → `imported_matches` only when `totals.matchesFiled === true`, else `filed`; `generated|downloaded` with `xsdValid === true` → `ready` (`amountDue` = `totals.row64`, `dueDate` from the `vat_return`/`kh`/`sh` obligation of that period); `generated|downloaded|draft` with `xsdValid !== true` and verdict `simple` → `draft_unvalidated`; `draft` with verdict `not_ready` → `not_ready` (`reasons` = failing check codes); `needs_accountant` → `needs_accountant`; a `draft` whose `amendsFilingId` is set → `amendment_needed` with `proposal` from `totals.proposal`. Sorted by `periodStart` desc, then form order DPHDP3, DPHKH1, DPHSHV. `VAT_WORKBOOK` filings produce no card (they attach to the `needs_accountant` card as `filingId`).
2. Routes: `GET /vat/periods` (read roles) → `{ year, cards }`; `GET …/preview` (read roles) → `PeriodPreview` (404 when no entries); `POST …/filings` (write roles; `parseGenerateBody`; 202 `{ jobId }`); `POST …/workbook` (owner, member, accountant; 202 `{ jobId }`). Invalid `periodStart` → 400.
3. Test verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { buildPeriodCards, type CardInputs, parseForm, parseGenerateBody, parsePeriodStart, parseYear } from '../src/vat/periods';

const F = (o: Partial<CardInputs['filings'][number]>): CardInputs['filings'][number] => ({ id: 'f', type: 'DPHDP3', kind: 'radne', origin: 'generated', periodStart: '2026-08-01', periodEnd: '2026-08-31', state: 'generated', bundleId: 'b', xsdValid: true, totals: { row64: 2877, ledgerHash: 'h' }, simpleCheck: { verdict: 'simple', checks: [] }, filedOn: null, amendsFilingId: null, discoveredOn: null, ...o });
const base: CardInputs = { status: 'identifikovana_osoba', today: '2026-09-21', filings: [], obligations: [{ kind: 'vat_return', periodStart: '2026-08-01', dueDate: '2026-09-25', state: 'open', amountEstimate: '2877.00' }], periodsWithEntries: ['2026-08-01'] };

describe('buildPeriodCards (M09 §4.9)', () => {
  it('ready card with amount and due date', () => {
    expect(buildPeriodCards({ ...base, filings: [F({})] })).toEqual([{ periodStart: '2026-08-01', periodEnd: '2026-08-31', form: 'DPHDP3', kind: 'ready', filingId: 'f', bundleId: 'b', amountDue: '2877', dueDate: '2026-09-25', obligationState: 'open', reasons: [], filedOn: null, proposal: null }]);
  });
  it('not_ready lists reasons; needs_accountant; unvalidated draft', () => {
    const nr = F({ state: 'draft', xsdValid: null, simpleCheck: { verdict: 'not_ready', checks: [{ code: 'S_PENDING_DOCUMENTS', outcome: 'not_ready' }, { code: 'S_FX_MISSING', outcome: 'pass' }] } });
    expect(buildPeriodCards({ ...base, filings: [nr] })[0]).toMatchObject({ kind: 'not_ready', reasons: ['S_PENDING_DOCUMENTS'] });
    expect(buildPeriodCards({ ...base, filings: [F({ state: 'draft', xsdValid: null, simpleCheck: { verdict: 'needs_accountant', checks: [] } })] })[0]?.kind).toBe('needs_accountant');
    expect(buildPeriodCards({ ...base, filings: [F({ xsdValid: null })] })[0]?.kind).toBe('draft_unvalidated');
  });
  it('filed, imported match, amendment proposal, superseded hidden, workbook hidden', () => {
    const filings = [
      F({ id: 'old', state: 'superseded' }),
      F({ id: 'filed', state: 'marked_filed', filedOn: '2026-09-20' }),
      F({ id: 'imp', origin: 'imported', state: 'marked_filed', filedOn: '2026-09-20', totals: { matchesFiled: true } }),
      F({ id: 'am', state: 'draft', kind: 'opravne', amendsFilingId: 'filed', xsdValid: null, totals: { proposal: { kind: 'opravne', dueDate: '2026-09-25' } } }),
      F({ id: 'wb', type: 'VAT_WORKBOOK' }),
    ];
    const kinds = buildPeriodCards({ ...base, filings }).map((c) => [c.filingId, c.kind]);
    expect(kinds).toEqual([['filed', 'filed'], ['imp', 'imported_matches'], ['am', 'amendment_needed']]);
    expect(buildPeriodCards({ ...base, filings }).find((c) => c.kind === 'amendment_needed')?.proposal).toEqual({ kind: 'opravne', dueDate: '2026-09-25' });
  });
  it('overdue period without a filing gets a card; ordering newest first, DP3 before KH', () => {
    const cards = buildPeriodCards({ ...base, status: 'platce', today: '2026-10-30', periodsWithEntries: ['2026-08-01', '2026-09-01'], filings: [F({ id: 'kh', type: 'DPHKH1', periodStart: '2026-09-01', periodEnd: '2026-09-30' }), F({ id: 'dp', periodStart: '2026-09-01', periodEnd: '2026-09-30' })],
      obligations: [{ kind: 'vat_return', periodStart: '2026-08-01', dueDate: '2026-09-25', state: 'overdue', amountEstimate: null }] });
    expect(cards.map((c) => [c.periodStart, c.form, c.kind])).toEqual([['2026-09-01', 'DPHDP3', 'ready'], ['2026-09-01', 'DPHKH1', 'ready'], ['2026-08-01', 'DPHDP3', 'overdue_missing']]);
  });
  it('parsers', () => {
    expect(parseYear(null, '2026-09-21')).toBe(2026); expect(parseYear('2025', '2026-09-21')).toBe(2025); expect(parseYear('x', '2026-09-21')).toBeNull();
    expect(parsePeriodStart('2026-08-01')).toBe('2026-08-01'); expect(parsePeriodStart('2026-08-02')).toBeNull(); expect(parsePeriodStart('2026-07-01')).toBe('2026-07-01');
    expect(parseGenerateBody({ kind: 'radne' })).toEqual({ kind: 'radne' }); expect(parseGenerateBody({ kind: 'dodatecne', discoveredOn: '2026-11-10' })).toEqual({ kind: 'dodatecne', discoveredOn: '2026-11-10' }); expect(parseGenerateBody({ kind: 'x' })).toBeNull();
    expect(parseForm('DPHKH1')).toBe('DPHKH1'); expect(parseForm(null)).toBe('DPHDP3'); expect(parseForm('nope')).toBeNull();
  });
});
```
Command: `pnpm --filter @shoebox/web test -- vat-periods 2>&1 | tail -30`; `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`; `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` (after the `entryRowToDraft` move).
4. Commit `feat(web): VAT periods API (cards, preview, generate, workbook) (0351)`.

## 5. Do not touch

Screens/components, `packages/ui`, MFA/auth code.

## 6. Commands

`pnpm --filter @shoebox/web test -- vat-periods 2>&1 | tail -30` · `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` · `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Tests green; four routes compile; the worker still typechecks after the move.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0351-report.md`.

## Risk list

`periods.ts` (what the user is told to file), enqueue functions.

## Owner steps

1. Lane D ticket "P3-VAT-12 screens": cards in Přehled from `GET /api/v1/vat/periods`, preview sheet from `…/preview`, download guide (6 steps, `verified_at`, T-20), mark-filed dialog (`POST /api/v1/filings/{id}/mark-filed`), disclaimers, `apps/web/e2e/vat-io.spec.ts` (≤ 3 clicks, axe 0).
2. Decision: owner TOTP enrolment after the first generated filing and `aal2` for downloads (M12 §4.4) — `TODO(decision-mfa)`.
