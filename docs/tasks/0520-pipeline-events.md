# 0520: pipeline_events, a log of why documents did not go straight to ready

Status: todo
Ticket: owner ask 2026-10-26 (failure logging for analytics) | Depends on: none | Base commit: 886fc60 | Branch: claude/project-thread-5vgi6d | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add one table, `pipeline_events`, that records each step of a document's life as codes: every status change, every read (with the checks that fired), every failed model call and every user action (field fix, trash, restore, manual entry, answered question). It lets us later count why documents fail and which fields the AI gets wrong, without storing any document content.

## 2. Context

- Rules: forward-only migration + 05 edit in the same PR; tenant table with RLS and an RLS case in the same PR; logs carry ids and codes, never document content, names, IBANs or amounts.
- `app.apply_tenant_rls_read_only(table)` (0005) = users of the org select only, `app_worker` reads/writes its org. Tables written only by server code are listed in `READ_ONLY_FOR_USERS` in `packages/db/src/rls-catalog.ts`; the RLS meta-test checks that list.
- `public.audit_document(p_document, p_action, p_diff)` (0050) is the one audited entry point for user changes; actions `edit_field`, `trash`, `restore`, `create_manual`, `answer_question`; `edit_field` diff is `{field, old, new}`.
- The pre-check skip reaches `saveDocumentReading` with `run.method = 'rule'` and one validation `{ ruleId: 'PRECHECK_SKIPPED', params: { reason, ... } }`.
- Migrations run in the order of `packages/db/migrations/meta/_journal.json` (array order). New entries are appended at the end with `"when": Date.now()` (run `node -e 'console.log(Date.now())'`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0063_pipeline_events.sql` | new | table, RLS, status trigger, audit_document v2 |
| `packages/db/migrations/meta/_journal.json` | edit | append entry `0063_pipeline_events` |
| `packages/db/src/schema/pipeline-events.ts` | new | Drizzle mirror |
| `packages/db/src/schema/index.ts` | edit | export it |
| `packages/db/src/rls-catalog.ts` | edit | add to `READ_ONLY_FOR_USERS` |
| `packages/db/src/document-reading.ts` | edit | write `read` and `read_failed` events |
| `packages/db/test/migrations/pipeline-events.db.test.ts` | new | trigger, audit_document, RLS |
| `packages/db/test/document-reading.db.test.ts` | edit | one new case |
| `docs/v3/05-data-model.md` | edit | table + §10.2 list |
| `docs/context/decisions.md` | edit | one line |

No other file may change.

## 4. Steps

1. **New file** `packages/db/migrations/0063_pipeline_events.sql`, exactly:

```sql
-- 0063_pipeline_events (05 §4, brief 0520, owner 2026-10-26): one row per step of a document's life,
-- so we can count why documents did not go straight to ready. Codes, field keys and ids only, never
-- document content (rules: privacy). Reads and failed reads come from the worker; status changes from
-- a trigger; user actions from audit_document(). Users of the org may read (05 §10.2). Forward-only.
create table pipeline_events (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('status','read','read_failed','user_edit','user_trash',
                                     'user_restore','user_manual','user_answer')),
  code text,                -- status: new status; read: outcome status; read_failed: error code; user_edit: filled|changed
  detail text,              -- read: pre-check reason when skipped; read_failed: final|retry
  from_status text,         -- status: the status before (null on insert)
  field_key text,           -- user_edit: the field the user changed
  extraction_run_id uuid references extraction_runs(id) on delete set null,
  method text, model text, prompt_version text, attempt smallint,
  blocking text[] not null default '{}',   -- read: rule ids of blocking checks
  warnings text[] not null default '{}'    -- read: rule ids of warnings
);
create index on pipeline_events (org_id, at);
create index on pipeline_events (document_id, at);
create index on pipeline_events (kind, at);

select app.apply_tenant_rls_read_only('pipeline_events');
grant usage on sequence pipeline_events_id_seq to app_worker;

-- Every new document and every status change, whoever makes it (worker, user, job).
create function app.log_document_status() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into pipeline_events (org_id, document_id, kind, code)
    values (new.org_id, new.id, 'status', new.status::text);
  elsif new.status is distinct from old.status then
    insert into pipeline_events (org_id, document_id, kind, code, from_status)
    values (new.org_id, new.id, 'status', new.status::text, old.status::text);
  end if;
  return null;
