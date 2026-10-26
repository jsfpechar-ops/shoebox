# 0101: Document page explains a duplicate and offers "two different invoices"

Status: done
Ticket: P1-ING-08 (UI part) | Depends on: 0100 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Since 0100 a second copy of an invoice becomes `duplicate`. Its document page must say which document it repeats (with a link) and offer one button for the rare case where they really are two invoices; pressing it puts the document back in the normal flow.

## 2. Context

- 0100: the duplicate has a `document_links` row `(from_document_id = duplicate, to_document_id = original, kind = 'duplicate_of')`. "Keep both" = set `documents.semantic_dedupe_exempt = true`, delete that link, and set status `needs_review` when the document has an open blocking check (`validation_results` with `state = 'open'` and `severity = 'blocking'`), else `ready`.
- Fewest buttons: one button, plain words, no confirm dialog. English copy only (`en.json`; do not touch `cs.json`).
- Excerpt in `apps/web/app/(app)/inbox/[id]/page.tsx` (find verbatim):

```tsx
      {processing ? (
        <>
          <p className="text-body">{t('doc.detail.reading')}</p>
```

- Excerpt in `packages/i18n/messages/en.json` (find verbatim):

```json
  "doc.detail.not_found": "We can't find this document.",
```

## 3. Files

| Path | Action | What |
|---|---|---|
| apps/web/src/documents/duplicate.ts | new | store interface, `keepBoth`, Supabase store |
| apps/web/test/duplicate.test.ts | new | the test below |
| apps/web/src/documents/duplicate-actions.ts | new | server action |
| apps/web/src/documents/duplicate-notice.tsx | new | the notice card |
| apps/web/app/(app)/inbox/[id]/page.tsx | edit | render the notice for a duplicate |
| packages/i18n/messages/en.json | edit | 4 keys |

No other file may change.

## 4. Steps

1. Edit `en.json`: after the `doc.detail.not_found` line add:

```json
  "doc.duplicate.notice": "This is the same invoice as one you already have, so we don't count it twice.",
  "doc.duplicate.open_original": "Open the one we kept",
  "doc.duplicate.keep_both": "These are two different invoices",
  "doc.duplicate.error": "That didn't work. Please try again.",
```

   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → passes.

2. Create `apps/web/src/documents/duplicate.ts` exactly:

```ts
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Data access for a duplicate document; every call is scoped to one org. */
export interface DuplicateStore {
  /** Id of the document this one repeats, or null. */
  originalOf(documentId: string): Promise<string | null>;
  statusOf(documentId: string): Promise<string | null>;
  openBlockingCount(documentId: string): Promise<number>;
  /** Sets semantic_dedupe_exempt, the new status, and deletes the duplicate_of link. */
  keep(documentId: string, status: 'ready' | 'needs_review'): Promise<void>;
}

export type KeepBothResult = { ok: true; status: 'ready' | 'needs_review' } | { ok: false };

/** "These are two different invoices": a duplicate goes back to the normal flow. */
export async function keepBoth(store: DuplicateStore, documentId: string): Promise<KeepBothResult> {
  try {
    if ((await store.statusOf(documentId)) !== 'duplicate') return { ok: false };
    const status = (await store.openBlockingCount(documentId)) > 0 ? 'needs_review' : 'ready';
    await store.keep(documentId, status);
    return { ok: true, status };
  } catch {
    return { ok: false };
  }
}

export function supabaseDuplicateStore(supabase: SupabaseLike, orgId: string): DuplicateStore {
  return {
    async originalOf(documentId) {
      const { data, error } = await supabase
        .from('document_links')
        .select('to_document_id')
        .eq('org_id', orgId)
        .eq('from_document_id', documentId)
        .eq('kind', 'duplicate_of')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error('duplicate link read failed');
      return typeof data?.to_document_id === 'string' ? data.to_document_id : null;
    },
    async statusOf(documentId) {
      const { data, error } = await supabase
        .from('documents')
        .select('status')
        .eq('org_id', orgId)
        .eq('id', documentId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new Error('document read failed');
      return typeof data?.status === 'string' ? data.status : null;
    },
    async openBlockingCount(documentId) {
      const { count, error } = await supabase
        .from('validation_results')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('document_id', documentId)
        .eq('state', 'open')
        .eq('severity', 'blocking');
      if (error) throw new Error('checks read failed');
      return count ?? 0;
    },
    async keep(documentId, status) {
      const { error: linkError } = await supabase
        .from('document_links')
        .delete()
        .eq('org_id', orgId)
        .eq('from_document_id', documentId)
        .eq('kind', 'duplicate_of');
      if (linkError) throw new Error('link delete failed');
      const { error } = await supabase
        .from('documents')
        .update({ semantic_dedupe_exempt: true, status })
        .eq('org_id', orgId)
        .eq('id', documentId);
      if (error) throw new Error('document update failed');
    },
  };
}
```

   If `validation_results` has no `id` column (check `grep -n -A4 'create table validation_results' packages/db/migrations/0006_documents_detail.sql`), select its first column instead. If the Supabase typings reject a call, cast that one builder, change nothing else.

3. Create `apps/web/test/duplicate.test.ts` exactly; implement until it passes, do not edit it:

