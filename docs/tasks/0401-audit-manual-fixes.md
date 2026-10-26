# 0401: Audit log row for every manual fix

Status: todo
Ticket: P1-TRUST-01 (part 2), lane D | Depends on: 0400 | Base commit: 496b1e9 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Every value a user fixes on the document page writes one `audit_log` row (field, old value, new value, who, when). Later briefs (trash, restore, manual entry) reuse the same database function.

## 2. Context

- `audit_log` (0007): users may only select their org's rows; inserts only through server code. So the app calls a `security definer` function, like `public.create_firm` in 0015.
- RLS helper (0002): `app.user_has_role(p_org uuid, p_roles member_role[]) returns boolean`.
- Lane D migrations are numbered 0050–0059. Journal file `packages/db/migrations/meta/_journal.json`; last entry is idx 8, tag `0015_onboarding`.
- `apps/web/src/documents/correction-store.ts`, in `applyCorrection`: `fields` holds the current values by field key; the anchor for the new write is the line `    // 7. The last write sets the planned status.`

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0050_audit_document.sql` | new | function |
| `packages/db/migrations/meta/_journal.json` | edit | one entry |
| `packages/db/test/migrations/audit-document.db.test.ts` | new | test below |
| `apps/web/src/documents/correction-store.ts` | edit | call the function |

## 4. Steps

1. New `packages/db/migrations/0050_audit_document.sql`:
   ```sql
   -- 0050_audit_document: one audited entry point for user changes to a document (M11 §13.1).
   -- audit_log is select-only for users (0007), so inserts go through this security definer function.
   -- Owner or member of the document's org only. Forward-only.
   create or replace function public.audit_document(p_document uuid, p_action text, p_diff jsonb)
     returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
   declare
     v_org uuid;
   begin
     if p_action not in ('edit_field', 'trash', 'restore', 'create_manual', 'answer_question') then
       raise exception 'bad_action' using errcode = '22023';
     end if;
     select org_id into v_org from documents where id = p_document;
     if v_org is null or not app.user_has_role(v_org, array['owner', 'member']::member_role[]) then
       raise exception 'not_allowed' using errcode = '42501';
     end if;
     insert into audit_log (org_id, actor_user_id, actor_kind, entity, entity_id, action, diff)
     values (v_org, auth.uid(), 'user', 'documents', p_document, p_action, p_diff);
   end
   $$;
   revoke execute on function public.audit_document(uuid, text, jsonb) from public, anon;
   grant execute on function public.audit_document(uuid, text, jsonb) to authenticated;
   ```
2. `_journal.json`: after the `0015_onboarding` entry add (comma on the previous `}`):
   `{ "idx": 9, "version": "7", "when": 1792974294370, "tag": "0050_audit_document", "breakpoints": true }`
   (format it like the other multi-line entries). Run `pnpm --filter @shoebox/db exec drizzle-kit check 2>&1 | tail -10`.
3. New `packages/db/test/migrations/audit-document.db.test.ts` (do not edit after writing):
   ```ts
   import postgres, { type Sql, type TransactionSql } from 'postgres';
   import { afterAll, beforeAll, describe, expect, it } from 'vitest';
   import { runMigrations } from '../../src/migrate';

   // 0050_audit_document: public.audit_document(). Skipped without DATABASE_URL.
   const DATABASE_URL = process.env.DATABASE_URL;
   const OWNER = '0f0f0f0f-0000-4000-8000-000000000501';
   const OUTSIDER = '0f0f0f0f-0000-4000-8000-000000000502';
   const VIEWER = '0f0f0f0f-0000-4000-8000-000000000503';
   const ROLLBACK = Symbol('rollback');

   describe.skipIf(DATABASE_URL === undefined)('0050 audit_document()', () => {
     const url = DATABASE_URL ?? '';
     let sql: Sql;
     let orgId = '';
     let docId = '';

     async function as<T>(uid: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
       let result: T | undefined;
       try {
         await sql.begin(async (tx) => {
           await tx`select set_config('request.jwt.claim.sub', ${uid}, true)`;
           await tx`set local role authenticated`;
           result = await fn(tx);
           throw ROLLBACK;
         });
       } catch (e) {
         if (e !== ROLLBACK) throw e;
       }
       return result as T;
     }

     async function codeAs(uid: string, fn: (tx: TransactionSql) => Promise<unknown>) {
       try {
         await as(uid, fn);
         return null;
       } catch (e) {
         return (e as { code?: string }).code ?? 'unknown';
       }
     }

     beforeAll(async () => {
       await runMigrations(url);
       sql = postgres(url, { max: 1, onnotice: () => undefined });
       await sql`insert into auth.users (id) values (${OWNER}), (${OUTSIDER}), (${VIEWER})
         on conflict (id) do nothing`;
       const [org] = await sql<{ id: string }[]>`insert into organizations
         (name, inbound_email_slug, inbound_email_secret) values ('Audit test', ${`audit-${Date.now()}`}, 'ABCDEFGH')
         returning id`;
       orgId = org?.id ?? '';
       await sql`insert into memberships (org_id, user_id, role) values
         (${orgId}, ${OWNER}, 'owner'), (${orgId}, ${VIEWER}, 'viewer')`;
       const [doc] = await sql<{ id: string }[]>`insert into documents (org_id, entry_mode)
         values (${orgId}, 'manual') returning id`;
       docId = doc?.id ?? '';
     });

     afterAll(async () => {
       if (orgId) await sql`delete from organizations where id = ${orgId}`;
       await sql?.end();
     });

     it('an owner writes one row with the diff, and can read it back', async () => {
       const rows = await as(OWNER, async (tx) => {
         await tx`select public.audit_document(${docId}, 'edit_field',
           ${tx.json({ field: 'total_gross', old: '100.00', new: '121.00' })})`;
         return tx`select action, actor_user_id, diff from audit_log where entity_id = ${docId}`;
       });
       expect(rows).toHaveLength(1);
       expect(rows[0]?.action).toBe('edit_field');
       expect(rows[0]?.actor_user_id).toBe(OWNER);
       expect(rows[0]?.diff).toEqual({ field: 'total_gross', old: '100.00', new: '121.00' });
     });

     it('refuses a user outside the org and a viewer', async () => {
       const call = (tx: TransactionSql) =>
         tx`select public.audit_document(${docId}, 'edit_field', ${tx.json({})})`;
       expect(await codeAs(OUTSIDER, call)).toBe('42501');
       expect(await codeAs(VIEWER, call)).toBe('42501');
     });

     it('refuses an unknown action', async () => {
       expect(
         await codeAs(OWNER, (tx) => tx`select public.audit_document(${docId}, 'drop', ${tx.json({})})`),
       ).toBe('22023');
     });

     it('a user cannot insert into audit_log directly', async () => {
       expect(
         await codeAs(OWNER, (tx) => tx`insert into audit_log (org_id, actor_kind, entity, action)
           values (${orgId}, 'user', 'documents', 'edit_field')`),
       ).toBe('42501');
     });
   });
   ```
   Run `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- audit-document 2>&1 | tail -30` (a local Postgres is already running there; 4 pass, 0 skipped).
4. `correction-store.ts`: insert directly before the line `    // 7. The last write sets the planned status.`:
   ```ts
       // 6b. One audit row per fixed value (M11 §13.1).
       const w6b = await supabase.rpc('audit_document', {
         p_document: input.documentId,
         p_action: 'edit_field',
         p_diff: { field: input.editKey, old: fields[input.editKey] ?? null, new: input.value },
       });
       if (w6b.error) return { ok: false, error: SAVE_ERROR };

   ```
   Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` (0 errors) and `pnpm --filter @shoebox/web test -- correction 2>&1 | tail -30` (pass).
5. `pnpm exec biome check packages/db apps/web/src/documents 2>&1 | tail -15`; fix formatting of §3 files only with `--write`.

## 5. Do not touch

Other migrations (forward-only). Hard rules 3, 4 (no document content in logs; the diff lives only in the DB).

## 7. Acceptance

- [ ] drizzle-kit check passes; web typecheck 0 errors; correction tests pass.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0401-report.md`, 200 tokens at most. Set `Status: review`.
