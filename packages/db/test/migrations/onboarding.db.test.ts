import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0015_onboarding: public.create_firm(p jsonb). Runs against DATABASE_URL (local Supabase or the
// plain Postgres from packages/db/scripts/local-pg.sh). Skipped without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;

const USER_1 = '0f0f0f0f-0000-4000-8000-000000000001';
const USER_2 = '0f0f0f0f-0000-4000-8000-000000000002';
const USER_3 = '0f0f0f0f-0000-4000-8000-000000000003';

const ROLLBACK = Symbol('rollback');

function firm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Test OSVČ',
    ico: '27082440',
    dic: 'CZ27082440',
    vat_status: 'neplatce',
    tax_regime: 'pausalni_vydaje',
    pausal_rate: 60,
    valid_from: '2026-01-01',
    address: {
      street: 'Jankovcova',
      house_number: '1522',
      orientation_number: '53',
      city: 'Praha',
      zip: '17000',
      country: 'CZ',
    },
    slug_base: 'test-osvc',
    ...overrides,
  };
}

describe.skipIf(DATABASE_URL === undefined)('0015 onboarding: public.create_firm()', () => {
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

  /** Error code and message fn raises as that user, or nulls when it succeeds. */
  async function errorAs(
    uid: string | null,
    fn: (tx: TransactionSql) => Promise<unknown>,
  ): Promise<{ code: string | null; message: string | null }> {
    try {
      await as(uid, fn);
      return { code: null, message: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { code: err.code ?? 'unknown', message: err.message ?? null };
    }
  }

  function createFirm(
    tx: TransactionSql,
    input: Record<string, unknown>,
  ): Promise<Array<{ r: Record<string, unknown> }>> {
    return tx<
      Array<{ r: Record<string, unknown> }>
    >`select public.create_firm(${tx.json(input as never)}) as r`;
  }

  beforeAll(async () => {
    // Migrations only: the tables of the other db tests are kept (no drop here).
    await runMigrations(url);
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await sql`insert into auth.users (id) values (${USER_1}), (${USER_2}), (${USER_3})
      on conflict (id) do nothing`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('creates the firm: org, owner membership, profile and audit row in one transaction', async () => {
    const result = await as(USER_1, async (tx) => {
      const [row] = await createFirm(tx, firm());
      const r = (
        row as { r: { org_id: string; inbound_email_slug: string; inbound_email_secret: string } }
      ).r;
      const orgs = await tx`select id from organizations`;
      const members = await tx`select role from memberships where user_id = ${USER_1}`;
      const profiles =
        await tx`select pausal_rate, entity_type from taxpayer_profiles where org_id = ${r.org_id}`;
      const audit = await tx`select action from audit_log where org_id = ${r.org_id}`;
      return { r, orgs, members, profiles, audit };
    });

    expect(result.r.org_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.r.inbound_email_slug).toBe('test-osvc');
    expect(result.r.inbound_email_secret).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(result.orgs).toHaveLength(1);
    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.role).toBe('owner');
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.pausal_rate).toBe(60);
    expect(result.profiles[0]?.entity_type).toBe('osvc');
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0]?.action).toBe('create_firm');
  });

  it('refuses a second firm for the same user with already_has_firm', async () => {
    let message: string | null = null;
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claim.sub', ${USER_2}, true)`;
        await tx`set local role authenticated`;
        await createFirm(tx, firm({ slug_base: 'first-firm' }));
        try {
          await createFirm(tx, firm({ slug_base: 'second-firm' }));
        } catch (e) {
          message = (e as { message?: string }).message ?? null;
        }
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) {
        throw e;
      }
    }
    expect(message).toBe('already_has_firm');
  });

  it('fails for an anonymous caller with code 42501', async () => {
    const err = await errorAs(null, (tx) => createFirm(tx, firm()));
    expect(err.code).toBe('42501');
    expect(err.message).toBe('not_authenticated');
  });

  it('rejects a payer without vat_period with invalid_profile', async () => {
    const err = await errorAs(USER_3, (tx) =>
      createFirm(
        tx,
        firm({ vat_status: 'platce', tax_regime: 'danova_evidence', pausal_rate: undefined }),
      ),
    );
    expect(err.message).toBe('invalid_profile');
  });

  it('rejects pausalni_dan for a VAT payer with invalid_profile', async () => {
    const err = await errorAs(USER_3, (tx) =>
      createFirm(
        tx,
        firm({
          tax_regime: 'pausalni_dan',
          pausal_dan_band: 1,
          pausal_rate: undefined,
          vat_status: 'platce',
          vat_period: 'monthly',
        }),
      ),
    );
    expect(err.message).toBe('invalid_profile');
  });

  it('rejects an ICO that is not 8 digits with invalid_profile', async () => {
    const err = await errorAs(USER_3, (tx) => createFirm(tx, firm({ ico: '1234' })));
    expect(err.message).toBe('invalid_profile');
  });

  it('stores vat_period monthly for an identified person', async () => {
    const period = await as(USER_3, async (tx) => {
      const [row] = await createFirm(
        tx,
        firm({ vat_status: 'identifikovana_osoba', vat_period: undefined }),
      );
      const r = (row as { r: { org_id: string } }).r;
      const [profile] =
        await tx`select vat_period from taxpayer_profiles where org_id = ${r.org_id}`;
      return profile?.vat_period;
    });
    expect(period).toBe('monthly');
  });

  it('gives the second firm with the same slug base a suffixed slug', async () => {
    const slugs: string[] = [];
    try {
      await sql.begin(async (tx) => {
        await tx`set local role authenticated`;
        for (const uid of [USER_1, USER_2]) {
          await tx`select set_config('request.jwt.claim.sub', ${uid}, true)`;
          const [row] = await createFirm(tx, firm());
          slugs.push((row as { r: { inbound_email_slug: string } }).r.inbound_email_slug);
        }
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) {
        throw e;
      }
    }
    expect(slugs[0]).toBe('test-osvc');
    expect(slugs[1]).toMatch(/^test-osvc-[0-9a-z]{4}$/);
  });

  it('falls back to slug firma when slug_base is invalid', async () => {
    const slug = await as(USER_1, async (tx) => {
      const [row] = await createFirm(tx, firm({ slug_base: 'Bad Slug!' }));
      return (row as { r: { inbound_email_slug: string } }).r.inbound_email_slug;
    });
    expect(slug).toMatch(/^firma(-[0-9a-z]{4})?$/);
  });

  it('does not let the user insert into organizations directly (42501)', async () => {
    const err = await errorAs(
      USER_3,
      (tx) =>
        tx`insert into organizations (name, ico, inbound_email_slug, inbound_email_secret)
         values ('Direct', '27082440', 'direct-slug', 'ABCDEFGH')`,
    );
    expect(err.code).toBe('42501');
  });
});
