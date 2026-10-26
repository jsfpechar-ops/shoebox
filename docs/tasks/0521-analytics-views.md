# 0521: analytics views and CSV export for failure analysis

Status: todo
Ticket: owner ask 2026-10-26 (failure logging for analytics) | Depends on: 0520 | Base commit: after 0520 | Branch: claude/project-thread-5vgi6d | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add five staff-only Postgres views over `pipeline_events` (0520), `extraction_runs` and `documents`, plus a script that writes them to CSV files. With them we can see per week why documents did not go straight to ready, which fields the AI gets wrong per model and prompt version, what AI reading costs, and which suppliers cause most fixes.

## 2. Context

- `pipeline_events` (0063): `kind` in `status | read | read_failed | user_edit | user_trash | user_restore | user_manual | user_answer`; `code` (read: outcome status, read_failed: error code, user_edit: `filled|changed`, status: new status), `detail`, `field_key`, `model`, `prompt_version`, `method`, `blocking text[]`, `warnings text[]`.
- `extraction_runs` (05): `stage, method (field_source enum), model, prompt_version, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd numeric(10,5), ok, created_at`.
- The views live in their own schema `analytics`, which no app role (`anon`, `authenticated`, `app_worker`) can use: staff read it with the service role. This keeps the RLS meta-test (it only scans schema `public`) untouched.
- Privacy: codes, counts and supplier IČO (a public company ID) only; never names, amounts or field values.
- Scripts under `packages/db/scripts/` run with plain Node 22 (type stripping), like `scripts/migration-lint.ts`; they are not in the package tsconfig.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0064_analytics_views.sql` | new | schema + 5 views |
| `packages/db/migrations/meta/_journal.json` | edit | append `0064_analytics_views` |
| `packages/db/src/analytics.ts` | new | view list, `toCsv`, `readAnalyticsView` |
| `packages/db/scripts/analytics-export.ts` | new | CLI |
| `packages/db/test/analytics.test.ts` | new | `toCsv` unit test |
| `packages/db/test/migrations/analytics-views.db.test.ts` | new | views on real rows |
| `package.json` (root) | edit | script `analytics:export` |
| `docs/v3/05-data-model.md` | edit | one paragraph |

No other file may change.

## 4. Steps

1. **New file** `packages/db/migrations/0064_analytics_views.sql`, exactly:

```sql
-- 0064_analytics_views (brief 0521, owner 2026-10-26): staff-only views for failure analytics over
-- pipeline_events (0063), extraction_runs and documents. Schema `analytics` is not usable by app roles
-- (anon, authenticated, app_worker); only the service role reads it, e.g. through
-- packages/db/scripts/analytics-export.ts. Codes, counts and supplier IČO only. Forward-only.
create schema analytics;
revoke all on schema analytics from public;
grant usage on schema analytics to service_role;

-- Per week: read outcomes, failed model calls, checks that fired, user actions.
create view analytics.failure_reasons_weekly as
select date_trunc('week', e.at)::date as week, e.kind, e.code, e.detail, e.model, e.prompt_version,
  count(*)::int as events, count(distinct e.document_id)::int as documents
from (
  select p.at, p.document_id, p.kind, p.code, p.detail, p.model, p.prompt_version
    from public.pipeline_events p where p.kind <> 'status'
  union all
  select p.at, p.document_id, 'check_blocking', r.rule_id, null, p.model, p.prompt_version
    from public.pipeline_events p cross join unnest(p.blocking) as r(rule_id) where p.kind = 'read'
  union all
  select p.at, p.document_id, 'check_warning', r.rule_id, null, p.model, p.prompt_version
    from public.pipeline_events p cross join unnest(p.warnings) as r(rule_id) where p.kind = 'read'
) e
group by 1, 2, 3, 4, 5, 6;

-- Which fields users fix, by the model and prompt of the read before the fix.
create view analytics.field_corrections as
select e.field_key, r.model, r.prompt_version, r.method,
  count(*) filter (where e.code = 'changed')::int as changed,
  count(*) filter (where e.code = 'filled')::int as filled,
  count(distinct e.document_id)::int as documents
from public.pipeline_events e
left join lateral (
  select p.model, p.prompt_version, p.method from public.pipeline_events p
  where p.document_id = e.document_id and p.kind = 'read' and p.id < e.id
  order by p.id desc limit 1
) r on true
where e.kind = 'user_edit'
group by 1, 2, 3, 4;