end
$$;
revoke execute on function app.log_document_status() from public;
create trigger documents_log_status after insert or update of status on documents
  for each row execute function app.log_document_status();

-- audit_document v2: same checks and audit row as 0050, plus one pipeline_events row (no values).
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
  insert into pipeline_events (org_id, document_id, kind, code, field_key)
  values (
    v_org, p_document,
    case p_action when 'edit_field' then 'user_edit' when 'trash' then 'user_trash'
      when 'restore' then 'user_restore' when 'create_manual' then 'user_manual' else 'user_answer' end,
    case when p_action = 'edit_field' then
      case when coalesce(p_diff->>'old', '') = '' then 'filled' else 'changed' end end,
    case when p_action = 'edit_field' then left(p_diff->>'field', 64) end);
end
$$;
revoke execute on function public.audit_document(uuid, text, jsonb) from public, anon;
grant execute on function public.audit_document(uuid, text, jsonb) to authenticated;
```

   Command: `node scripts/migration-lint.ts packages/db/migrations/0063_pipeline_events.sql 2>&1 | tail -5` → passes.

2. **Edit** `_journal.json`: append after the last entry (keep valid JSON) `{ "idx": <last idx + 1>, "version": "7", "when": <Date.now()>, "tag": "0063_pipeline_events", "breakpoints": true }`. Command: `node -e 'const j=require("./packages/db/migrations/meta/_journal.json");console.log(j.entries.at(-1))'`.

3. **New file** `packages/db/src/schema/pipeline-events.ts`:

```ts
// Drizzle mirror of migrations/0063_pipeline_events.sql (05 §4). The SQL file is the source of truth;
// the trigger app.log_document_status(), audit_document() v2, the RLS policies and grants exist only in SQL.
import { sql } from 'drizzle-orm';
import { bigserial, index, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { extractionRuns } from './document-details';
import { documents } from './documents';
import { organizations } from './tenancy';

export const PIPELINE_EVENT_KINDS = [
  'status',
  'read',
  'read_failed',
  'user_edit',
  'user_trash',
  'user_restore',
  'user_manual',
  'user_answer',
] as const;
export type PipelineEventKind = (typeof PIPELINE_EVENT_KINDS)[number];

export const pipelineEvents = pgTable(
  'pipeline_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').$type<PipelineEventKind>().notNull(),
    code: text('code'),
    detail: text('detail'),
    fromStatus: text('from_status'),
    fieldKey: text('field_key'),
    extractionRunId: uuid('extraction_run_id').references(() => extractionRuns.id, {
      onDelete: 'set null',
    }),
    method: text('method'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    attempt: smallint('attempt'),
    blocking: text('blocking').array().notNull().default(sql`'{}'`),
    warnings: text('warnings').array().notNull().default(sql`'{}'`),
  },
  (t) => [
    index('pipeline_events_org_id_at_idx').on(t.orgId, t.at),
    index('pipeline_events_document_id_at_idx').on(t.documentId, t.at),
    index('pipeline_events_kind_at_idx').on(t.kind, t.at),
  ],
);
```

   If `./document-details` or `./documents` do not export those names, STOP.

4. **Edit** `packages/db/src/schema/index.ts`: add `export * from './pipeline-events';` in alphabetical position. Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5`.

5. **Edit** `packages/db/src/rls-catalog.ts`: in `READ_ONLY_FOR_USERS`, add `'pipeline_events',` after `'extraction_runs',`.

6. **Edit** `packages/db/src/document-reading.ts`:
   - add the import line `import { pipelineEvents } from './schema/pipeline-events';` after the `./schema/documents` import.
   - in `saveDocumentReading`, right after `const runId = inserted.id;` insert:

