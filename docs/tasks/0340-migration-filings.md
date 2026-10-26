# 0340: Migration 0043 `filings`, `filing_documents`, `filing_entries` + RLS + factories

Status: todo
Ticket: P3-VAT-09 (schema) | Depends on: none | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 55k tokens

## 1. Objective

Create the three output tables of 05 §8 that Phase 3 writes (the backlog says they exist since Phase 0; they do not: no migration has them), with RLS and the testkit factories the RLS meta-test demands (AGENTS rule 3).

## 2. Context

05 §8 DDL (verbatim; keep column order and names):
```sql
create table filings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  type filing_type not null, kind filing_kind not null default 'radne',
  origin filing_origin not null default 'generated',
  source_document_id uuid references documents(id),                 -- imported own return (government_filing)
  period_start date not null, period_end date not null,
  state filing_state not null default 'draft',
  amends_filing_id uuid references filings(id),
  bundle_id uuid,                                                   -- DPHDP3 + DPHKH1 + DPHSHV generated together
  form_version text,                                                -- e.g. 'DPHDP3 03.01.04'
  totals jsonb not null default '{}',                               -- row → value snapshot
  inputs jsonb not null default '{}',                               -- podklady wizard answers (M06 §4.8); NEVER rodné číslo
  xml_path text, pdf_path text, xlsx_path text,                     -- DPFDP7_PARTIAL: xml_path always null (not stored)
  xsd_valid boolean, xsd_errors jsonb,
  simple_check jsonb not null default '{}',                         -- why simple / why not (M05 §4.3)
  generated_at timestamptz, generated_by uuid references auth.users(id),
  marked_filed_at timestamptz, filed_on date, submission_ref text,  -- podací číslo (optional)
  discovered_on date,                                               -- d_zjist for dodatečné / následné
  constraint filings_inputs_no_rc check (not (inputs ?| array['rodneCislo','rod_c','rodne_cislo']))
);
create unique index filings_one_open_per_kind on filings (org_id, type, period_start, kind)
  where state in ('draft','generated','downloaded');

create table filing_documents (                                      -- snapshot of what went in
  filing_id uuid not null references filings(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id),
  document_revision integer not null,
  primary key (filing_id, document_id)
);
create index on filing_documents (org_id, document_id);

create table filing_entries (                                        -- entry-level snapshot for amendment diffs; immutable after insert
  filing_id uuid not null references filings(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id),
  document_revision integer not null,
  vat_treatment vat_treatment not null, vat_rate_type vat_rate_type not null,
  dphdp3_rows text[] not null, kh_section text, shv_code smallint,
  counterparty_vat_id text, evidence_number text, vat_point_date date not null,
  base_czk numeric(15,2) not null, vat_czk numeric(15,2) not null
);
create index on filing_entries (org_id, filing_id);
```
Add two extra lines (05 §8 constraint already implied): `create index on filings (org_id, period_start);` and `create index on filing_documents (org_id, filing_id);`. Enums `filing_type/kind/state/origin` exist (0001). RLS (05 §10.2): `filings` and `filing_documents` are ordinary tenant tables → `select app.apply_tenant_rls('filings'); select app.apply_tenant_rls('filing_documents');` (three policies: select for members, write for owner/member, worker); `filing_entries` is read-only for users → `select app.apply_tenant_rls_read_only('filing_entries');` (already listed in `READ_ONLY_FOR_USERS` of `packages/db/src/rls-catalog.ts`; do not edit that file). Add `filing_entries` immutability: `create trigger filing_entries_immutable before update on filing_entries for each row execute function app.reject_update();` only if `app.reject_update` exists (`grep -rn 'reject_update\|immutable' packages/db/migrations/*.sql`); otherwise leave a comment `-- immutability enforced by the worker (no update path)`.