-- One row per document: how it went from upload to ready, and what the AI calls cost.
create view analytics.document_journey as
select d.id as document_id, d.org_id, d.status::text as status, d.class::text as class, d.entry_mode,
  d.deleted_at is not null as trashed,
  ev.first_at, ev.reads, ev.failed_reads, ev.user_edits, ev.first_outcome, ev.ready_at,
  round(extract(epoch from ev.ready_at - ev.first_at) / 3600, 2) as hours_to_ready,
  (ev.first_outcome = 'ready' and ev.user_edits = 0) as straight_through,
  c.calls as ai_calls, c.input_tokens, c.output_tokens, c.cost_usd
from public.documents d
cross join lateral (
  select min(e.at) as first_at,
    count(*) filter (where e.kind = 'read')::int as reads,
    count(*) filter (where e.kind = 'read_failed')::int as failed_reads,
    count(*) filter (where e.kind = 'user_edit')::int as user_edits,
    (array_agg(e.code order by e.id) filter (where e.kind = 'read'))[1] as first_outcome,
    min(e.at) filter (where e.kind = 'status' and e.code = 'ready') as ready_at
  from public.pipeline_events e where e.document_id = d.id
) ev
cross join lateral (
  select count(*)::int as calls, coalesce(sum(r.input_tokens), 0)::bigint as input_tokens,
    coalesce(sum(r.output_tokens), 0)::bigint as output_tokens, sum(r.cost_usd) as cost_usd
  from public.extraction_runs r
  where r.document_id = d.id and r.method in ('llm', 'llm_escalated')
) c;

-- AI usage per week, stage, model and prompt version.
create view analytics.ai_cost_weekly as
select date_trunc('week', r.created_at)::date as week, r.stage, r.method::text as method, r.model,
  r.prompt_version,
  count(*)::int as calls, count(*) filter (where r.ok)::int as ok_calls,
  count(distinct r.document_id)::int as documents,
  coalesce(sum(r.input_tokens), 0)::bigint as input_tokens,
  coalesce(sum(r.output_tokens), 0)::bigint as output_tokens,
  coalesce(sum(r.cache_read_tokens), 0)::bigint as cache_read_tokens,
  coalesce(sum(r.cache_write_tokens), 0)::bigint as cache_write_tokens,
  sum(r.cost_usd) as cost_usd
from public.extraction_runs r
group by 1, 2, 3, 4, 5;

-- Suppliers (by IČO, per org) whose documents need the most fixing; feeds supplier memory.
create view analytics.supplier_trouble as
select j.org_id, d.partner_snapshot->>'ico' as supplier_ico,
  count(*)::int as documents,
  sum(j.user_edits)::int as user_edits,
  sum(j.failed_reads)::int as failed_reads,
  count(*) filter (where j.straight_through is not true)::int as not_straight_through
from analytics.document_journey j
join public.documents d on d.id = j.document_id
where d.partner_snapshot->>'ico' is not null
group by 1, 2;

revoke all on all tables in schema analytics from public;
grant select on all tables in schema analytics to service_role;
```

   Command: `node scripts/migration-lint.ts packages/db/migrations/0064_analytics_views.sql 2>&1 | tail -5`.

2. **Edit** `_journal.json`: append after the last entry `{ "idx": <last idx + 1>, "version": "7", "when": <node -e 'console.log(Date.now())'>, "tag": "0064_analytics_views", "breakpoints": true }`. The new `when` must be larger than every other `when` in the file; check with `node -e 'const j=require("./packages/db/migrations/meta/_journal.json");const w=j.entries.map(e=>e.when);console.log(Math.max(...w.slice(0,-1))<w.at(-1))'` → `true`.

3. **New file** `packages/db/src/analytics.ts`, exactly:

```ts
// Staff-only failure analytics (brief 0521): the views of migrations/0064_analytics_views.sql and a
// CSV writer. Read with the service role; app roles cannot use schema `analytics`.
import type { Sql } from 'postgres';

export const ANALYTICS_VIEWS = [
  'failure_reasons_weekly',
  'field_corrections',
  'document_journey',
  'ai_cost_weekly',
  'supplier_trouble',
] as const;
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

/** The column a `from` date filters on, per view; views without one are all-time. */
const FROM_COLUMN: Partial<Record<AnalyticsView, string>> = {
  failure_reasons_weekly: 'week',
  ai_cost_weekly: 'week',
  document_journey: 'first_at',
};

/** RFC 4180 CSV with a header row from the first row's keys. Arrays join with ';', dates as ISO. */
export function toCsv(rows: readonly Record<string, unknown>[]): string {
  const first = rows[0];
  if (!first) return '';
  const keys = Object.keys(first);
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text =
      value instanceof Date
        ? value.toISOString()
        : Array.isArray(value)
          ? value.join(';')
          : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [keys.join(','), ...rows.map((row) => keys.map((key) => cell(row[key])).join(','))];
  return `${lines.join('\n')}\n`;
}