```ts
  const precheck = write.validations.find((check) => check.ruleId === 'PRECHECK_SKIPPED');
  await tx.insert(pipelineEvents).values({
    orgId,
    documentId,
    kind: 'read',
    code: write.status,
    detail: typeof precheck?.params.reason === 'string' ? precheck.params.reason : null,
    extractionRunId: runId,
    method: run.method ?? 'llm',
    model: run.model,
    promptVersion: run.promptVersion,
    attempt: run.attempt,
    blocking: write.validations.filter((c) => c.severity === 'blocking').map((c) => c.ruleId),
    warnings: write.validations.filter((c) => c.severity === 'warning').map((c) => c.ruleId),
  });
```

   - in `recordFailedRead`, change `await tx.insert(extractionRuns).values({ ... });` to `const [run] = await tx.insert(extractionRuns).values({ ... }).returning({ id: extractionRuns.id });` (values unchanged), then add before `if (failure.final)`:

```ts
  await tx.insert(pipelineEvents).values({
    orgId: failure.orgId,
    documentId: failure.documentId,
    kind: 'read_failed',
    code: failure.error.slice(0, 64),
    detail: failure.final ? 'final' : 'retry',
    extractionRunId: run?.id ?? null,
    method: 'llm',
    model: failure.model,
    promptVersion: failure.promptVersion,
    attempt: failure.attempt,
  });
```

   Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5` → no errors.

7. **New file** `packages/db/test/migrations/pipeline-events.db.test.ts`, exactly:

```ts
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0063_pipeline_events: status trigger, audit_document() v2 events, read-only for users. Skipped without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;
const OWNER = '0f0f0f0f-0000-4000-8000-000000000631';
const OUTSIDER = '0f0f0f0f-0000-4000-8000-000000000632';
const ROLLBACK = Symbol('rollback');

