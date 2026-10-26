import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENUMS } from '@shoebox/domain';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/migrate';

// Runs in the `db` vitest project (root vitest.workspace.ts) against DATABASE_URL: local Supabase
// (`pnpm db:start`) or a plain Postgres 16 prepared by packages/db/scripts/local-pg.sh.
// Skipped without DATABASE_URL so `pnpm test:unit` and a bare `vitest run` stay green.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const OWNER_A = '11111111-0000-4000-8000-000000000001';
const MEMBER_A = '22222222-0000-4000-8000-000000000002';
const VIEWER_A = '33333333-0000-4000-8000-000000000003';
const OWNER_B = '44444444-0000-4000-8000-000000000004';
const TENANT_TABLES = ['organizations', 'memberships', 'taxpayer_profiles'] as const;

const ROLLBACK = Symbol('rollback');

/** Number of migrations in meta/_journal.json: every slice adds one, this test need not change. */
const JOURNAL_ENTRIES = (
  JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: unknown[];
  }
).entries.length;

describe.skipIf(DATABASE_URL === undefined)('0001 + 0003: enums, tenancy tables and RLS', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  /** Runs fn as `authenticated` with the given JWT subject (null = anonymous) and rolls back. */
  async function as<T>(uid: string | null, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await sql.begin(async (tx) => {
        if (uid !== null) {
          await tx`select set_config('request.jwt.claim.sub', ${uid}, true)`;
        }
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

  /** SQLSTATE of the error fn raises as that user, or null when it succeeds. */
  async function errorCodeAs(
    uid: string | null,
    fn: (tx: TransactionSql) => Promise<unknown>,
  ): Promise<string | null> {
    try {
      await as(uid, fn);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? 'unknown';
    }
  }

  function insertProfile(
    tx: TransactionSql,
    orgId: string,
    validFrom: string,
    validTo: string | null,
  ): Promise<unknown> {
    return tx`insert into taxpayer_profiles
      (org_id, valid_from, valid_to, vat_status, tax_regime, legal_name, ico, address)
      values (${orgId}, ${validFrom}, ${validTo}, 'neplatce', 'pausalni_vydaje', 'Test s.r.o.', '00000000', '{}')`;
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    // From scratch: drop every public table, schema app, schema analytics and the enums (extensions and auth stay).
    const dropTypes = Object.keys(ENUMS)
      .map((name) => `drop type if exists public.${name} cascade;`)
      .join('\n');
    await sql.unsafe(`
      drop schema if exists drizzle cascade;
      do $$
      declare t text;
      begin
        for t in select tablename from pg_tables where schemaname = 'public' loop
          execute format('drop table if exists public.%I cascade', t);
        end loop;
      end $$;
      drop schema if exists app cascade;
      drop schema if exists analytics cascade;
      ${dropTypes}
    `);
    await runMigrations(url);
    await runMigrations(url); // idempotent
    await sql`insert into auth.users (id) values (${OWNER_A}), (${MEMBER_A}), (${VIEWER_A}), (${OWNER_B})
      on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG_A}, 'Org A', 'org-a', 'AAAAAAAA'), (${ORG_B}, 'Org B', 'org-b', 'BBBBBBBB')`;
    await sql`insert into memberships (org_id, user_id, role) values
      (${ORG_A}, ${OWNER_A}, 'owner'), (${ORG_A}, ${MEMBER_A}, 'member'),
      (${ORG_A}, ${VIEWER_A}, 'viewer'), (${ORG_B}, ${OWNER_B}, 'owner')`;
    await sql.begin((tx) => insertProfile(tx, ORG_A, '2026-01-01', null));
    await sql.begin((tx) => insertProfile(tx, ORG_B, '2026-01-01', null));
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('migrates from scratch and records every journal migration once', async () => {
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(JOURNAL_ENTRIES).toBeGreaterThanOrEqual(4);
    expect(rows[0]?.n).toBe(JOURNAL_ENTRIES);
    const tables =
      await sql`select tablename from pg_tables where schemaname = 'public' order by 1`;
    expect(tables.map((r) => r.tablename)).toEqual(
      expect.arrayContaining(['memberships', 'organizations', 'taxpayer_profiles']),
    );
  });

  it('Postgres enum values equal @shoebox/domain ENUMS', async () => {
    const rows = await sql<{ name: string; labels: string[] }[]>`
      select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
      where n.nspname = 'public'
      group by t.typname`;
    const db = Object.fromEntries(rows.map((r) => [r.name, r.labels]));
    expect(Object.keys(db).sort()).toEqual(Object.keys(ENUMS).sort());
    for (const [name, values] of Object.entries(ENUMS)) {
      expect(db[name], name).toEqual([...values]);
    }
  });

  it('rejects overlapping taxpayer_profiles segments of one org (exclusion constraint)', async () => {
    const overlap = await sql
      .begin((tx) => insertProfile(tx, ORG_A, '2026-06-01', '2026-12-31'))
      .then(
        () => null,
        (e: { code?: string }) => e.code ?? 'unknown',
      );
    expect(overlap).toBe('23P01');
    // A segment that ends before the open-ended one starts is fine; rolled back.
    const before = await sql
      .begin(async (tx) => {
        await insertProfile(tx, ORG_A, '2025-01-01', '2025-12-31');
        throw ROLLBACK;
      })
      .then(
        () => null,
        (e: unknown) => (e === ROLLBACK ? null : (e as { code?: string }).code),
      );
    expect(before).toBeNull();
  });

  it.each(TENANT_TABLES)(
    '%s has RLS enabled with _select, _write and _worker policies',
    async (table) => {
      const rel = await sql`select relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${table}`;
      expect(rel[0]?.relrowsecurity).toBe(true);
      const policies = await sql`select policyname, cmd from pg_policies
      where schemaname = 'public' and tablename = ${table} order by policyname`;
      expect(policies.map((p) => [p.policyname, p.cmd])).toEqual([
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
        [`${table}_write`, 'ALL'],
      ]);
    },
  );

  it('an anonymous session sees no rows', async () => {
    for (const table of TENANT_TABLES) {
      const rows = await as(null, (tx) => tx`select count(*)::int as n from ${tx(table)}`);
      expect(rows[0]?.n, table).toBe(0);
    }
  });

  it('members of org A see only org A rows; org B owner sees only org B', async () => {
    for (const uid of [OWNER_A, MEMBER_A, VIEWER_A]) {
      const orgs = await as(uid, (tx) => tx`select id from organizations order by id`);
      expect(
        orgs.map((o) => o.id),
        uid,
      ).toEqual([ORG_A]);
      const members = await as(uid, (tx) => tx`select distinct org_id from memberships`);
      expect(
        members.map((m) => m.org_id),
        uid,
      ).toEqual([ORG_A]);
      const profiles = await as(uid, (tx) => tx`select distinct org_id from taxpayer_profiles`);
      expect(
        profiles.map((p) => p.org_id),
        uid,
      ).toEqual([ORG_A]);
    }
    const orgsB = await as(OWNER_B, (tx) => tx`select id from organizations`);
    expect(orgsB.map((o) => o.id)).toEqual([ORG_B]);
    const profilesB = await as(OWNER_B, (tx) => tx`select org_id from taxpayer_profiles`);
    expect(profilesB.map((p) => p.org_id)).toEqual([ORG_B]);
  });

  it('only the owner writes organizations, memberships and taxpayer_profiles (05 §10.2)', async () => {
    // owner: update own org (trigger touches updated_at), insert profile and membership in own org
    const updated = await as(OWNER_A, async (tx) => {
      const rows = await tx`update organizations set name = 'Org A renamed' where id = ${ORG_A}
        returning updated_at > created_at as touched`;
      return rows;
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.touched).toBe(true);
    expect(
      await errorCodeAs(OWNER_A, (tx) => insertProfile(tx, ORG_A, '2020-01-01', '2020-12-31')),
    ).toBeNull();
    expect(
      await errorCodeAs(
        OWNER_A,
        (tx) =>
          tx`insert into memberships (org_id, user_id, role) values (${ORG_A}, ${OWNER_B}, 'viewer')`,
      ),
    ).toBeNull();

    // member and viewer: updates touch 0 rows, inserts fail with insufficient_privilege (42501)
    for (const uid of [MEMBER_A, VIEWER_A]) {
      const rows = await as(
        uid,
        (tx) => tx`update organizations set name = 'x' where id = ${ORG_A} returning id`,
      );
      expect(rows, uid).toHaveLength(0);
      const touched = await as(
        uid,
        (tx) => tx`update taxpayer_profiles set dic = 'CZ1' where org_id = ${ORG_A} returning id`,
      );
      expect(touched, uid).toHaveLength(0);
      expect(
        await errorCodeAs(uid, (tx) => insertProfile(tx, ORG_A, '2020-01-01', '2020-12-31')),
        uid,
      ).toBe('42501');
      expect(
        await errorCodeAs(
          uid,
          (tx) =>
            tx`insert into memberships (org_id, user_id, role) values (${ORG_A}, ${OWNER_B}, 'viewer')`,
        ),
        uid,
      ).toBe('42501');
      const deleted = await as(
        uid,
        (tx) => tx`delete from memberships where org_id = ${ORG_A} returning user_id`,
      );
      expect(deleted, uid).toHaveLength(0);
    }

    // an owner of A cannot write into B
    expect(
      await errorCodeAs(OWNER_A, (tx) => insertProfile(tx, ORG_B, '2020-01-01', '2020-12-31')),
    ).toBe('42501');
    const crossUpdate = await as(
      OWNER_A,
      (tx) => tx`update organizations set name = 'x' where id = ${ORG_B} returning id`,
    );
    expect(crossUpdate).toHaveLength(0);
  });
});
