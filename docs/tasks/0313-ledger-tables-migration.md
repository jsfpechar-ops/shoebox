# 0313: migration 0041, `tax_ledger_entries` and `vat_ledger_entries` with read-only RLS

Status: todo
Ticket: P1-LEDG-01 / P1-LEDG-02 (tables) | Depends on: 0312 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 70k tokens

## 1. Objective

Create the two derived ledger tables of 05 §7 and the `ledger_build_version_seq` sequence, with the "users select only, worker writes" RLS pattern (05 §10.2), a testkit factory per table (the RLS meta-test requires one for every tenant table) and a migration test. The ledger builders of 0308 and 0311 produce the rows; the worker job that writes them is a later brief.

## 2. Context

Hard rule 3: every new table ships with RLS policies and an RLS test in the same PR. Hard rule 5: the DDL is 05 §7 verbatim, with two deliberate deviations that need no 05 edit (they are FK omissions, not column changes): `payment_link_id` and `transaction_id` reference `payment_links` / `transactions`, tables of P0-DB-08 that do not exist yet. They are created as plain `uuid` columns with `-- TODO(P0-DB-08): add the FK (alter table ... add constraint, forward-only) once the tables exist`.

05 §7 DDL (pasted; apply exactly, with the two FK omissions):

```sql
create sequence ledger_build_version_seq;                           -- monotonic, global (M04 §4.13)

create table tax_ledger_entries (                                    -- income tax, cash basis (M04 §4.11)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  entry_date date not null,
  tax_year smallint not null,
  basis text not null default 'payment' check (basis in ('payment','document_evidence','provisional')),
  document_id uuid references documents(id) on delete cascade,
  line_id uuid references document_lines(id) on delete cascade,
  payment_link_id uuid,                                             -- TODO(P0-DB-08): references payment_links(id) on delete cascade
  transaction_id uuid,                                              -- TODO(P0-DB-08): references transactions(id) on delete cascade
  category_code text not null references categories(code),
  tax_effect tax_effect not null,
  amount_czk numeric(15,2) not null,
  business_share_pct numeric(5,2) not null default 100,
  business_amount_czk numeric(15,2) not null default 0,
  build_version bigint not null
);
create index on tax_ledger_entries (org_id, tax_year, tax_effect);
create index on tax_ledger_entries (org_id, document_id);

create table vat_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  period_start date not null, period_end date not null,
  vat_point_date date not null,
  vat_point_rule text not null default 'duzp'
    check (vat_point_rule in ('duzp','max_duzp_received','issue_date','service_period_end','prepayment','eu_goods_15th','user_override')),
  document_id uuid not null references documents(id) on delete cascade,
  line_id uuid references document_lines(id) on delete cascade,
  vat_treatment vat_treatment not null,
  vat_rate_type vat_rate_type not null, vat_rate_pct numeric(5,2) not null,
  base_czk numeric(15,2) not null, vat_czk numeric(15,2) not null,
  deduction_pct numeric(5,2) not null default 100,
  currency char(3) not null default 'CZK', base_foreign numeric(15,2),
  fx_rate numeric(12,6), fx_amount integer, fx_rate_date date,
  dphdp3_rows text[] not null,
  kh_section text check (kh_section in ('A1','A2','A3','A4','A5','B1','B2','B3')),
  kh_document_total_czk numeric(15,2),
  shv_code smallint check (shv_code in (0,1,2,3)),
  counterparty_vat_id text, evidence_number text,
  build_version bigint not null
);
create index on vat_ledger_entries (org_id, period_start);
create index on vat_ledger_entries (org_id, document_id);
```

RLS: `select app.apply_tenant_rls_read_only('tax_ledger_entries'); select app.apply_tenant_rls_read_only('vat_ledger_entries');` (0005 helper: `<t>_select` + `<t>_worker`, no `<t>_write`; a user insert raises 42501). Both tables are already listed in `READ_ONLY_FOR_USERS` (`packages/db/src/rls-catalog.ts`); `rls-catalog` needs no change. Sequence grant: 0003's "grant on all sequences" covered only the sequences that existed then (see 0007 line 18–20), so add `grant usage, select on sequence ledger_build_version_seq to app_worker;`.