```ts
import { describe, expect, it } from 'vitest';
import { type DuplicateStore, keepBoth } from '../src/documents/duplicate';

function fakeStore(status: string | null, blocking: number, failKeep = false) {
  const kept: Array<{ id: string; status: string }> = [];
  const store: DuplicateStore = {
    originalOf: async () => 'orig',
    statusOf: async () => status,
    openBlockingCount: async () => blocking,
    keep: async (id, s) => {
      if (failKeep) throw new Error('boom');
      kept.push({ id, status: s });
    },
  };
  return { store, kept };
}

describe('keepBoth', () => {
  it('a duplicate without blocking checks becomes ready', async () => {
    const { store, kept } = fakeStore('duplicate', 0);
    expect(await keepBoth(store, 'd1')).toEqual({ ok: true, status: 'ready' });
    expect(kept).toEqual([{ id: 'd1', status: 'ready' }]);
  });
  it('a duplicate with a blocking check goes to review', async () => {
    const { store } = fakeStore('duplicate', 2);
    expect(await keepBoth(store, 'd1')).toEqual({ ok: true, status: 'needs_review' });
  });
  it('anything that is not a duplicate is left alone', async () => {
    const { store, kept } = fakeStore('ready', 0);
    expect(await keepBoth(store, 'd1')).toEqual({ ok: false });
    expect(kept).toEqual([]);
  });
  it('a failed write is reported, not thrown', async () => {
    const { store } = fakeStore('duplicate', 0, true);
    expect(await keepBoth(store, 'd1')).toEqual({ ok: false });
  });
});
```

   Run `pnpm --filter @shoebox/web test -- duplicate 2>&1 | tail -30` → 4 passed.

4. Create `apps/web/src/documents/duplicate-actions.ts` exactly:

```ts
'use server';

import type { MessageKey } from '@shoebox/i18n';
import { revalidatePath } from 'next/cache';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { keepBoth, supabaseDuplicateStore } from './duplicate';

export type KeepBothState = { error: MessageKey | null };

export async function keepBothAction(_prev: KeepBothState, form: FormData): Promise<KeepBothState> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return { error: 'doc.duplicate.error' };
  const id = form.get('id');
  if (typeof id !== 'string' || id === '') return { error: 'doc.duplicate.error' };
  const store = supabaseDuplicateStore(await createSupabaseServerClient(), auth.orgId);
  const result = await keepBoth(store, id);
  if (!result.ok) return { error: 'doc.duplicate.error' };
  revalidatePath(`/inbox/${id}`);
  revalidatePath('/inbox');
  return { error: null };
}
```

   Typecheck: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors.

5. Create `apps/web/src/documents/duplicate-notice.tsx` exactly:

```tsx
'use client';

import { t } from '@shoebox/i18n';
import { Button, Card } from '@shoebox/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import { type KeepBothState, keepBothAction } from './duplicate-actions';

const idle: KeepBothState = { error: null };

/** Shown on a duplicate's page: what it repeats, and one button for "two different invoices". */
export function DuplicateNotice({
  documentId,
  originalId,
  canAct,
}: {
  documentId: string;
  originalId: string | null;
  canAct: boolean;
}) {
  const [state, action, pending] = useActionState(keepBothAction, idle);
  return (
    <Card className="flex flex-col gap-3 p-6">
      <p className="text-body">{t('doc.duplicate.notice')}</p>
      {originalId ? (
        <Link href={`/inbox/${originalId}`} className="text-body underline">
          {t('doc.duplicate.open_original')}
        </Link>
      ) : null}
      {canAct ? (
        <form action={action}>
          <input type="hidden" name="id" value={documentId} />
          <Button type="submit" variant="secondary" disabled={pending}>
            {t('doc.duplicate.keep_both')}
          </Button>
        </form>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-body text-destructive">
          {t(state.error)}
        </p>
      ) : null}
    </Card>
  );
}
```

   If `text-destructive` is not a token class (check `grep -n 'destructive' apps/web/app/globals.css | head -3`), use the class `fix-field.tsx` uses for its error. Typecheck → no errors.

6. Edit `apps/web/app/(app)/inbox/[id]/page.tsx`:
   - after the `import { loadDocumentDetail } ...` line add `import { supabaseDuplicateStore } from '../../../../src/documents/duplicate';` and `import { DuplicateNotice } from '../../../../src/documents/duplicate-notice';`
   - after the line `const fileUrl = signed && !signed.error ? (signed.data?.signedUrl ?? null) : null;` add:

```tsx
  const originalId =
    auth.ok && detail.status === 'duplicate'
      ? await supabaseDuplicateStore(supabase, auth.orgId)
          .originalOf(detail.id)
          .catch(() => null)
      : null;
```

   - replace the §2 page excerpt with:

```tsx
      {detail.status === 'duplicate' ? (
        <DuplicateNotice
          documentId={detail.id}
          originalId={originalId}
          canAct={auth.ok && (auth.role === 'owner' || auth.role === 'member')}
        />
      ) : null}

      {processing ? (
        <>
          <p className="text-body">{t('doc.detail.reading')}</p>
```

   Typecheck → no errors.

## 5. Do not touch

`cs.json`, `packages/db`, other screens. Hard rules 3 (every query filters `org_id`), 6 (copy through i18n, tokens only).

## 6. Commands

- `pnpm --filter @shoebox/web test -- duplicate detail-data 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors.
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → passes.
- `pnpm exec biome check apps/web packages/i18n 2>&1 | tail -30` → clean (`pnpm exec biome format --write <file>` for formatting only).

## 7. Acceptance

- [ ] Tests above pass; CI green.
- [ ] `git diff --stat origin/phase/0` lists only §3 files plus this brief and its report.

## 8. Stop and ask

Stop and write the report as `blocked` if an excerpt is not found, a test fails twice, a file outside §3 needs a change, or you reach 25 tool calls.

## 9. Report

`docs/tasks/0101-report.md`, 300 tokens at most: files changed, last 5 lines of each command. Set `Status: review`.
