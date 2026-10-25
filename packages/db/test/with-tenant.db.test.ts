import { count, sql as dsql, eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';
import { memberships, organizations, taxpayerProfiles } from '../src/schema/tenancy';
import {
  closeDb,
  configureDb,
  createTenantDb,
  type Db,
  SERVICE_ROLE_REASONS,
  type ServiceRoleReason,
  type TenantDb,
  withServiceRole,
  withTenant,
} from '../src/tenant';

// Runs in the `db` vitest project against DATABASE_URL (service role `postgres`). The worker
// connection is WORKER_DATABASE_URL or, when unset, DATABASE_URL with the user replaced by
// `app_worker` (works on the trust-auth cluster of scripts/local-pg.sh). Skipped without
// DATABASE_URL. Never drops the schema: it only migrates forward and cleans its own rows.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG_C = 'cccccccc-0000-4000-8000-000000000003';
const ORG_D = 'dddddddd-0000-4000-8000-000000000004';
const USER_C = '55555555-0000-4000-8000-000000000005';
const USER_D = '66666666-0000-4000-8000-000000000006';
const ROLLBACK = Symbol('rollback');

/** SQLSTATE of a postgres.js error, also when Drizzle wrapped it in DrizzleQueryError. */
function pgCode(e: unknown): string {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code ?? 'unknown';
}

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

describe.skipIf(DATABASE_URL === undefined)('0003: app_worker, withTenant, withServiceRole', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let workerUrl = '';
  let sql: Sql;
  let db: TenantDb;

  async function countAll(tx: Pick<Db, 'select'>) {
    const [o] = await tx.select({ n: count() }).from(organizations);
    const [m] = await tx.select({ n: count() }).from(memberships);
    const [p] = await tx.select({ n: count() }).from(taxpayerProfiles);
    return { organizations: o?.n ?? -1, memberships: m?.n ?? -1, taxpayerProfiles: p?.n ?? -1 };
  }

  beforeAll(async () => {
    workerUrl = process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl);
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`drop table if exists public.rls_probe`;
    await sql`insert into auth.users (id) values (${USER_C}), (${USER_D}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG_C}, 'Org C', 'org-c', 'CCCCCCCC'), (${ORG_D}, 'Org D', 'org-d', 'DDDDDDDD')
      on conflict (id) do nothing`;
    await sql`insert into memberships (org_id, user_id, role)
      values (${ORG_C}, ${USER_C}, 'owner'), (${ORG_D}, ${USER_D}, 'owner')
      on conflict (org_id, user_id) do nothing`;
    await sql`insert into taxpayer_profiles
      (org_id, valid_from, vat_status, tax_regime, legal_name, ico, address)
      values (${ORG_C}, '2026-01-01', 'neplatce', 'pausalni_vydaje', 'C s.r.o.', '00000001', '{}'),
             (${ORG_D}, '2026-01-01', 'neplatce', 'pausalni_vydaje', 'D s.r.o.', '00000002', '{}')`;
    db = createTenantDb({ workerUrl, serviceUrl }, { max: 1 });
  });

  afterAll(async () => {
    await db?.close();
    await closeDb();
    await sql`delete from organizations where id in (${ORG_C}, ${ORG_D})`;
    await sql`delete from auth.users where id in (${USER_C}, ${USER_D})`;
    await sql?.end();
  });

  it('creates role app_worker with login, noinherit and no BYPASSRLS', async () => {
    const rows = await sql`select rolcanlogin, rolinherit, rolbypassrls, rolsuper
      from pg_roles where rolname = 'app_worker'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rolcanlogin: true,
      rolinherit: false,
      rolbypassrls: false,
      rolsuper: false,
    });
  });

  it.each(['organizations', 'memberships', 'taxpayer_profiles'])(
    '%s has a _worker policy for all commands restricted to app_worker',
    async (table) => {
      const rows = await sql`select cmd, roles, qual, with_check from pg_policies
        where schemaname = 'public' and tablename = ${table} and policyname = ${`${table}_worker`}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.cmd).toBe('ALL');
      expect(rows[0]?.roles).toEqual(['app_worker']);
      expect(rows[0]?.qual).toContain('app.current_org_id()');
      expect(rows[0]?.with_check).toContain('app.current_org_id()');
    },
  );

  it('app.apply_tenant_rls creates _select, _write and _worker on a new tenant table', async () => {
    try {
      await sql`create table public.rls_probe (id uuid primary key default gen_random_uuid(), org_id uuid not null)`;
      await sql`select app.apply_tenant_rls('rls_probe')`;
      const policies = await sql`select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = 'rls_probe' order by policyname`;
      expect(policies.map((p) => [p.policyname, p.cmd])).toEqual([
        ['rls_probe_select', 'SELECT'],
        ['rls_probe_worker', 'ALL'],
        ['rls_probe_write', 'ALL'],
      ]);
    } finally {
      await sql`drop table if exists public.rls_probe`;
    }
  });

  it('as app_worker without app.org_id every tenant table is empty', async () => {
    const [who] = await db.worker.execute<{ u: string; org: string | null }>(
      dsql`select current_user as u, app.current_org_id()::text as org`,
    );
    expect(who?.u).toBe('app_worker');
    expect(who?.org).toBeNull();
    expect(await countAll(db.worker)).toEqual({
      organizations: 0,
      memberships: 0,
      taxpayerProfiles: 0,
    });
  });

  it('withTenant(C) sees only org C and cannot write into org D', async () => {
    const seen = await db.withTenant(ORG_C, async (tx) => {
      const orgs = await tx.select({ id: organizations.id }).from(organizations);
      const profiles = await tx
        .select({ orgId: taxpayerProfiles.orgId })
        .from(taxpayerProfiles)
        .where(eq(taxpayerProfiles.orgId, ORG_D));
      const members = await tx.select({ orgId: memberships.orgId }).from(memberships);
      return { orgs: orgs.map((o) => o.id), crossProfiles: profiles.length, members };
    });
    expect(seen.orgs).toEqual([ORG_C]);
    expect(seen.crossProfiles).toBe(0);
    expect(seen.members.every((m) => m.orgId === ORG_C)).toBe(true);

    const code = await db
      .withTenant(ORG_C, (tx) =>
        tx.update(organizations).set({ name: 'hacked' }).where(eq(organizations.id, ORG_D)),
      )
      .then((r) => (r.count === 0 ? 'no-rows' : 'updated'), pgCode);
    expect(code).toBe('no-rows');

    const insertCode = await db
      .withTenant(ORG_C, (tx) =>
        tx.insert(taxpayerProfiles).values({
          orgId: ORG_D,
          validFrom: '2020-01-01',
          validTo: '2020-12-31',
          vatStatus: 'neplatce',
          taxRegime: 'pausalni_vydaje',
          legalName: 'X',
          ico: '00000003',
          address: {},
        }),
      )
      .then(() => null, pgCode);
    expect(insertCode).toBe('42501');
  });

  it('a throw inside withTenant rolls the transaction back and is rethrown', async () => {
    await expect(
      db.withTenant(ORG_C, async (tx) => {
        await tx.update(organizations).set({ name: 'rolled back' });
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    const rows = await sql`select name from organizations where id = ${ORG_C}`;
    expect(rows[0]?.name).toBe('Org C');
  });

  it('app.org_id does not leak after commit; the next withTenant sees its own org', async () => {
    await db.withTenant(ORG_C, async (tx) => {
      await tx.update(organizations).set({ name: 'Org C' }).where(eq(organizations.id, ORG_C));
    });
    // Same pooled connection (max: 1), outside any transaction.
    const [after] = await db.worker.execute<{ org: string | null }>(
      dsql`select app.current_org_id()::text as org`,
    );
    expect(after?.org).toBeNull();
    expect(await countAll(db.worker)).toEqual({
      organizations: 0,
      memberships: 0,
      taxpayerProfiles: 0,
    });
    const orgsD = await db.withTenant(ORG_D, (tx) =>
      tx.select({ id: organizations.id }).from(organizations),
    );
    expect(orgsD.map((o) => o.id)).toEqual([ORG_D]);
  });

  it('withTenant rejects a non-UUID orgId before touching the database', () => {
    expect(() => db.withTenant('org-c', async () => undefined)).toThrow(TypeError);
    expect(() => db.withTenant('', async () => undefined)).toThrow(TypeError);
  });

  it('withServiceRole sees every org and accepts only the four reasons', async () => {
    expect(SERVICE_ROLE_REASONS).toEqual(['retention', 'export', 'admin', 'migration']);
    const ids = await db.withServiceRole('export', async (tx) => {
      const rows = await tx.select({ id: organizations.id }).from(organizations);
      return rows.map((r) => r.id);
    });
    expect(ids).toEqual(expect.arrayContaining([ORG_C, ORG_D]));
    expect(() => db.withServiceRole('cron' as ServiceRoleReason, async () => undefined)).toThrow(
      TypeError,
    );
  });

  it('module-level withTenant / withServiceRole need configureDb first, then delegate', async () => {
    expect(() => withTenant(ORG_C, async () => undefined)).toThrow(/configureDb/);
    expect(() => withServiceRole('admin', async () => undefined)).toThrow(/configureDb/);
    configureDb({ workerUrl, serviceUrl }, { max: 1 });
    const orgs = await withTenant(ORG_C, (tx) =>
      tx.select({ id: organizations.id }).from(organizations),
    );
    expect(orgs.map((o) => o.id)).toEqual([ORG_C]);
    const [n] = await withServiceRole('admin', (tx) =>
      tx.select({ n: count() }).from(organizations),
    );
    expect(n?.n).toBeGreaterThanOrEqual(2);
    await closeDb();
    expect(() => withTenant(ORG_C, async () => undefined)).toThrow(/configureDb/);
  });
});