Testkit: `packages/testkit/src/factories/<area>.ts` exports `TenantFactory` functions and an `<area>Factories` list `[table, factory][]`, registered in `factories/index.ts`; `ensureParentRows` creates `document_id`/`line_id` parents from fresh `ctx.ids` because `documents` and `document_lines` have factories; `category_code` must be a seeded code (0312: `exp_other_deductible`). Money and percentages are numeric strings. `dphdp3_rows` is passed as the array literal string `'{5}'` (postgres.js sends it untyped; Postgres casts to `text[]`).

Journal: last entry after 0312 is `idx 9 … 0040_categories_seed`; this one is `idx 10, when 1760745600010, tag 0041_ledgers`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0041_ledgers.sql` | create | DDL above + RLS + grant |
| `packages/db/migrations/meta/_journal.json` | edit | one entry |
| `packages/testkit/src/factories/ledgers.ts` | create | two factories |
| `packages/testkit/src/factories/index.ts` | edit | import, export, register |
| `packages/db/test/migrations/ledgers.db.test.ts` | create | verbatim below |

## 4. Steps

1. Create `packages/db/test/migrations/ledgers.db.test.ts` with exactly:

```ts
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';
import { READ_ONLY_FOR_USERS } from '../../src/rls-catalog';

// 0041_ledgers (05 §7, §10.2): tax_ledger_entries, vat_ledger_entries, ledger_build_version_seq.
// Users select only; the worker writes. Migrates forward only; org prefix dddddddd is never
// touched by the RLS suite's cleanup.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG = 'dddddddd-0000-4000-8000-000000000001';
const OWNER = 'dddddddd-0000-4000-8000-0000000000a1';
const TABLES = ['tax_ledger_entries', 'vat_ledger_entries'] as const;
const ROLLBACK = Symbol('rollback');

function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('expected one row');
  }
  return row;
}

function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: { code?: string }) => e.code ?? 'unknown',
  );
}

