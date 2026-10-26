# 0404: Inbox tabs, the "All" register and its Excel download

Status: todo
Ticket: lane D, M11 §5.1 | Depends on: 0403 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The Inbox gets two tabs, "To review" and "All". "All" is the register: a table of every document with year, paid and search filters and one "Download as Excel" link that downloads exactly the filtered view. Trash comes in 0405.

## 2. Context

- M11 §5.1: opening tab is "To review" when it is non-empty, else "All". Filters live in the URL (`?tab=all&year=2026&paid=unpaid&q=alza`), so back button and sharing work. Excel = 1 click.
- 07: fewest buttons, labels above inputs, tokens only (no raw colours), WCAG 2.2 AA (real `<table>`, `<th scope="col">`, `aria-current="page"` on the active tab link).
- From 0403 (`apps/web/src/documents/register-data.ts`): `parseRegisterFilter`, `applyRegisterFilter`, `loadRegister`, `registerSheet`, `registerFileName`, `REGISTER_LIMIT`, `type RegisterRow`. From `@shoebox/exports`: `createXlsx`, `XLSX_MIME`.
- UI from `@shoebox/ui`: `Table, TableHeader, TableBody, TableRow, TableHead, TableCell, MoneyText, LegalDateText, StatusBadge, Card, Input, Label, cn, focusRing`.
- Current `apps/web/app/(app)/inbox/page.tsx` (58 lines) renders `<h1>`, `<UploadDropzone />`, an empty card or the `<ul>` list, `<AutoRefresh …/>`. Keep all of it; the list becomes the "To review" tab.
- Auth pattern: `requireActiveRole(['owner', 'member', 'accountant', 'viewer'])` returns `{ ok: true, orgId, … } | { ok: false, code }`.

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/documents/inbox-tabs.ts` | new |
| `apps/web/test/inbox-tabs.test.ts` | new (below) |
| `apps/web/src/documents/register-table.tsx` | new |
| `apps/web/app/(app)/inbox/page.tsx` | edit |
| `apps/web/app/api/register/route.ts` | new |
| `packages/i18n/messages/en.json` | edit: keys |

## 4. Steps

1. `en.json`, after `"register.sheet_name"` add:
   ```
     "inbox.tabs.label": "Inbox views",
     "register.filter.year": "Year",
     "register.filter.year_all": "All years",
     "register.filter.paid": "Paid",
     "register.filter.paid_all": "All",
     "register.filter.search": "Search partner, number or IČO",
     "register.filter.apply": "Show",
     "register.download": "Download as Excel",
     "register.count": "{n, plural, one {# document} other {# documents}}",
     "register.empty": "No documents match. Try another year or clear the search.",
     "register.table.label": "All documents",
   ```
   `pnpm --filter @shoebox/i18n test 2>&1 | tail -10`.
2. New `apps/web/src/documents/inbox-tabs.ts`:
   ```ts
   export type InboxTab = 'review' | 'all' | 'trash';
   /** The tab from `?tab=`; without a valid one: review when something needs the user, else all. */
   export function inboxTabOf(param: string | undefined, needsUser: boolean): InboxTab;
   /** `/inbox?tab=…` keeping the register filters (year, paid, q) when they are set. */
   export function inboxHref(tab: InboxTab, filter?: { year: number | null; paid: string; q: string }): string;
   /** Query string for the Excel route: `/api/register?year=2026&paid=unpaid&q=alza` (only set values). */
   export function registerDownloadHref(filter: { year: number | null; paid: string; q: string }): string;
   ```
   Test `apps/web/test/inbox-tabs.test.ts` (do not edit after writing):
   ```ts
   import { describe, expect, it } from 'vitest';
   import { inboxHref, inboxTabOf, registerDownloadHref } from '../src/documents/inbox-tabs';

   describe('inboxTabOf', () => {
     it('opens To review only when something needs the user', () => {
       expect(inboxTabOf(undefined, true)).toBe('review');
       expect(inboxTabOf(undefined, false)).toBe('all');
       expect(inboxTabOf('bogus', false)).toBe('all');
     });
     it('keeps a valid tab from the URL', () => {
       expect(inboxTabOf('all', true)).toBe('all');
       expect(inboxTabOf('trash', true)).toBe('trash');
       expect(inboxTabOf('review', false)).toBe('review');
     });
   });

   describe('hrefs', () => {
     it('builds tab links, keeping set filters only', () => {
       expect(inboxHref('review')).toBe('/inbox?tab=review');
       expect(inboxHref('all', { year: 2026, paid: 'all', q: '' })).toBe('/inbox?tab=all&year=2026');
       expect(inboxHref('all', { year: null, paid: 'unpaid', q: 'alza a.s.' })).toBe(
         '/inbox?tab=all&paid=unpaid&q=alza+a.s.',
       );
     });
     it('builds the download link', () => {
       expect(registerDownloadHref({ year: null, paid: 'all', q: '' })).toBe('/api/register');
       expect(registerDownloadHref({ year: 2026, paid: 'paid', q: '' })).toBe('/api/register?year=2026&paid=paid');
     });
   });
   ```
   Implement (use `URLSearchParams`; `paid` is set only when not 'all'). `pnpm --filter @shoebox/web test -- inbox-tabs 2>&1 | tail -20`.
3. New `apps/web/src/documents/register-table.tsx` (server component, no 'use client'): `export function RegisterTable({ rows }: { rows: readonly RegisterRow[] })`. Wrap a `<Table aria-label={t('register.table.label')}>` in `<div className="overflow-x-auto rounded-control border border-border bg-card">`. Columns (`TableHead scope="col"`): date, partner, number, gross, vat, paid, file (use the `register.col.*` labels). Cells: date via `LegalDateText` (or `—`), partner as a `Link` to `/inbox/<id>` with class `underline` (text `t('inbox.row.unknown_supplier')` when null), number or `—`, gross/vat via `MoneyText value currency` (or `—`), paid text from `register.paid.*` (append ` · ` + formatted date when `paidAt`), file text `register.file.yes` / `register.file.manual`. Numeric cells right-aligned (`text-right tabular-nums`).
4. `apps/web/app/(app)/inbox/page.tsx`:
   - Signature: `export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> })`. Build `const params = new URLSearchParams()` from the awaited object (string values only).
   - After loading `rows` (unchanged), compute `const needsUser = rows.some((r) => r.processing || r.status === 'needs_review')`, `const tab = inboxTabOf(params.get('tab') ?? undefined, needsUser)`, `const filter = parseRegisterFilter(params)`.
   - Under `<h1>`: a `<nav aria-label={t('inbox.tabs.label')}>` with `<ul className="flex gap-2">` of two `Link`s (`inboxHref('review')` label `inbox.tabs.review`, `inboxHref('all', filter)` label `inbox.tabs.all`), `aria-current={tab === x ? 'page' : undefined}`, classes `rounded-control px-3 py-2 text-body aria-[current=page]:bg-muted aria-[current=page]:text-foreground text-muted-foreground` plus `focusRing`.
   - `<UploadDropzone />` stays above the tab content.
   - `tab === 'review'` (and `'trash'` until 0405): the existing empty card / list, but the list shows only `rows.filter((r) => r.processing || r.status === 'needs_review')`; when that is empty show the existing empty card.
   - `tab === 'all'`: load `applyRegisterFilter(await loadRegister(supabase, auth.orgId), filter)` (only when `auth.ok`; reuse one `createSupabaseServerClient()`). Render a `<form method="get" action="/inbox" className="flex flex-wrap items-end gap-3">` with hidden `tab=all`; a labelled native `<select name="year">` (option "" = `register.filter.year_all`, then the current year down to current year − 5), a labelled `<select name="paid">` (all/paid/unpaid with `register.filter.paid_all`, `register.paid.yes`, `register.paid.no`), a labelled `Input name="q" type="search"`, and a `<button type="submit">` `register.filter.apply` (style it like the existing primary button: import `Button` from `@shoebox/ui`). Selects: class `min-h-11 rounded-control border border-input bg-card px-3 text-body` plus `focusRing`; values preselected from `filter`. Then a row with `t('register.count', { n })` and an `<a href={registerDownloadHref(filter)} download className="underline text-body">` `register.download`. Then `<RegisterTable rows={…} />`, or a `Card` with `register.empty` when no rows.
   - `AutoRefresh` stays as is.
5. New `apps/web/app/api/register/route.ts`:
   ```ts
   export const runtime = 'nodejs';
   export async function GET(request: Request): Promise<Response>
   ```
   `requireActiveRole(['owner','member','accountant','viewer'])`; not ok → `Response.json({ error: auth.code }, { status: auth.code === 'unauthenticated' ? 401 : 403 })`. Then `filter = parseRegisterFilter(new URL(request.url).searchParams)`, rows = `applyRegisterFilter(await loadRegister(await createSupabaseServerClient(), auth.orgId), filter)`, `bytes = createXlsx(t('register.sheet_name'), registerSheet(rows), new Date())`, return `new Response(bytes, { headers: { 'Content-Type': XLSX_MIME, 'Content-Disposition': \`attachment; filename="${registerFileName(filter)}"\`, 'Cache-Control': 'no-store' } })`.
6. `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` (0), `pnpm --filter @shoebox/web test -- inbox 2>&1 | tail -20` (pass), `pnpm exec biome check apps/web 2>&1 | tail -15` (fix your files with `--write`). Then `pnpm --filter @shoebox/web build 2>&1 | tail -15` (succeeds; if it needs env vars it lacks, note it in the report and skip).

## 5. Do not touch

`inbox-data.ts`, the document page, other screens. No raw colours, no new dependency. Hard rules 3, 6.

## 6. Commands

As in the steps.

## 7. Acceptance

- [ ] inbox-tabs tests pass; typecheck 0; biome clean.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0404-report.md`, 150 tokens at most. Set `Status: review`.