Migration mechanics: `packages/db/migrations/0043_filings.sql` + one journal entry appended to `packages/db/migrations/meta/_journal.json` (next `idx` after the last entry, `when` = last `when` + 1, `tag: "0043_filings"`, `breakpoints: true`; the journal lists other lanes' 0051–0062 before ours: order of entries is what matters, not the number). Forward-only (`scripts/migration-lint.ts`: no drop/rename). Lane C owns 0040–0049; 0042 is reserved. Factories: `packages/testkit/src/factories/<area>.ts` exporting `TenantFactory`s and a `const <area>Factories: [table, factory][]` list registered in `factories/index.ts` (see `ledgers.ts` and the `for` loop in `index.ts`). Test pattern: `packages/db/test/migrations/ledgers.db.test.ts` (org prefix `dddddddd`; `asUser` helper; `describe.skipIf(DATABASE_URL === undefined)`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0043_filings.sql` | create | DDL above + indexes + RLS |
| `packages/db/migrations/meta/_journal.json` | edit | append the entry |
| `packages/testkit/src/factories/filings.ts` | create | `filingFactory`, `filingDocumentFactory`, `filingEntryFactory`, `export const filingFactories` |
| `packages/testkit/src/factories/index.ts` | edit | export the three + spread `...filingFactories` in the loop; doc comment "filings.ts covers 0043" |
| `packages/db/test/migrations/filings.db.test.ts` | create | below |

## 4. Steps

1. Migration + journal. `pnpm exec vitest run --project unit scripts/test/migration-lint.test.ts 2>&1 | tail -30` (if that file exists; else skip).
2. Factories: `filingFactory` defaults `{ id, org_id, type: 'DPHDP3', kind: 'radne', origin: 'generated', period_start: '2026-08-01', period_end: '2026-08-31', state: 'draft', totals: {}, inputs: {}, simple_check: {} }`; `filingDocumentFactory` `{ filing_id: ctx.ids.next(), org_id, document_id: ctx.ids.next(), document_revision: 1 }`; `filingEntryFactory` `{ filing_id, org_id, document_id, document_revision: 1, vat_treatment: 'rcv_eu_service_reverse_charge', vat_rate_type: 'standard', dphdp3_rows: '{5}', vat_point_date: '2026-08-03', base_czk: '13699.77', vat_czk: '2876.95' }`. Check how `ensureParentRows()` resolves `filing_id` → `filings` and `document_id` → `documents` (grep `ensureParentRows` in `packages/db/test/rls`); if parent resolution is name-based (`<table>_id`), nothing else is needed; otherwise STOP and report. `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`.
3. Test file (same helpers as `ledgers.db.test.ts`: copy `one`, `code`, `asUser`, `beforeAll`/`afterAll` with `ORG = 'dddddddd-0000-4000-8000-000000000043'`, slug `org-filings-0043`, a document row):
```ts
describe.skipIf(DATABASE_URL === undefined)('0043: filings tables', () => {
  // … setup as in ledgers.db.test.ts …
  it('creates the tables with RLS and the expected policies', async () => {
    const rows = await sql<{ t: string; rls: boolean }[]>`select tablename as t, rowsecurity as rls from pg_tables where schemaname = 'public' and tablename in ('filings','filing_documents','filing_entries') order by 1`;
    expect(rows).toEqual([{ t: 'filing_documents', rls: true }, { t: 'filing_entries', rls: true }, { t: 'filings', rls: true }]);
    const entriesPolicies = await sql<{ cmd: string }[]>`select cmd from pg_policies where tablename = 'filing_entries'`;
    expect(entriesPolicies.map((p) => p.cmd).filter((c) => c !== 'SELECT' && c !== 'ALL')).toEqual([]);   // users: select only; worker ALL
  });
  it('owner inserts a filing and its documents; only one open filing per (type, period, kind); superseded frees the slot', async () => {
    const id = await asUser(OWNER, async (tx) => one(await tx<{ id: string }[]>`insert into filings (org_id, type, period_start, period_end) values (${ORG}, 'DPHDP3', '2026-08-01', '2026-08-31') returning id`).id);
    expect(id).toBeTruthy();
    const dup = await sql.begin(async (tx) => {
      await tx`insert into filings (org_id, type, period_start, period_end) values (${ORG}, 'DPHDP3', '2026-08-01', '2026-08-31')`;
      return code(tx`insert into filings (org_id, type, period_start, period_end, state) values (${ORG}, 'DPHDP3', '2026-08-01', '2026-08-31', 'generated')`);
    });
    expect(dup).toBe('23505');
    const two = await sql.begin(async (tx) => {
      await tx`insert into filings (org_id, type, period_start, period_end, state) values (${ORG}, 'DPHDP3', '2026-08-01', '2026-08-31', 'superseded')`;
      await tx`insert into filings (org_id, type, period_start, period_end, state) values (${ORG}, 'DPHDP3', '2026-08-01', '2026-08-31', 'generated')`;
      return one(await tx<{ n: number }[]>`select count(*)::int as n from filings where org_id = ${ORG}`).n;
    });
    expect(two).toBe(2);
    await sql`delete from filings where org_id = ${ORG}`;
  });
  it('rodné číslo never enters inputs', async () => {
    expect(await code(sql`insert into filings (org_id, type, period_start, period_end, inputs) values (${ORG}, 'PODKLADY_DPFO', '2026-01-01', '2026-12-31', '{"rodneCislo":"x"}')`)).toBe('23514');
  });
  it('filing_entries: users read but cannot write; worker inserts', async () => {
    const filingId = one(await sql<{ id: string }[]>`insert into filings (org_id, type, period_start, period_end) values (${ORG}, 'DPHDP3', '2026-09-01', '2026-09-30') returning id`).id;
    await sql`insert into filing_entries (filing_id, org_id, document_id, document_revision, vat_treatment, vat_rate_type, dphdp3_rows, vat_point_date, base_czk, vat_czk) values (${filingId}, ${ORG}, ${docId}, 1, 'rcv_eu_service_reverse_charge', 'standard', '{5}', '2026-09-03', '11549.94', '2425.49')`;
    const seen = await asUser(OWNER, async (tx) => one(await tx<{ n: number }[]>`select count(*)::int as n from filing_entries where filing_id = ${filingId}`).n);
    expect(seen).toBe(1);
    const denied = await asUser(OWNER, (tx) => code(tx`insert into filing_entries (filing_id, org_id, document_id, document_revision, vat_treatment, vat_rate_type, dphdp3_rows, vat_point_date, base_czk, vat_czk) values (${filingId}, ${ORG}, ${docId}, 1, 'rcv_eu_service_reverse_charge', 'standard', '{5}', '2026-09-03', '1.00', '0.21')`));
    expect(denied).toBe('42501');
    await sql`delete from filings where id = ${filingId}`;
  });
  it('another org sees nothing', async () => {
    const OTHER = 'dddddddd-0000-4000-8000-0000000000b2';
    await sql`insert into auth.users (id) values (${OTHER}) on conflict (id) do nothing`;
    await sql`insert into filings (org_id, type, period_start, period_end) values (${ORG}, 'DPHDP3', '2026-10-01', '2026-10-31')`;
    expect(await asUser(OTHER, async (tx) => one(await tx<{ n: number }[]>`select count(*)::int as n from filings`).n)).toBe(0);
    await sql`delete from filings where org_id = ${ORG}`;
    await sql`delete from auth.users where id = ${OTHER}`;
  });
});
```
Command: `pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30` (needs `pnpm db:start`; if Postgres is unavailable here the suite skips: say so in the report and run `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`).
4. Commit `feat(db): migration 0043 filings tables + RLS + factories (0340)`.

## 5. Do not touch

`rls-catalog.ts`, any other migration, `05-data-model.md` (no schema deviation; if one is needed, STOP).

## 6. Commands

`pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30` · `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` · `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Migration applies; RLS meta-test passes with the three new tables (factories registered); filings test green or skipped-without-DB (reported).

## 8. Stop and ask

TEMPLATE §8; factory parent resolution not name-based.

## 9. Report

`docs/tasks/0340-report.md`.

## Risk list

The migration (RLS), factories.

## Owner steps

None (05 already has this DDL; the backlog's "tables exist since Phase 0" note was wrong: the orchestrator notes this in known-issues).
