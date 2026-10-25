import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contractTicket, lintFiles, lintMigration, MIGRATIONS_DIR } from '../migration-lint';

/**
 * Migration lint (M12 §4.3 step 4): destructive statements fail without a `-- contract: <ticket>`
 * header; additive migrations pass. The regression case lints the real migrations.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));

const ADDITIVE = `-- 0042_invoices: adds invoices (05 §3). Forward-only.
create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  renamed_at timestamptz,                     -- a column name containing "rename" is not a rename
  total_cents bigint not null
);
alter table invoices add column note text;   -- additive alter
alter table invoices alter column note set default '';
alter table invoices alter column note set not null;
alter table invoices enable row level security;
create index invoices_org_idx on invoices (org_id);
-- drop table invoices;  (a comment is not a statement)
/* alter table invoices drop column note; also only a comment */
select app.apply_tenant_rls('invoices', 'org_id');
`;

const rules = (source: string) => lintMigration(source, 'x.sql').map((v) => v.rule);

describe('migration-lint: additive migrations pass', () => {
  it('passes create table, add column, set default/not null, index, RLS and comments', () => {
    expect(lintMigration(ADDITIVE, '0042_invoices.sql')).toEqual([]);
  });

  it('does not split on ";" inside dollar-quoted bodies; drop policy is not a rule', () => {
    const fn = `-- helper
create or replace function app.reset_policies(p_table text) returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_table || '_select', p_table);
end $$;
create table t (id int);
`;
    expect(rules(fn)).toEqual([]);
    // A destructive statement inside a body is still destructive: reported once, for the body.
    const dropInBody = `do $$ begin drop table legacy; drop table legacy2; end $$;`;
    expect(rules(dropInBody)).toEqual(['drop-table']);
  });
});

describe('migration-lint: destructive statements fail without a contract header', () => {
  it('drop table', () => {
    expect(rules('create table a (id int);\ndrop table if exists b;')).toEqual(['drop-table']);
  });

  it('drop column', () => {
    expect(rules('alter table a drop column legacy;')).toEqual(['drop-column']);
  });

  it('alter column ... type (with and without "set data")', () => {
    expect(rules('alter table a alter column amount type numeric(18,2);')).toEqual([
      'alter-column-type',
    ]);
    expect(rules('alter table a alter column "amount" set data type bigint;')).toEqual([
      'alter-column-type',
    ]);
  });

  it('rename (table, column, constraint)', () => {
    expect(rules('alter table a rename to b;')).toEqual(['rename']);
    expect(rules('alter table a rename column x to y;')).toEqual(['rename']);
    expect(rules('alter table a rename constraint c1 to c2;')).toEqual(['rename']);
  });

  it('is case-insensitive and tolerant of newlines inside a statement', () => {
    expect(rules('ALTER TABLE a\n  DROP\n  COLUMN legacy;')).toEqual(['drop-column']);
  });

  it('reports the file and the line of the statement', () => {
    const source = '-- header\ncreate table a (id int);\n\nalter table a\n  drop column legacy;\n';
    expect(lintMigration(source, '0099_x.sql')).toEqual([
      {
        file: '0099_x.sql',
        line: 4,
        rule: 'drop-column',
        statement: 'alter table a drop column legacy',
      },
    ]);
  });

  it('reports every destructive statement in the file', () => {
    const source = 'drop table a;\nalter table b rename to c;\nalter table c drop column d;';
    expect(rules(source)).toEqual(['drop-table', 'rename', 'drop-column']);
  });
});

describe('migration-lint: the contract header', () => {
  const CONTRACT = `-- 0050_drop_legacy: contract step of P0-DB-09 (expand was 0048, release n-1).
-- contract: P0-DB-09
alter table a drop column legacy;
drop table legacy_b;
`;

  it('reads the ticket from the header', () => {
    expect(contractTicket(CONTRACT)).toBe('P0-DB-09');
    expect(contractTicket(ADDITIVE)).toBeNull();
    expect(contractTicket('-- Contract:   P1-DB-03\ndrop table a;')).toBe('P1-DB-03');
  });

  it('lets destructive statements through when the header names a ticket', () => {
    expect(lintMigration(CONTRACT, '0050_drop_legacy.sql')).toEqual([]);
  });

  it('only counts the header: a contract line after the first statement does not help', () => {
    const late = 'create table a (id int);\n-- contract: P0-DB-09\ndrop table b;';
    expect(contractTicket(late)).toBeNull();
    expect(rules(late)).toEqual(['drop-table']);
  });

  it('needs a ticket after the colon', () => {
    expect(contractTicket('-- contract:\ndrop table a;')).toBeNull();
    expect(rules('-- contract:\ndrop table a;')).toEqual(['drop-table']);
  });
});

describe('migration-lint: the real migrations', () => {
  it(`every ${MIGRATIONS_DIR}/*.sql passes (lintFiles with no files lints them all)`, () => {
    const files = readdirSync(`${root}${MIGRATIONS_DIR}`).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(lintFiles([], root)).toEqual([]);
  });

  it('lintFiles lints exactly the given files', () => {
    const file = `${MIGRATIONS_DIR}/0001_enums.sql`;
    expect(lintFiles([file], root)).toEqual([]);
  });
});