describe.skipIf(DATABASE_URL === undefined)('0063 pipeline_events', () => {
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

  beforeAll(async () => {
    await runMigrations(url);
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await sql`insert into auth.users (id) values (${OWNER}), (${OUTSIDER}) on conflict (id) do nothing`;
    const [org] = await sql<{ id: string }[]>`insert into organizations
      (name, inbound_email_slug, inbound_email_secret) values ('Events test', ${`events-${Date.now()}`}, 'ABCDEFGH')
      returning id`;
    orgId = org?.id ?? '';
    await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${OWNER}, 'owner')`;
    const [doc] = await sql<{ id: string }[]>`insert into documents (org_id, entry_mode)
      values (${orgId}, 'manual') returning id`;
    docId = doc?.id ?? '';
  });

  afterAll(async () => {
    if (orgId) await sql`delete from organizations where id = ${orgId}`;
    await sql?.end();
  });

  it('logs the new document and each status change, not a same-status update', async () => {
    await sql`update documents set status = 'needs_review' where id = ${docId}`;
    await sql`update documents set status = 'needs_review' where id = ${docId}`;
    await sql`update documents set status = 'ready' where id = ${docId}`;
    const rows = await sql`select code, from_status from pipeline_events
      where document_id = ${docId} and kind = 'status' order by id`;
    expect(rows.map((r) => [r.code, r.from_status])).toEqual([
      ['received', null],
      ['needs_review', 'received'],
      ['ready', 'needs_review'],
    ]);
  });

  it('audit_document logs the user action as codes, never the values', async () => {
    await as(OWNER, async (tx) => {
      await tx`select public.audit_document(${docId}, 'edit_field',
        ${tx.json({ field: 'total_gross', old: '100.00', new: '121.00' })})`;
      await tx`select public.audit_document(${docId}, 'edit_field',
        ${tx.json({ field: 'due_date', old: null, new: '2026-11-30' })})`;
      await tx`select public.audit_document(${docId}, 'trash', ${tx.json({})})`;
      const rows = await tx`select kind, code, field_key from pipeline_events
        where document_id = ${docId} and kind like 'user_%' order by id`;
      expect(rows.map((r) => [r.kind, r.code, r.field_key])).toEqual([
        ['user_edit', 'changed', 'total_gross'],
        ['user_edit', 'filled', 'due_date'],
        ['user_trash', null, null],
      ]);
      const text = JSON.stringify(
        await tx`select * from pipeline_events where document_id = ${docId}`,
      );
      expect(text).not.toContain('121.00');
      expect(text).not.toContain('2026-11-30');
    });
  });

  it('a user cannot write events, and another org sees none', async () => {
    let code: string | null = null;
    try {
      await as(OWNER, (tx) => tx`insert into pipeline_events (org_id, document_id, kind)
        values (${orgId}, ${docId}, 'status')`);
    } catch (e) {
      code = (e as { code?: string }).code ?? 'unknown';
    }
    expect(code).toBe('42501');
    const seen = await as(OUTSIDER, (tx) => tx`select count(*)::int as n from pipeline_events
      where document_id = ${docId}`);
    expect(seen[0]?.n).toBe(0);
  });
});
```

   If `documents` has no `entry_mode` column or `'manual'` is refused, STOP (it is used the same way in `test/migrations/audit-document.db.test.ts`).

8. **Edit** `packages/db/test/document-reading.db.test.ts`: add this case as the last `it` inside the describe (after the failed-read case):

```ts
  it('logs a read and each failed read in pipeline_events', async () => {
    await db.withTenant(ORG_R, (tx) => saveDocumentReading(tx, write()));
    await db.withTenant(ORG_R, (tx) =>
      recordFailedRead(tx, {
        orgId: ORG_R,
        documentId: DOC,
        model: 'claude-haiku-5-5',
        promptVersion: 'm02-proto-v3',
        error: 'http_529',
        attempt: 1,
        final: false,
      }),
    );
    const rows = await sql`select kind, code, detail, warnings, extraction_run_id is not null as has_run
      from pipeline_events where document_id = ${DOC} and kind in ('read', 'read_failed') order by id desc limit 2`;
    expect(rows.map((r) => [r.kind, r.code, r.detail, r.has_run])).toEqual([
      ['read_failed', 'http_529', 'retry', true],
      ['read', 'ready', null, true],
    ]);
    expect(rows[1]?.warnings).toEqual(['PROTO_DIC_FORMAT']);
  });
```

9. **Run the db tests locally** (Postgres 16 sandbox, see K-P03): `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -5`, export the printed `DATABASE_URL`, then `pnpm --filter @shoebox/db test -- pipeline-events document-reading audit-document meta 2>&1 | tail -30`. If the sandbox cannot start (no `postgres` OS user etc.), note it in the report and rely on CI; do not try to fix the environment.

10. **Edit** `docs/v3/05-data-model.md`:
    - right after the line `create index on extraction_runs (org_id, document_id);` add the `create table pipeline_events (...)` block and its three indexes, copied from step 1 (DDL only, no trigger or function), inside the same sql block.
    - after the sql block that contains it (the next line that is exactly three backticks), add one paragraph: `**pipeline_events (0063, brief 0520).** One row per step of a document's life, as codes only (never values): `status` from the trigger `app.log_document_status()` on every insert and status change, `read` and `read_failed` from the worker (`saveDocumentReading`, `recordFailedRead`), `user_*` from `audit_document()`. Analytics views come in 0064. Read-only for users (§10.2).`
    - in the §10.2 line that lists derived tables (it starts with ``| derived tables (`tax_ledger_entries``), add `` `pipeline_events`,`` after `` `extraction_runs`,``.

11. **Edit** `docs/context/decisions.md`: append `- 2026-10-26 [analytics] pipeline_events: codes-only log of reads, failures, status changes and user fixes, for failure analytics (0520). (owner)`.

12. Commands: `python3 scripts/context_lint.py 2>&1 | tail -5`, `pnpm exec biome ci packages/db 2>&1 | tail -10`, `node scripts/migration-lint.ts 2>&1 | tail -5`.

## 5. Do not touch

`apps/`, every other migration, every other package. Hard rules: no document content in the new table; no new dependency; never push to `main`.

## 6. Commands

- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/db test -- pipeline-events document-reading audit-document meta 2>&1 | tail -30` (with `DATABASE_URL`)
- `pnpm exec biome ci packages/db 2>&1 | tail -30`
- `node scripts/migration-lint.ts 2>&1 | tail -30`
- `python3 scripts/context_lint.py 2>&1 | tail -30`

## 7. Acceptance

- [ ] Typecheck, biome, migration lint and context lint pass.
- [ ] The four db test files pass locally, or the report says the sandbox could not start.
- [ ] No file outside §3 changed (`git diff --stat`).

## 8. Stop and ask

As in TEMPLATE §8.

## 9. Report

Write `docs/tasks/0520-report.md` (600 tokens at most), set `Status: review` here, commit everything as `0520 pipeline_events` on the current branch. Do not push.