/** All rows of one view (whole view on purpose: it is an export), optionally from a date (YYYY-MM-DD). */
export async function readAnalyticsView(
  sql: Sql,
  view: AnalyticsView,
  from?: string,
): Promise<Record<string, unknown>[]> {
  if (!ANALYTICS_VIEWS.includes(view)) throw new Error('unknown_view');
  const column = FROM_COLUMN[view];
  if (from !== undefined && column !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('bad_from_date');
    return sql.unsafe(`select * from analytics.${view} where ${column} >= $1`, [from]);
  }
  return sql.unsafe(`select * from analytics.${view}`);
}
```

   If typecheck rejects the `sql.unsafe` return type, cast the result with `as unknown as Record<string, unknown>[]`; change nothing else.

4. **New file** `packages/db/scripts/analytics-export.ts`, exactly:

```ts
// Staff-only CSV export of the failure analytics views (brief 0521). One CSV per view.
// Usage: DATABASE_URL=<service-role or postgres URL> node packages/db/scripts/analytics-export.ts \
//          [--from 2026-10-01] [--out analytics-out]
// The CSVs hold codes, counts and supplier IČO only. Do not commit them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { ANALYTICS_VIEWS, readAnalyticsView, toCsv } from '../src/analytics.ts';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}
const out = arg('out') ?? 'analytics-out';
const from = arg('from');
mkdirSync(out, { recursive: true });
const sql = postgres(url, { max: 1, onnotice: () => undefined });
try {
  for (const view of ANALYTICS_VIEWS) {
    const rows = await readAnalyticsView(sql, view, from);
    writeFileSync(join(out, `${view}.csv`), toCsv(rows));
    console.log(`${view}: ${rows.length} rows`);
  }
} finally {
  await sql.end();
}
```

5. **Edit** root `package.json`: in `scripts`, after the `"check:tenant-sql"` line add `"analytics:export": "node packages/db/scripts/analytics-export.ts",`. Also add `analytics-out/` to the root `.gitignore` if that file exists; if adding it would change a file outside §3, skip it and say so in the report.

6. **New file** `packages/db/test/analytics.test.ts`, exactly:

```ts
import { describe, expect, it } from 'vitest';
import { ANALYTICS_VIEWS, toCsv } from '../src/analytics';

describe('toCsv', () => {
  it('writes a header and quotes only what needs quoting', () => {
    const csv = toCsv([
      { kind: 'read', code: 'needs_review', events: 3, rules: ['MATH_SUM', 'ICO_CHECK'] },
      { kind: 'user_edit', code: 'a "b", c', events: null, rules: [] },
    ]);
    expect(csv).toBe(
      'kind,code,events,rules\nread,needs_review,3,MATH_SUM;ICO_CHECK\nuser_edit,"a ""b"", c",,\n',
    );
  });

  it('writes dates as ISO and an empty input as an empty file', () => {
    expect(toCsv([{ at: new Date('2026-10-26T10:00:00Z') }])).toBe('at\n2026-10-26T10:00:00.000Z\n');
    expect(toCsv([])).toBe('');
  });

  it('lists the five views of 0064', () => {
    expect(ANALYTICS_VIEWS).toHaveLength(5);
  });
});
```

   Command: `pnpm --filter @shoebox/db test -- test/analytics.test.ts 2>&1 | tail -15` → 3 passed.

7. **New file** `packages/db/test/migrations/analytics-views.db.test.ts`, exactly:

```ts
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAnalyticsView } from '../../src/analytics';
import { runMigrations } from '../../src/migrate';

// 0064_analytics_views on known rows; staff-only. Skipped without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;
const USER = '0f0f0f0f-0000-4000-8000-000000000641';
const MODEL = 'test-model-0521';

