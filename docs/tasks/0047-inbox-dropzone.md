# 0047: Inbox with a drop zone and the list of documents

Status: review
Ticket: P1-ING-03 UI part (trimmed, Phase 1 core loop) | Depends on: 0046 (only the `POST /api/documents` contract below; files do not overlap) | Base commit: 37d843b | Branch: task/0047-inbox-dropzone | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The Inbox screen gets one drop zone (drag files in, or tap to pick them, phone camera included) and the list of the org's documents with their status. While anything is still being read, the list refreshes itself, so the user never presses a "refresh" button.

## 2. Context

- Design rules (07, Josef 2026-10-25): fewest buttons; the backend does the rest. No fine print: all text at body size (`text-body`), never a grey caption. Labels in plain Czech. Tokens only (`bg-card`, `border-border`, `text-foreground`, `text-title`, `text-card-title`, `rounded-control`), no raw colors. WCAG 2.2 AA: the drop zone is a real `<label>` around a file `<input>`, reachable by keyboard; status changes are announced through `aria-live="polite"`.
- Every string through `packages/i18n` (hard rule 6): add keys to both `packages/i18n/messages/cs.json` and `en.json` (the catalog test checks both have the same keys and valid ICU).
- Upload contract (built by 0046): `POST /api/documents`, `multipart/form-data`, every file under the field name `files`. Answer `200 { items: Array<{ fileName, status: 'accepted' | 'duplicate', documentId } | { fileName, status: 'rejected', reason: 'type' | 'size' | 'empty' }> }`; errors are non-200.
- Accepted types: `application/pdf,image/jpeg,image/png,image/webp`.
- `StatusBadge` from `@shoebox/ui` takes `{ status: DocumentStatus; cls: DocumentClass; processingSince?: string; now?: number }`. `MoneyText` takes `{ value: string; currency: string }`; `LegalDateText` takes `{ date: LegalDate }`.
- Statuses still being processed: `received, splitting, classifying, extracting, validating, categorizing`.
- Data (RLS applies through the user's session): `from('documents').select('id, status, class, currency, total_gross, issue_date, created_at, partner_snapshot, source_files(original_filename)').eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }).limit(100)`. Auth: `requireActiveRole(['owner','member','accountant','viewer'])` from `apps/web/src/auth/org-context.ts` (import only). A failed query or no org shows the empty state (the e2e fake server has no PostgREST).
- Existing page `apps/web/app/(app)/inbox/page.tsx`:

```tsx
import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: t('inbox.title') };

export default function InboxPage() {
  return <h1 className="text-title">{t('inbox.title')}</h1>;
}
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/inbox-data.ts` | create | `inboxRowOf` (pure) and `loadInbox` |
| `apps/web/test/inbox-data.test.ts` | create | the test file below, verbatim |
| `apps/web/src/documents/upload-dropzone.tsx` | create | client drop zone |
| `apps/web/src/documents/auto-refresh.tsx` | create | client: `router.refresh()` every 4 s while `active` |
| `apps/web/app/(app)/inbox/page.tsx` | edit | title, drop zone, list or empty state |
| `packages/i18n/messages/cs.json` | edit | the keys below |
| `packages/i18n/messages/en.json` | edit | the same keys in English |

No other file may change.

## 4. Steps

1. Add these keys to `packages/i18n/messages/cs.json` (after `"inbox.upload.drop"`) and English equivalents to `en.json` at the same place:

```json
  "inbox.upload.hint": "PDF nebo fotka dokladu. Přečteme ho a zkontrolujeme za vás.",
  "inbox.upload.busy": "Nahrávám…",
  "inbox.upload.accepted": "{n, plural, one {# doklad nahrán, čtu ho} few {# doklady nahrány, čtu je} many {# dokladu nahráno, čtu je} other {# dokladů nahráno, čtu je}}.",
  "inbox.upload.duplicate": "{n, plural, one {# soubor už tu je} few {# soubory už tu jsou} many {# souboru už tu je} other {# souborů už tu je}}.",
  "inbox.upload.rejected": "{n, plural, one {# soubor nejde přečíst} few {# soubory nejdou přečíst} many {# souboru nejde přečíst} other {# souborů nejde přečíst}}. Pošlete PDF nebo fotku do 20 MB.",
  "inbox.upload.error": "Nahrání se nepovedlo. Zkuste to prosím znovu.",
  "inbox.list.label": "Doklady",
  "inbox.row.unknown_supplier": "Dodavatel zatím nepřečten",
  "inbox.empty.title": "Zatím tu nejsou žádné doklady",
  "inbox.empty.body": "Nahrajte fakturu nebo účtenku. Zbytek uděláme za vás.",
```

   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`. Expected: pass. Commit `0047 step 1`.
2. Create `apps/web/test/inbox-data.test.ts` (below, verbatim) and `apps/web/src/documents/inbox-data.ts` with:

```ts
import type { DocumentClass, DocumentStatus, LegalDate } from '@shoebox/domain';
export const PROCESSING_STATUSES: readonly DocumentStatus[];
export interface InboxRow {
  readonly id: string; readonly status: DocumentStatus; readonly cls: DocumentClass;
  readonly title: string | null;   // supplier name, else the original file name, else null
  readonly total: { value: string; currency: string } | null;
  readonly issueDate: LegalDate | null; readonly createdAt: string; readonly processing: boolean;
}
export function inboxRowOf(raw: unknown): InboxRow | null; // null for a row of the wrong shape
export function loadInbox(supabase: SupabaseLike, orgId: string): Promise<InboxRow[]>; // [] on any error
```

   `SupabaseLike` is `Awaited<ReturnType<typeof createSupabaseServerClient>>` (import the type from `../supabase/server`). `source_files` may come back as an object or a one-element array; handle both. Run `pnpm --filter @shoebox/web test -- inbox-data 2>&1 | tail -30`. Expected: pass. Commit `0047 step 2`.

```ts
import { describe, expect, it } from 'vitest';
import { inboxRowOf, PROCESSING_STATUSES } from '../src/documents/inbox-data';

const base = {
  id: '22222222-2222-4222-8222-222222222222',
  status: 'ready',
  class: 'received_invoice',
  currency: 'CZK',
  total_gross: '1210.00',
  issue_date: '2026-10-01',
  created_at: '2026-10-25T10:00:00Z',
  partner_snapshot: { name: 'Dodavatel s.r.o.' },
  source_files: { original_filename: 'faktura.pdf' },
};

describe('inboxRowOf', () => {
  it('maps a read invoice', () => {
    expect(inboxRowOf(base)).toEqual({
      id: base.id,
      status: 'ready',
      cls: 'received_invoice',
      title: 'Dodavatel s.r.o.',
      total: { value: '1210.00', currency: 'CZK' },
      issueDate: '2026-10-01',
      createdAt: '2026-10-25T10:00:00Z',
      processing: false,
    });
  });

  it('falls back to the file name while it is being read', () => {
    const row = inboxRowOf({
      ...base, status: 'received', class: 'unknown', total_gross: null, issue_date: null,
      partner_snapshot: null, source_files: [{ original_filename: 'sken 3.pdf' }],
    });
    expect(row).toMatchObject({ title: 'sken 3.pdf', total: null, issueDate: null, processing: true });
  });

  it('rejects a malformed row', () => {
    expect(inboxRowOf({ id: 1 })).toBeNull();
    expect(inboxRowOf(null)).toBeNull();
  });

  it('knows the processing statuses', () => {
    expect(PROCESSING_STATUSES).toEqual(['received', 'splitting', 'classifying', 'extracting', 'validating', 'categorizing']);
  });
});
```

3. Create `apps/web/src/documents/auto-refresh.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Refreshes the server data every 4 s while documents are still being read; renders nothing. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
```

   Commit `0047 step 3`.
4. Create `apps/web/src/documents/upload-dropzone.tsx` (client). Behaviour:
   - A `<label>` styled as the zone (`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed border-border bg-card p-6 text-center`, plus `focus-within:ring-[3px] focus-within:ring-ring`), containing the visually hidden `<input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only">`, an `Upload` icon from `lucide-react` (`aria-hidden`), the text `t('inbox.upload.cta')` in `text-card-title`, and `t('inbox.upload.hint')` in `text-body`.
   - On `dragover` the zone shows `border-ring`; on `drop` or input `change` it sends all files at once: `const body = new FormData(); for (const f of files) body.append('files', f); await fetch('/api/documents', { method: 'POST', body })`.
   - While sending, the label text is `t('inbox.upload.busy')` and the input is disabled.
   - After the answer, one `<p aria-live="polite" className="text-body">` shows the non-zero counts joined by a space: `inbox.upload.accepted` / `duplicate` / `rejected` with `{ n }`; a non-200 or network error shows `inbox.upload.error`. Then `router.refresh()`.
   - No other buttons.
   Commit `0047 step 4`.
5. Replace the body of `apps/web/app/(app)/inbox/page.tsx` (keep `metadata`). The page is `async`: `const auth = await requireActiveRole(['owner','member','accountant','viewer'])`; rows = `auth.ok ? await loadInbox(await createSupabaseServerClient(), auth.orgId) : []`. Render, in a `<div className="flex flex-col gap-6">`:
   - `<h1 className="text-title">{t('inbox.title')}</h1>`
   - `<UploadDropzone />`
   - empty rows: a `Card` with `t('inbox.empty.title')` (`text-card-title`) and `t('inbox.empty.body')` (`text-body`).
   - otherwise `<ul aria-label={t('inbox.list.label')} className="flex flex-col divide-y divide-border rounded-control border border-border bg-card">`, one `<li className="flex flex-wrap items-center justify-between gap-2 p-4">` per row: left the title (`text-body text-foreground`, `t('inbox.row.unknown_supplier')` when null) and the `LegalDateText` when present; right the `MoneyText` when present and the `StatusBadge status cls processingSince={row.processing ? row.createdAt : undefined}`.
   - `<AutoRefresh active={rows.some((r) => r.processing)} />`
   Imports: `requireActiveRole` from `../../../src/auth/org-context`, `createSupabaseServerClient` from `../../../src/supabase/server` (copy the relative style of `apps/web/app/(app)/layout.tsx`). Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` and `pnpm exec biome ci apps/web packages/i18n 2>&1 | tail -30`. Expected: clean. Commit `0047 step 5`.
6. E2E: run the existing shell spec on Chromium only (WebKit is not installed; never run `playwright install`). A shim for the preinstalled Chromium already exists: `PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/-home-user-leonoperations/fec3a6c0-307f-53e5-ae9f-913c435a941b/scratchpad/pw pnpm --filter @shoebox/web e2e -- shell.spec --project=setup --project=desktop-chromium --project=mobile-chromium 2>&1 | tail -30`. Expected: pass with axe on. If it fails for a reason outside your files (browser, port), record the error in the report and continue; CI runs it.

## 5. Do not touch

`apps/web/src/auth/**`, `apps/web/e2e/**`, `apps/web/app/api/**`, `apps/web/src/documents/upload.ts`, `enqueue.ts`, `supabase-deps.ts` (0046 owns them), `apps/web/app/(app)/layout.tsx`, `apps/web/app/(app)/prehled/**`, keys outside `inbox.*`. Hard rule 6.

## 6. Commands

- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`
- `pnpm --filter @shoebox/web test -- inbox-data 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm exec biome ci apps/web packages/i18n 2>&1 | tail -30`
- the e2e command of step 6.

## 7. Acceptance

- [ ] The test file is unchanged and passes; i18n test passes.
- [ ] No literal Czech or English text in the `.tsx` files (custom lint passes).
- [ ] No raw color, no `text-sm`/`text-xs`, no `text-muted-foreground` in the new files.
- [ ] shell.spec passes on Chromium with axe (or the browser error is in the report).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0047-report.md` (600 tokens at most) and set `Status: review`. The report has the files changed, each command with the last 5 lines of output, §7 ticked, deviations, questions, owner steps left.

## Risk list (for the reviewer)

`apps/web/app/(app)/inbox/page.tsx` (org scope), copy in `cs.json`.

## Owner steps

None.