describe.skipIf(DATABASE_URL === undefined)('0041: ledger tables', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let docId: string;
  let lineId: string;

  async function asUser<T>(uid: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await sql.begin(async (tx) => {
        const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
        await tx`select set_config('request.jwt.claim.sub', ${uid}, true),
          set_config('request.jwt.claims', ${claims}, true)`;
        await tx`set local role authenticated`;
        result = await fn(tx);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) {
        throw e;
      }
    }
    return result as T;
  }

  function taxRow(cols: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      org_id: ORG, entry_date: '2026-09-15', tax_year: 2026, document_id: docId, line_id: lineId,
      category_code: 'exp_other_deductible', tax_effect: 'deductible_expense',
      amount_czk: '12960.84', business_share_pct: '100.00', business_amount_czk: '12960.84', build_version: 1,
      ...cols,
    };
  }

  function vatRow(cols: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      org_id: ORG, period_start: '2026-08-01', period_end: '2026-08-31', vat_point_date: '2026-08-03',
      vat_point_rule: 'issue_date', document_id: docId, vat_treatment: 'rcv_eu_service_reverse_charge',
      vat_rate_type: 'standard', vat_rate_pct: '21.00', base_czk: '13699.77', vat_czk: '2876.95',
      dphdp3_rows: '{5}', build_version: 1,
      ...cols,
    };
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into auth.users (id) values (${OWNER}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org Ledgers', 'org-ledgers-0041', 'DDDDDDDD')`;
    await sql`insert into memberships (org_id, user_id, role) values (${ORG}, ${OWNER}, 'owner')`;
    docId = one(
      await sql<{ id: string }[]>`insert into documents (org_id, entry_mode) values (${ORG}, 'manual') returning id`,
    ).id;
    lineId = one(
      await sql<{ id: string }[]>`insert into document_lines (org_id, document_id, position) values (${ORG}, ${docId}, 1) returning id`,
    ).id;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id = ${ORG}`;
      await sql`delete from auth.users where id = ${OWNER}`;
      await sql.end();
    }
  });

  it('creates both tables with RLS, select and worker policies only', async () => {
    const rows = await sql<{ t: string; rls: boolean }[]>`select tablename as t, rowsecurity as rls
      from pg_tables where schemaname = 'public' and tablename = any(${[...TABLES]}) order by 1`;
    expect(rows).toEqual([
      { t: 'tax_ledger_entries', rls: true },
      { t: 'vat_ledger_entries', rls: true },
    ]);
    for (const table of TABLES) {
      const policies = await sql`select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = ${table} order by policyname`;
      expect(policies.map((p) => [p.policyname, p.cmd]), table).toEqual([
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
      ]);
      expect(READ_ONLY_FOR_USERS).toContain(table);
    }
  });

  it('the sequence exists and app_worker may use it', async () => {
    const [seq] = await sql<{ ok: boolean }[]>`select has_sequence_privilege('app_worker', 'ledger_build_version_seq', 'usage') as ok`;
    expect(seq?.ok).toBe(true);
    const [v] = await sql<{ n: string }[]>`select nextval('ledger_build_version_seq')::text as n`;
    expect(v?.n).toMatch(/^\d+$/);
  });

  it('money columns are numeric(15,2); fx_rate numeric(12,6); percentages numeric(5,2)', async () => {
    const cols = await sql<{ t: string; c: string; p: number; s: number }[]>`
      select table_name as t, column_name as c, numeric_precision as p, numeric_scale as s
      from information_schema.columns where table_schema = 'public'
        and table_name = any(${[...TABLES]}) and data_type = 'numeric' order by 1, 2`;
    const byName = Object.fromEntries(cols.map((x) => [`${x.t}.${x.c}`, [x.p, x.s]]));
    expect(byName['tax_ledger_entries.amount_czk']).toEqual([15, 2]);
    expect(byName['tax_ledger_entries.business_amount_czk']).toEqual([15, 2]);
    expect(byName['tax_ledger_entries.business_share_pct']).toEqual([5, 2]);
    expect(byName['vat_ledger_entries.base_czk']).toEqual([15, 2]);
    expect(byName['vat_ledger_entries.vat_czk']).toEqual([15, 2]);
    expect(byName['vat_ledger_entries.base_foreign']).toEqual([15, 2]);
    expect(byName['vat_ledger_entries.kh_document_total_czk']).toEqual([15, 2]);
    expect(byName['vat_ledger_entries.fx_rate']).toEqual([12, 6]);
    expect(byName['vat_ledger_entries.deduction_pct']).toEqual([5, 2]);
    expect(byName['vat_ledger_entries.vat_rate_pct']).toEqual([5, 2]);
  });

  it('service role inserts valid rows; defaults apply', async () => {
    const [t] = await sql<{ basis: string; share: string }[]>`insert into tax_ledger_entries ${sql(
      taxRow(), 'org_id', 'entry_date', 'tax_year', 'document_id', 'line_id', 'category_code', 'tax_effect', 'amount_czk', 'build_version',
    )} returning basis, business_share_pct::text as share`;
    expect(t).toEqual({ basis: 'payment', share: '100.00' });
    const [v] = await sql<{ rows: string[]; cur: string; ded: string }[]>`insert into vat_ledger_entries ${sql(
      vatRow(),
    )} returning dphdp3_rows as rows, currency as cur, deduction_pct::text as ded`;
    expect(v).toEqual({ rows: ['5'], cur: 'CZK', ded: '100.00' });
    const [v2] = await sql<{ rows: string[] }[]>`insert into vat_ledger_entries ${sql(
      vatRow({ dphdp3_rows: '{5,43}', kh_section: 'A2', kh_document_total_czk: '13699.77' }),
    )} returning dphdp3_rows as rows`;
    expect(v2?.rows).toEqual(['5', '43']);
    await sql`delete from tax_ledger_entries where org_id = ${ORG}`;
    await sql`delete from vat_ledger_entries where org_id = ${ORG}`;
  });

  it('checks: basis, vat_point_rule, kh_section, shv_code; FK to categories', async () => {
    expect(await code(sql`insert into tax_ledger_entries ${sql(taxRow({ basis: 'guess' }))}`)).toBe('23514');
    expect(await code(sql`insert into tax_ledger_entries ${sql(taxRow({ category_code: 'nope' }))}`)).toBe('23503');
    expect(await code(sql`insert into vat_ledger_entries ${sql(vatRow({ vat_point_rule: 'tomorrow' }))}`)).toBe('23514');
    expect(await code(sql`insert into vat_ledger_entries ${sql(vatRow({ kh_section: 'C1' }))}`)).toBe('23514');
    expect(await code(sql`insert into vat_ledger_entries ${sql(vatRow({ shv_code: 4 }))}`)).toBe('23514');
    expect(await code(sql`insert into vat_ledger_entries ${sql(vatRow({ vat_treatment: 'rcv_magic' }))}`)).toBe('22P02');
  });

  it('users read their org and cannot insert, update or delete (42501 / no row)', async () => {
    await sql`insert into tax_ledger_entries ${sql(taxRow())}`;
    await sql`insert into vat_ledger_entries ${sql(vatRow())}`;
    const seen = await asUser(OWNER, async (tx) => {
      const [a] = await tx<{ n: number }[]>`select count(*)::int as n from tax_ledger_entries where org_id = ${ORG}`;
      const [b] = await tx<{ n: number }[]>`select count(*)::int as n from vat_ledger_entries where org_id = ${ORG}`;
      return [a?.n, b?.n];
    });
    expect(seen).toEqual([1, 1]);
    expect(await code(asUser(OWNER, (tx) => tx`insert into tax_ledger_entries ${tx(taxRow())}`))).toBe('42501');
    expect(await code(asUser(OWNER, (tx) => tx`insert into vat_ledger_entries ${tx(vatRow())}`))).toBe('42501');
    const touched = await asUser(OWNER, async (tx) => {
      const u = await tx`update vat_ledger_entries set vat_czk = 0 where org_id = ${ORG}`;
      const d = await tx`delete from tax_ledger_entries where org_id = ${ORG}`;
      return [u.count, d.count];
    });
    expect(touched).toEqual([0, 0]);
  });

  it('deleting the document cascades to both ledgers', async () => {
    const d = one(
      await sql<{ id: string }[]>`insert into documents (org_id, entry_mode) values (${ORG}, 'manual') returning id`,
    ).id;
    await sql`insert into tax_ledger_entries ${sql(taxRow({ document_id: d, line_id: null }))}`;
    await sql`insert into vat_ledger_entries ${sql(vatRow({ document_id: d }))}`;
    await sql`delete from documents where id = ${d}`;
    const [n] = await sql<{ n: number }[]>`select (select count(*) from tax_ledger_entries where document_id = ${d})::int
      + (select count(*) from vat_ledger_entries where document_id = ${d})::int as n`;
    expect(n?.n).toBe(0);
  });
});
```

Command: `pnpm --filter @shoebox/db test -- ledgers 2>&1 | tail -30`. Expected: fails (tables missing).

2. Create `packages/db/migrations/0041_ledgers.sql`: a header comment (`-- 0041_ledgers: 05 §7 derived ledgers … users select only (05 §10.2) … Forward-only.`), then the DDL of §2 exactly, then:

```sql
-- 0003's "grant on all sequences" covered only the sequences that existed then.
grant usage, select on sequence ledger_build_version_seq to app_worker;

select app.apply_tenant_rls_read_only('tax_ledger_entries');
select app.apply_tenant_rls_read_only('vat_ledger_entries');
```

   Add the journal entry (`idx 10, when 1760745600010, tag "0041_ledgers"`). Run `node scripts/migration-lint.ts packages/db/migrations/0041_ledgers.sql 2>&1 | tail -5`.

3. Create `packages/testkit/src/factories/ledgers.ts`:

```ts
import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §7 ledger tables (migration 0041). Both are select-only for users; the RLS
 * suite inserts them with the service connection. `document_id` is a fresh id that
 * `ensureParentRows()` turns into a document; `category_code` is a code seeded by 0040.
 * Money is a numeric string (never a float). `dphdp3_rows` is an array literal (text[]).
 */
export const taxLedgerEntryFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  entry_date: '2026-09-15',
  tax_year: 2026,
  basis: 'payment',
  document_id: ctx.ids.next(),
  category_code: 'exp_other_deductible',
  tax_effect: 'deductible_expense',
  amount_czk: '100.00',
  business_share_pct: '100.00',
  business_amount_czk: '100.00',
  build_version: 1,
  ...overrides,
});

export const vatLedgerEntryFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  period_start: '2026-08-01',
  period_end: '2026-08-31',
  vat_point_date: '2026-08-03',
  vat_point_rule: 'issue_date',
  document_id: ctx.ids.next(),
  vat_treatment: 'rcv_eu_service_reverse_charge',
  vat_rate_type: 'standard',
  vat_rate_pct: '21.00',
  base_czk: '100.00',
  vat_czk: '21.00',
  dphdp3_rows: '{5}',
  build_version: 1,
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const ledgerFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['tax_ledger_entries', taxLedgerEntryFactory],
  ['vat_ledger_entries', vatLedgerEntryFactory],
];
```

   Edit `packages/testkit/src/factories/index.ts`: add `import { ledgerFactories } from './ledgers';` (biome orders imports), add `export { taxLedgerEntryFactory, vatLedgerEntryFactory } from './ledgers';` among the exports, add `...ledgerFactories,` after `...platformFactories,` in the registration loop, and extend the doc comment with `ledgers.ts covers 0041`. `pnpm exec biome check --write packages/testkit/src/factories 2>&1 | tail -5`; `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`.

4. `pnpm db:start 2>&1 | tail -5` (stop and report if no local Postgres). `pnpm --filter @shoebox/db test -- ledgers 2>&1 | tail -30` → green. Then `pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30`: the RLS suite (meta, isolation, roles, worker) now iterates the two new tables through their factories and must be green. If the `dphdp3_rows: '{5}'` literal is rejected by the suite's insert helper (type error on an untyped parameter), change the factory value to `['5']` and report it; do not change the migration.

## 5. Do not touch

05 (the DDL is already there), `rls-catalog.ts`, drizzle schema (brief 0314), `apply_tenant_rls*` helpers, 0040, `packages/domain`.

## 6. Commands

- `pnpm --filter @shoebox/db test -- ledgers 2>&1 | tail -30`
- `pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30`
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`
- `node scripts/migration-lint.ts 2>&1 | tail -5`

## 7. Acceptance

- [ ] Test file green, unchanged; RLS suite green with the two new tables.
- [ ] Journal entry; migration-lint clean; no `drop`/`rename`.
- [ ] Commits `0313 step 1..4`; no push.

## 8. Stop and ask

As TEMPLATE §8. Stop if `categories` has no `exp_other_deductible` row (0312 not merged) or if the RLS meta-test demands anything beyond a factory for the new tables.

## 9. Report

`docs/tasks/0313-report.md`, `Status: review`, commit `0313 report`. Note the two FK omissions for the P0-DB-08 follow-up.

## Spec notes for the reviewer

- 05 §7 references `payment_links(id)` and `transactions(id)`; those tables (P0-DB-08, lane A/M07) do not exist on `phase/0`. The columns are created without FKs and a forward-only `alter table … add constraint` is left to the migration that creates them. 05 needs no edit now; the FK should be added there when P0-DB-08 lands.
- `dphdp3_rows text[] not null` has no default; the builder (0311) never emits an entry without rows unless an SH code is set, in which case it writes `'{}'`.

## Risk list (for the reviewer)

`packages/db/migrations/0041_ledgers.sql`; `packages/testkit/src/factories/index.ts` (registry shared by the whole RLS suite).

## Owner steps

None.