describe.skipIf(DATABASE_URL === undefined)('0064 analytics views', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let orgId = '';
  let docId = '';

  beforeAll(async () => {
    await runMigrations(url);
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await sql`insert into auth.users (id) values (${USER}) on conflict (id) do nothing`;
    const [org] = await sql<{ id: string }[]>`insert into organizations
      (name, inbound_email_slug, inbound_email_secret) values ('Analytics test', ${`analytics-${Date.now()}`}, 'ABCDEFGH')
      returning id`;
    orgId = org?.id ?? '';
    await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${USER}, 'owner')`;
    const [doc] = await sql<{ id: string }[]>`insert into documents (org_id, entry_mode, partner_snapshot)
      values (${orgId}, 'manual', ${sql.json({ ico: '27082440' })}) returning id`;
    docId = doc?.id ?? '';
    await sql`insert into extraction_runs (org_id, document_id, stage, method, ok, model, prompt_version,
        input_tokens, output_tokens, cost_usd)
      values (${orgId}, ${docId}, 'extract', 'llm', true, ${MODEL}, 'p-0521', 1000, 200, 0.0012)`;
    await sql`insert into pipeline_events (org_id, document_id, kind, code, model, prompt_version, method, blocking)
      values (${orgId}, ${docId}, 'read', 'needs_review', ${MODEL}, 'p-0521', 'llm', '{MATH_SUM}')`;
    await sql`insert into pipeline_events (org_id, document_id, kind, code, detail, model)
      values (${orgId}, ${docId}, 'read_failed', 'http_529', 'retry', ${MODEL})`;
    await sql`insert into pipeline_events (org_id, document_id, kind, code, field_key)
      values (${orgId}, ${docId}, 'user_edit', 'changed', 'total_gross')`;
    await sql`update documents set status = 'ready' where id = ${docId}`;
  });

  afterAll(async () => {
    if (orgId) await sql`delete from organizations where id = ${orgId}`;
    await sql?.end();
  });

  it('counts failure reasons and the checks that fired', async () => {
    const rows = (await readAnalyticsView(sql, 'failure_reasons_weekly')).filter(
      (r) => r.model === MODEL,
    );
    const pick = (kind: string) => rows.find((r) => r.kind === kind);
    expect(pick('check_blocking')?.code).toBe('MATH_SUM');
    expect(pick('read')?.code).toBe('needs_review');
    expect(pick('read_failed')?.code).toBe('http_529');
  });

  it('ties a user fix to the model of the read before it', async () => {
    const rows = await readAnalyticsView(sql, 'field_corrections');
    const row = rows.find((r) => r.field_key === 'total_gross' && r.model === MODEL);
    expect(row?.changed).toBe(1);
    expect(row?.prompt_version).toBe('p-0521');
  });

  it('shows the document journey, cost and supplier', async () => {
    const [j] = await sql`select * from analytics.document_journey where document_id = ${docId}`;
    expect(j?.reads).toBe(1);
    expect(j?.failed_reads).toBe(1);
    expect(j?.user_edits).toBe(1);
    expect(j?.first_outcome).toBe('needs_review');
    expect(j?.straight_through).toBe(false);
    expect(j?.ai_calls).toBe(1);
    expect(j?.ready_at).not.toBeNull();
    const [s] = await sql`select * from analytics.supplier_trouble where org_id = ${orgId}`;
    expect(s?.supplier_ico).toBe('27082440');
    expect(s?.user_edits).toBe(1);
    const cost = (await readAnalyticsView(sql, 'ai_cost_weekly')).find((r) => r.model === MODEL);
    expect(cost?.calls).toBe(1);
  });

  it('app roles cannot read the analytics schema', async () => {
    for (const role of ['authenticated', 'anon', 'app_worker']) {
      let code: string | null = null;
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select count(*) from analytics.document_journey`;
        });
      } catch (e) {
        code = (e as { code?: string }).code ?? 'unknown';
      }
      expect(code, role).toBe('42501');
    }
  });
});
```

8. **Run the db tests locally** (Postgres 16 sandbox, K-P03): if 0520 left it running, reuse it; else `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -5`, export the printed `DATABASE_URL`, then `pnpm --filter @shoebox/db test -- analytics pipeline-events meta 2>&1 | tail -30`. If the sandbox cannot start, say so in the report and rely on CI. If a view fails to create, fix only the SQL in 0064 and say what you changed.

9. **Edit** `docs/v3/05-data-model.md`: after the `**pipeline_events (0063, brief 0520).**` paragraph add: `**Analytics views (0064, brief 0521).** Schema `analytics`, service role only (no app role has usage): `failure_reasons_weekly`, `field_corrections`, `document_journey`, `ai_cost_weekly`, `supplier_trouble`. Export: `pnpm analytics:export -- --from YYYY-MM-DD --out analytics-out` with a service-role `DATABASE_URL`.`

10. Commands: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5`, `pnpm exec biome ci packages/db package.json 2>&1 | tail -10`, `node scripts/migration-lint.ts 2>&1 | tail -5`, `python3 scripts/context_lint.py 2>&1 | tail -5`.

## 5. Do not touch

`apps/`, every other migration, `packages/db/src/rls-catalog.ts`, other packages. Hard rules: no field values, names or amounts in a view; no new dependency; never push to `main`.

## 6. Commands

As in steps 6, 8 and 10.

## 7. Acceptance

- [ ] Unit test 3/3, typecheck, biome, migration lint, context lint pass.
- [ ] The db tests pass locally, or the report says the sandbox could not start.
- [ ] No file outside §3 changed.

## 8. Stop and ask

As in TEMPLATE §8.

## 9. Report

Write `docs/tasks/0521-report.md` (600 tokens at most), set `Status: review` here, commit everything as `0521 analytics views` on the current branch. Do not push.
