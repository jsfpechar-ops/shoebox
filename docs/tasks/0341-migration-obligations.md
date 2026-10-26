# 0341: Migration 0044 `obligations` + column-limited user update + factory

Status: todo
Ticket: P3-VAT-02/09 (schema) | Depends on: 0340 (journal order) | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 45k tokens

## 1. Objective

Create `obligations` (05 §8) so `vat_return`/`kh`/`sh`/`vat_payment` drafts (0330) can be upserted and "mark filed" can set one `done`. Users may update only `state`, `done_at`, `done_source`; the worker (M09 generator, M05 lifecycle) writes everything else.

## 2. Context

05 §8 DDL (verbatim):
```sql
create table obligations (                                           -- deadlines & payables to authorities; single writer: M09 generator
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null,                                               -- canonical list 04 §9.2
  period_start date, period_end date,
  legal_due_date date,                                              -- before weekend/holiday shift
  due_date date not null,
  amount_estimate numeric(15,2),
  is_optional boolean not null default false,
  state text not null default 'open' check (state in ('open','done','not_applicable','overdue')),
  done_at timestamptz,
  done_source text check (done_source in ('user','filing','evidence_document','bank_payment','profile_change')),
  evidence_document_id uuid references documents(id) on delete set null,
  source_rule text not null, generator_version integer not null default 1,
  filing_id uuid references filings(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint obligations_uniq unique nulls not distinct (org_id, kind, period_start)
);
create index obligations_open_due on obligations (org_id, due_date) where state in ('open','overdue');
```
05 §10.2: "`obligations` | users may update only `state`, `done_at`, `done_source` (mark done / undo, owner and member)". Implement as: `select app.apply_tenant_rls_read_only('obligations');` (select for members, worker ALL) **plus** an update policy for owners/members and a before-update trigger that raises `insufficient_privilege` when any other column changes for a user with a role (pattern: `app.review_questions_accountant_columns` in `packages/db/migrations/0006_documents_detail.sql` lines 117–131; here test `auth.uid() is not null` instead of the accountant role, so the worker passes). Policy text (check `app.apply_tenant_rls` in `0003_app_worker.sql` for the exact `using`/`with check` idiom and copy it):
```sql
create policy obligations_user_update on obligations for update to authenticated
  using (app.user_has_role(org_id, '{owner,member}'::member_role[]))
  with check (app.user_has_role(org_id, '{owner,member}'::member_role[]));
```
`READ_ONLY_FOR_USERS` in `packages/db/src/rls-catalog.ts` must **not** list `obligations` (it has a user update policy); the RLS meta-test then expects a standard tenant table: if it fails because `obligations` lacks an insert/delete policy for users, add `'obligations'` to a new exported list `USER_UPDATE_ONLY: readonly string[]` in `rls-catalog.ts` and teach `packages/db/test/rls/meta.db.test.ts` to accept select+update for those tables (smallest possible edit, report it). Journal: append after 0043 (`tag: "0044_obligations"`). Factory pattern: 0340.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0044_obligations.sql` | create | DDL + trigger + RLS |
| `packages/db/migrations/meta/_journal.json` | edit | append |
| `packages/testkit/src/factories/filings.ts` | edit | add `obligationFactory` `{ id, org_id, kind: 'vat_return', period_start: '2026-08-01', period_end: '2026-08-31', legal_due_date: '2026-09-25', due_date: '2026-09-25', state: 'open', source_rule: 'm05.vat_obligations.v1' }` and register it in `filingFactories` |
| `packages/db/test/migrations/obligations.db.test.ts` | create | below |
| (conditional) `packages/db/src/rls-catalog.ts`, `packages/db/test/rls/meta.db.test.ts` | edit | only as described in §2 |

## 4. Steps

1. Migration + journal; 2. factory; 3. test (setup as 0340, `ORG = 'dddddddd-0000-4000-8000-000000000044'`, slug `org-obligations-0044`, user `OWNER` with role owner and `MEMBER` with role member):
```ts
describe.skipIf(DATABASE_URL === undefined)('0044: obligations', () => {
  // … setup …
  it('worker upserts on (org_id, kind, period_start); users cannot insert', async () => {
    await sql`insert into obligations (org_id, kind, period_start, period_end, legal_due_date, due_date, amount_estimate, source_rule) values (${ORG}, 'vat_return', '2026-08-01', '2026-08-31', '2026-09-25', '2026-09-25', '2877.00', 'm05.vat_obligations.v1')`;
    await sql`insert into obligations (org_id, kind, period_start, period_end, legal_due_date, due_date, amount_estimate, source_rule) values (${ORG}, 'vat_return', '2026-08-01', '2026-08-31', '2026-09-25', '2026-09-25', '2900.00', 'm05.vat_obligations.v1')
      on conflict (org_id, kind, period_start) do update set amount_estimate = excluded.amount_estimate, updated_at = now()`;
    expect(one(await sql<{ a: string }[]>`select amount_estimate as a from obligations where org_id = ${ORG}`).a).toBe('2900.00');
    expect(await asUser(OWNER, (tx) => code(tx`insert into obligations (org_id, kind, due_date, source_rule) values (${ORG}, 'kh', '2026-09-25', 'x')`))).toBe('42501');
  });
  it('member marks done (state, done_at, done_source) but cannot touch due_date or amount', async () => {
    const id = one(await sql<{ id: string }[]>`select id from obligations where org_id = ${ORG} and kind = 'vat_return'`).id;
    await asUser(MEMBER, (tx) => tx`update obligations set state = 'done', done_at = now(), done_source = 'user' where id = ${id}`);
    expect(one(await sql<{ s: string }[]>`select state as s from obligations where id = ${id}`).s).toBe('done');
    expect(await asUser(MEMBER, (tx) => code(tx`update obligations set due_date = '2026-12-31' where id = ${id}`))).toBe('42501');
    expect(await asUser(MEMBER, (tx) => code(tx`update obligations set amount_estimate = '1.00' where id = ${id}`))).toBe('42501');
    await sql`update obligations set state = 'open', done_at = null, done_source = null where id = ${id}`;   // worker may
  });
  it('bad state or done_source rejected; other org sees nothing', async () => {
    expect(await code(sql`insert into obligations (org_id, kind, due_date, source_rule, state) values (${ORG}, 'sh', '2026-09-25', 'x', 'late')`)).toBe('23514');
    const OTHER = 'dddddddd-0000-4000-8000-0000000000c4';
    await sql`insert into auth.users (id) values (${OTHER}) on conflict (id) do nothing`;
    expect(await asUser(OTHER, async (tx) => one(await tx<{ n: number }[]>`select count(*)::int as n from obligations`).n)).toBe(0);
    await sql`delete from auth.users where id = ${OTHER}`;
  });
});
```
Command: `pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30`.
4. Commit `feat(db): migration 0044 obligations (0341)`.

## 5. Do not touch

Other migrations; `filings` DDL.

## 6. Commands

`pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30` · `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` · `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Tests green or skipped-without-DB (reported); RLS meta-test accepts `obligations`.

## 8. Stop and ask

TEMPLATE §8; the meta-test needing more than the §2 edit.

## 9. Report

`docs/tasks/0341-report.md`.

## Risk list

Migration (RLS + trigger).

## Owner steps

None. (M09's `obligations.generate` job that calls `vatObligationsFor` is P1-DASH-02, another lane; lane C's 0344 writes the VAT rows directly until it exists: see that brief.)
