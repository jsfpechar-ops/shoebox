import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  cleanupTenants,
  DATABASE_URL,
  errorCodeAs,
  ORG_A,
  ORG_B,
  ROLES,
  seedTenants,
  serviceSql,
  USERS,
} from './helpers';

// M12 §4.4 RLS test suite item 5 (0008_storage, ADR-004): on bucket org-files a user of org A sees
// only objects named org/{A}/... (so the storage API cannot sign a URL for B's object for them),
// inserts only under own prefix and only as owner or member, and cannot update or delete B's
// objects. Needs storage.objects (Supabase, or the local shim); on a bare Postgres the file skips.
const BUCKET = 'org-files';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_NEW = 'c'.repeat(64);
const OBJ_A = `org/${ORG_A}/files/${SHA_A}`;
const OBJ_B = `org/${ORG_B}/files/${SHA_B}`;
const POLICIES = ['org_files_delete', 'org_files_insert', 'org_files_select', 'org_files_update'];

async function hasStorageObjects(url: string | undefined): Promise<boolean> {
  if (url === undefined) {
    return false;
  }
  const sql = serviceSql(url);
  try {
    const [row] = await sql<{ present: boolean }[]>`
      select to_regclass('storage.objects') is not null as present`;
    return row?.present ?? false;
  } finally {
    await sql.end();
  }
}

const STORAGE = await hasStorageObjects(DATABASE_URL);

describe.skipIf(!STORAGE)('RLS storage: bucket org-files, prefix org/{org_id}/', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  async function visibleNames(uid: string | null): Promise<string[]> {
    return asUser(sql, uid, async (tx) => {
      const rows = await tx<{ name: string }[]>`select name from storage.objects
        where bucket_id = ${BUCKET} and name in (${OBJ_A}, ${OBJ_B}) order by name`;
      return rows.map((r) => r.name);
    });
  }

  function insertCode(uid: string, name: string): Promise<string | null> {
    return errorCodeAs(
      sql,
      uid,
      (tx) => tx`insert into storage.objects (bucket_id, name) values (${BUCKET}, ${name})`,
    );
  }

  /** Supabase blocks SQL deletes on storage tables unless the transaction opts in (storage 0055). */
  async function clearObjects(): Promise<void> {
    await sql.begin(async (tx) => {
      await tx`select set_config('storage.allow_delete_query', 'true', true)`;
      await tx`delete from storage.objects where bucket_id = ${BUCKET}
        and (name like ${`org/${ORG_A}/%`} or name like ${`org/${ORG_B}/%`})`;
    });
  }

  beforeAll(async () => {
    sql = serviceSql(url);
    await seedTenants(sql, url);
    await clearObjects();
    await sql`insert into storage.objects (bucket_id, name) values (${BUCKET}, ${OBJ_A}), (${BUCKET}, ${OBJ_B})`;
  });

  afterAll(async () => {
    await clearObjects();
    await cleanupTenants(sql);
    await sql.end();
  });

  it('bucket org-files exists and is private; the four policies and the name parser are there', async () => {
    const [bucket] = await sql<
      { public: boolean }[]
    >`select public from storage.buckets where id = ${BUCKET}`;
    expect(bucket?.public).toBe(false);
    const policies = await sql<{ policyname: string }[]>`select policyname from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname like 'org_files_%' order by 1`;
    expect(policies.map((p) => p.policyname)).toEqual(POLICIES);
    const [parsed] = await sql<{ a: string | null; b: string | null; c: string | null }[]>`
      select app.storage_org_id(${OBJ_A}) as a, app.storage_org_id(${`files/${SHA_A}`}) as b,
        app.storage_org_id(${`org/not-a-uuid/files/${SHA_A}`}) as c`;
    expect(parsed).toEqual({ a: ORG_A, b: null, c: null });
  });

  it('every role of A sees only org/A/ objects; B sees only its own; anonymous sees nothing', async () => {
    for (const role of ROLES) {
      expect(await visibleNames(USERS.A[role]), role).toEqual([OBJ_A]);
    }
    expect(await visibleNames(USERS.B.owner)).toEqual([OBJ_B]);
    expect(await visibleNames(null)).toEqual([]);
  });

  it('owner and member of A upload under org/A/; accountant and viewer get 42501', async () => {
    const name = `org/${ORG_A}/files/${SHA_NEW}`;
    expect(await insertCode(USERS.A.owner, name)).toBeNull();
    expect(await insertCode(USERS.A.member, name)).toBeNull();
    expect(await insertCode(USERS.A.accountant, name)).toBe('42501');
    expect(await insertCode(USERS.A.viewer, name)).toBe('42501');
  });

  it('nobody of A uploads under org/B/, outside org/, or under a malformed org segment', async () => {
    const outside = [
      `org/${ORG_B}/files/${SHA_NEW}`,
      `files/${SHA_NEW}`,
      `org/not-a-uuid/files/${SHA_NEW}`,
      `org/${ORG_A.toUpperCase()}/files/${SHA_NEW}`,
    ];
    for (const role of ROLES) {
      for (const name of outside) {
        expect(await insertCode(USERS.A[role], name), `${role} ${name}`).toBe('42501');
      }
    }
  });

  it("A cannot update or delete B's object; member of A deletes own, viewer of A cannot", async () => {
    const touched = await asUser(sql, USERS.A.owner, async (tx) => {
      await tx`select set_config('storage.allow_delete_query', 'true', true)`;
      const updated = await tx`update storage.objects set metadata = '{}'::jsonb
        where bucket_id = ${BUCKET} and name = ${OBJ_B}`;
      const deleted =
        await tx`delete from storage.objects where bucket_id = ${BUCKET} and name = ${OBJ_B}`;
      return [updated.count, deleted.count];
    });
    expect(touched).toEqual([0, 0]);
    const viewerDeleted = await asUser(sql, USERS.A.viewer, async (tx) => {
      await tx`select set_config('storage.allow_delete_query', 'true', true)`;
      return (await tx`delete from storage.objects where bucket_id = ${BUCKET} and name = ${OBJ_A}`)
        .count;
    });
    expect(viewerDeleted).toBe(0);
    const memberDeleted = await asUser(sql, USERS.A.member, async (tx) => {
      await tx`select set_config('storage.allow_delete_query', 'true', true)`;
      return (await tx`delete from storage.objects where bucket_id = ${BUCKET} and name = ${OBJ_A}`)
        .count;
    });
    expect(memberDeleted).toBe(1);
  });
});
