# 0323: P1-CAT-05b `DELETE /api/vendor-profiles/{id}/memory?reprocess=` ("Forget what you learned")

Status: todo
Ticket: P1-CAT-05 | Depends on: 0321 (enqueue helper), 0322 (merged) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 40k tokens

## 1. Objective

The owner can reset a vendor's learned category memory (M04 §4.7 "Zapomenout naučené"): defaults, confirmations and pin go back to zero; with `reprocess=true` the partner's open documents are re-queued for `doc.categorize`. Documents are never reclassified retroactively otherwise. Also `GET /api/vendor-profiles?partner_id=` (read, any role) so lane D can show the learned state.

## 2. Context

- Pattern: 0321's routes (`origin` check, `requireActiveRole`, supabase under the user's session, `enqueueDocCategorize`). Roles: DELETE `['owner', 'member']`; GET `['owner', 'member', 'accountant', 'viewer']`.
- Reset = `update vendor_profiles set default_category_code = null, default_vat_treatment = null, default_business_flag = null, confirmations = 0, pinned = false, multi_category = false, last_confirmed_at = null, extraction_hints = extraction_hints - 'subject_cs' where id = ? and org_id = ?`. PostgREST cannot express `jsonb - key`; read the row first, write `extraction_hints` without `subject_cs` (other keys kept: lane B owns them).
- Reprocess: documents of that `partner_id` with `status in ('needs_review','ready')`, `deleted_at is null` → `enqueueDocCategorize(orgId, id, revision, 'user_reprocess', nonce)`; cap 200 (log the rest as a count; TODO(cat-05-bulk) for `ledger.rebuild_org`-style batching). Response `200 {reset: true, reprocessed: n}`. Unknown id or other org → 404.
- GET response: `{profiles: [{id, partner_id, default_category_code, default_vat_treatment, default_business_flag, confirmations, pinned, multi_category, last_confirmed_at}]}` (never `extraction_hints`: it may carry lane B's hints).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/vendor-memory.ts` | create | `resetVendorMemory`, `listVendorProfiles`, `parseReprocess` |
| `apps/web/app/api/vendor-profiles/route.ts` | create | GET |
| `apps/web/app/api/vendor-profiles/[id]/memory/route.ts` | create | DELETE |
| `apps/web/test/vendor-memory-route.test.ts` | create | the test below, verbatim |

## 4. Steps

1. Create `apps/web/src/documents/vendor-memory.ts` exporting exactly:
```ts
import type { createSupabaseServerClient } from '../supabase/server';
type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;
export function parseReprocess(value: string | null): boolean;   // 'true' → true, anything else → false
export type ResetResult = { ok: true; partnerId: string; openDocuments: { id: string; revision: number }[] } | { ok: false; status: 404; error: 'not_found' };
/** Resets the category memory of one profile (org-scoped) and lists the partner's open documents (needs_review|ready, not deleted, ≤ 200). */
export async function resetVendorMemory(supabase: SupabaseLike, input: { orgId: string; profileId: string }): Promise<ResetResult>;
export interface VendorProfileDto { id: string; partner_id: string; default_category_code: string | null; default_vat_treatment: string | null; default_business_flag: string | null; confirmations: number; pinned: boolean; multi_category: boolean; last_confirmed_at: string | null; }
export async function listVendorProfiles(supabase: SupabaseLike, input: { orgId: string; partnerId: string | null }): Promise<VendorProfileDto[]>;
```
2. Create `apps/web/app/api/vendor-profiles/route.ts` (GET; `partner_id` from `new URL(request.url).searchParams`; 200 `{profiles}`).
3. Create `apps/web/app/api/vendor-profiles/[id]/memory/route.ts` (DELETE; origin check; roles owner/member; `reprocess = parseReprocess(searchParams.get('reprocess'))`; on `ok`, when reprocess: `for (const d of openDocuments) await enqueueDocCategorize(auth.orgId, d.id, d.revision, 'user_reprocess')`; respond `{reset: true, reprocessed: reprocess ? openDocuments.length : 0}`).
   Command after 2 and 3: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.
4. Create `apps/web/test/vendor-memory-route.test.ts` verbatim; implement until it passes, do not edit it:
```ts
import { describe, expect, it } from 'vitest';
import { parseReprocess, resetVendorMemory } from '../src/documents/vendor-memory';

type Row = Record<string, unknown>;
function fakeSupabase(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; values: Row; filters: Row }> = [];
  function from(table: string) {
    const filters: Row = {};
    const inFilters: Array<[string, unknown[]]> = [];
    const rows = () => (tables[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v) && inFilters.every(([k, vs]) => vs.includes(r[k])));
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
      is: (k: string, v: unknown) => { filters[k] = v; return chain; },
      in: (k: string, vs: unknown[]) => { inFilters.push([k, vs]); return chain; },
      limit: () => chain,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null }),
      update: (values: Row) => { writes.push({ table, values, filters }); for (const r of rows()) Object.assign(r, values); return chain; },
    };
    return chain;
  }
  return { client: { from } as never, writes, tables };
}
const ORG = '11111111-1111-4111-8111-111111111111';
const PROFILE = '66666666-6666-4666-8666-666666666666';
const PARTNER = '77777777-7777-4777-8777-777777777777';

describe('parseReprocess', () => {
  it('only the literal true', () => {
    expect(parseReprocess('true')).toBe(true);
    expect(parseReprocess('1')).toBe(false);
    expect(parseReprocess(null)).toBe(false);
  });
});

describe('resetVendorMemory', () => {
  const profile = () => ({ id: PROFILE, org_id: ORG, partner_id: PARTNER, default_category_code: 'exp_cleaning', default_vat_treatment: 'rcv_domestic_no_vat', default_business_flag: 'business', confirmations: 3, pinned: true, multi_category: true, last_confirmed_at: '2026-10-01T00:00:00Z', extraction_hints: { subject_cs: 'Cleaning', layout: 'v2' } });
  const docs = () => [
    { id: 'd1', org_id: ORG, partner_id: PARTNER, status: 'needs_review', revision: 1, deleted_at: null },
    { id: 'd2', org_id: ORG, partner_id: PARTNER, status: 'finalized', revision: 2, deleted_at: null },
    { id: 'd3', org_id: ORG, partner_id: PARTNER, status: 'ready', revision: 1, deleted_at: '2026-01-01T00:00:00Z' },
    { id: 'd4', org_id: ORG, partner_id: 'other', status: 'ready', revision: 1, deleted_at: null },
  ];
  it('clears only the category fields, keeps other hints, lists open documents of the partner', async () => {
    const fake = fakeSupabase({ vendor_profiles: [profile()], documents: docs() });
    const r = await resetVendorMemory(fake.client, { orgId: ORG, profileId: PROFILE });
    expect(r).toEqual({ ok: true, partnerId: PARTNER, openDocuments: [{ id: 'd1', revision: 1 }] });
    const w = fake.writes.find((x) => x.table === 'vendor_profiles');
    expect(w?.values).toEqual({ default_category_code: null, default_vat_treatment: null, default_business_flag: null, confirmations: 0, pinned: false, multi_category: false, last_confirmed_at: null, extraction_hints: { layout: 'v2' } });
    expect(w?.filters).toMatchObject({ id: PROFILE, org_id: ORG });
  });
  it('404 for another org', async () => {
    const fake = fakeSupabase({ vendor_profiles: [{ ...profile(), org_id: 'other' }], documents: [] });
    expect(await resetVendorMemory(fake.client, { orgId: ORG, profileId: PROFILE })).toEqual({ ok: false, status: 404, error: 'not_found' });
    expect(fake.writes).toEqual([]);
  });
});
```
   Command: `pnpm --filter @shoebox/web test -- vendor-memory-route 2>&1 | tail -30` → all pass.

## 5. Do not touch

Screens (lane D), `extraction_hints` keys other than `subject_cs`, `packages/*`. Hard rules 3, 8.

## 6. Commands

`pnpm --filter @shoebox/web test -- vendor-memory-route 2>&1 | tail -30`; `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`.

## 7. Acceptance

- [ ] Tests pass; typecheck clean. - [ ] GET never returns `extraction_hints`.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0323-report.md`.

## Risk list

`vendor-memory.ts` (hints merge, org scoping).

## Owner steps

None.
