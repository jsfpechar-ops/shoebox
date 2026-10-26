# 0405: Trash and restore

Status: todo
Ticket: lane D, M11 §5.1 (Koš) | Depends on: 0401, 0404 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A user can move a wrong upload to the Trash from the document page and bring it back from the Inbox "Trash" tab. Finalized documents (kept 10 years by law) cannot be trashed. Each move is audited.

## 2. Context

- `documents.deleted_at` (null = live). All existing loaders already skip deleted rows. `documents.finalized_at` not null = finalized.
- Audit function from 0401: `supabase.rpc('audit_document', { p_document, p_action: 'trash' | 'restore', p_diff: {} })`.
- Server action pattern: `apps/web/src/documents/correction-actions.ts` (`'use server'`, `requireActiveRole(['owner','member'])`, `createSupabaseServerClient()`, `revalidatePath`). Use `redirect` from `next/navigation` after success.
- Inbox page after 0404: `tab` is `'review' | 'all' | 'trash'`; the tab nav has two links. `inboxHref('trash')` exists in `inbox-tabs.ts`.
- Copy (English, `en.json`). No raw colours; `Button` from `@shoebox/ui` (variants in `packages/ui/src/primitives/basic.tsx` `buttonVariants`; use the secondary/outline one, read the key names there).

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/documents/trash.ts` | new (pure) |
| `apps/web/test/trash.test.ts` | new (below) |
| `apps/web/src/documents/trash-actions.ts` | new (server actions) |
| `apps/web/src/documents/trash-data.ts` | new (loader) |
| `apps/web/app/(app)/inbox/page.tsx` | edit: third tab + trash list |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | edit: trash button |
| `packages/i18n/messages/en.json` | edit: keys |

## 4. Steps

1. `en.json` keys (after `"register.table.label"`):
   ```
     "trash.move": "Move to trash",
     "trash.restore": "Restore",
     "trash.title": "Trash",
     "trash.note": "Documents you moved here are kept for 30 days, then deleted for good. Nothing here counts in your totals.",
     "trash.empty": "The trash is empty.",
     "trash.deleted_on": "Moved here on {date}",
     "trash.error.finalized": "We must keep this document for 10 years by law, so it cannot be deleted.",
     "trash.error.save": "That did not work. Please try again.",
   ```
2. New `apps/web/src/documents/trash.ts`:
   ```ts
   import type { MessageKey } from '@shoebox/i18n';
   export type TrashMove = 'trash' | 'restore';
   export type TrashCheck = { ok: true } | { ok: false; error: MessageKey };
   /** Can this document make the move? Finalized documents never go to the trash. */
   export function checkTrashMove(doc: { finalizedAt: string | null; deletedAt: string | null }, move: TrashMove): TrashCheck;
   /** Days left before the purge (30 days after deletedAt), never below 0. */
   export function trashDaysLeft(deletedAt: string, nowMs: number): number;
   ```
   Rules: trash needs `deletedAt === null` and `finalizedAt === null` (finalized → `trash.error.finalized`, already deleted → `trash.error.save`); restore needs `deletedAt !== null` (else `trash.error.save`). Test `apps/web/test/trash.test.ts` (do not edit):
   ```ts
   import { describe, expect, it } from 'vitest';
   import { checkTrashMove, trashDaysLeft } from '../src/documents/trash';

   describe('checkTrashMove', () => {
     it('a live, not finalized document can go to the trash', () => {
       expect(checkTrashMove({ finalizedAt: null, deletedAt: null }, 'trash')).toEqual({ ok: true });
     });
     it('a finalized document never goes to the trash', () => {
       expect(checkTrashMove({ finalizedAt: '2026-10-01T00:00:00Z', deletedAt: null }, 'trash')).toEqual({
         ok: false,
         error: 'trash.error.finalized',
       });
     });
     it('only a trashed document can be restored, and not trashed twice', () => {
       expect(checkTrashMove({ finalizedAt: null, deletedAt: '2026-10-20T00:00:00Z' }, 'restore')).toEqual({ ok: true });
       expect(checkTrashMove({ finalizedAt: null, deletedAt: null }, 'restore').ok).toBe(false);
       expect(checkTrashMove({ finalizedAt: null, deletedAt: '2026-10-20T00:00:00Z' }, 'trash').ok).toBe(false);
     });
   });

   describe('trashDaysLeft', () => {
     it('counts down from 30 days and stops at 0', () => {
       const deleted = '2026-10-01T00:00:00Z';
       expect(trashDaysLeft(deleted, Date.parse('2026-10-01T00:00:00Z'))).toBe(30);
       expect(trashDaysLeft(deleted, Date.parse('2026-10-21T12:00:00Z'))).toBe(10);
       expect(trashDaysLeft(deleted, Date.parse('2026-12-01T00:00:00Z'))).toBe(0);
     });
   });
   ```
   (`trashDaysLeft` = `max(0, ceil((deleted + 30 d − now) / 1 d))` ... check: 2026-10-21T12:00 gives 9.5 → ceil 10.) `pnpm --filter @shoebox/web test -- trash 2>&1 | tail -20`.
3. New `apps/web/src/documents/trash-data.ts`: `export interface TrashRow { id; title: string | null; deletedAt: string }` and `export async function loadTrash(supabase, orgId): Promise<TrashRow[]>`: select `id, deleted_at, partner_snapshot, source_files(original_filename)` from `documents`, `.eq('org_id', orgId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200)`; title = partner name ?? file name ?? null (same as `inboxRowOf`); errors → `[]`.
4. New `apps/web/src/documents/trash-actions.ts` (`'use server'`): `export async function moveToTrashAction(form: FormData): Promise<void>` and `export async function restoreAction(form: FormData): Promise<void>`. Each: `requireActiveRole(['owner','member'])` (not ok → return); id from `form.get('id')` (string, else return); select `id, finalized_at, deleted_at` from documents by id + org; `checkTrashMove`; not ok → return; update `deleted_at` to `new Date().toISOString()` (trash) or `null` (restore) `.eq('id', id).eq('org_id', auth.orgId)`; on error return; then `rpc('audit_document', { p_document: id, p_action: move, p_diff: {} })`; `revalidatePath('/inbox')`; then `redirect(move === 'trash' ? '/inbox?tab=trash' : \`/inbox/${id}\`)`. Never log the document.
5. Inbox `page.tsx`: add the third tab link (`inboxHref('trash')`, label `inbox.tabs.trash`). For `tab === 'trash'`: load `loadTrash` (when `auth.ok`), show `<p className="text-body">` `trash.note`, then a `Card` with `trash.empty` or a `<ul>` like the review list where each `<li>` shows the title (or `inbox.row.unknown_supplier`), `t('trash.deleted_on', { date: formatLegalDate(deletedAt.slice(0, 10) as LegalDate) })`, and, for owner/member only, `<form action={restoreAction}><input type="hidden" name="id" value={row.id} /><Button type="submit" variant=…>{t('trash.restore')}</Button></form>`. The trash tab must no longer fall through to the review list.
6. Document `page.tsx`: after the checks card section (inside the not-processing branch, at its end), when `auth.ok && (auth.role === 'owner' || auth.role === 'member')`, render `<form action={moveToTrashAction}>` with hidden `id` and a secondary `Button` `trash.move`.
7. `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` (0), `pnpm --filter @shoebox/web test -- trash 2>&1 | tail -10`, `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`, `pnpm exec biome check apps/web packages/i18n 2>&1 | tail -15` (fix your files with `--write`).

## 5. Do not touch

Other files; no migration (columns exist). Hard rules 3, 4, 6.

## 6. Commands

As in the steps.

## 7. Acceptance

- [ ] trash tests pass; typecheck 0; biome clean.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0405-report.md`, 150 tokens at most. Set `Status: review`.
