import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findViolations,
  listSourceFiles,
  loadTenantIdentifiers,
  run,
} from '../../check-tenant-sql.ts';

/**
 * check:tenant-sql (M12 §4.4 item 6): a Drizzle call on a tenant table outside withTenant() is an
 * error. The pure function is tested on inline fixtures; the CLI on a temp folder and on the repo.
 */
const root = fileURLToPath(new URL('../../..', import.meta.url));
const script = join(root, 'scripts', 'check-tenant-sql.ts');
const tenant = new Set(['organizations', 'memberships', 'taxpayerProfiles']);

const header = `import { memberships, organizations, taxpayerProfiles } from '@shoebox/db';
declare const db: any;
declare function withTenant(orgId: string, fn: (tx: any) => Promise<unknown>): Promise<unknown>;
declare function withServiceRole(reason: string, fn: (tx: any) => Promise<unknown>): Promise<unknown>;
type TenantTx = unknown;
type ServiceTx = unknown;
`;

function violations(body: string) {
  return findViolations('fixture.ts', header + body, tenant).map((v) => `${v.call}(${v.table})`);
}

describe('findViolations', () => {
  it('flags select/insert/update/delete on a tenant table outside withTenant', () => {
    expect(
      violations(`
export const a = db.select().from(organizations);
export const b = db.insert(memberships).values({});
export const c = db.update(taxpayerProfiles).set({});
export const d = db.delete(organizations);
export const e = db.query.memberships.findMany();
`),
    ).toEqual([
      'from(organizations)',
      'insert(memberships)',
      'update(taxpayerProfiles)',
      'delete(organizations)',
      'query(memberships)',
    ]);
  });

  it('passes the same calls inside withTenant, db.withTenant and withServiceRole callbacks', () => {
    expect(
      violations(`
export const a = withTenant('o', async (tx) => tx.select().from(organizations));
export const b = db.withTenant('o', async (tx) => {
  await tx.insert(memberships).values({});
  return tx.query.taxpayerProfiles.findMany();
});
export const c = withServiceRole('export', (tx) => tx.delete(organizations));
`),
    ).toEqual([]);
  });

  it('passes a function that takes a TenantTx or ServiceTx, also when nested', () => {
    expect(
      violations(`
export function listOrgs(tx: TenantTx) {
  return tx.select().from(organizations);
}
export const purge = async (tx: ServiceTx, orgId: string) => {
  const rows = [1].map(() => tx.delete(memberships));
  return rows;
};
export class Repo {
  members(tx: TenantTx) {
    return tx.query.memberships.findMany();
  }
}
`),
    ).toEqual([]);
  });

  it('flags a helper without a TenantTx parameter and a query in a sibling argument', () => {
    expect(
      violations(`
export function listOrgs(tx: unknown) {
  return (tx as any).select().from(organizations);
}
export const fn = db.select().from(memberships);
export const b = withTenant(String(db.select().from(taxpayerProfiles)), async () => undefined);
`),
    ).toEqual(['from(organizations)', 'from(memberships)']);
  });

  it('ignores global tables and identifiers that are not tenant tables', () => {
    expect(
      violations(`
declare const categories: unknown;
declare const list: { from(x: unknown): unknown };
export const a = db.select().from(categories);
export const b = list.from(organizations2);
declare const organizations2: unknown;
`),
    ).toEqual([]);
  });
});

describe('loadTenantIdentifiers', () => {
  it('reads the pgTable exports of packages/db/src/schema, without auth.users', () => {
    const ids = loadTenantIdentifiers();
    expect(ids.get('organizations')).toBe('organizations');
    expect(ids.get('memberships')).toBe('memberships');
    expect(ids.get('taxpayerProfiles')).toBe('taxpayer_profiles');
    expect(ids.has('authUsers')).toBe(false);
  });
});

describe('check:tenant-sql CLI', () => {
  it('passes on the repository', () => {
    const result = run([join(root, 'packages', 'db', 'src')]);
    expect(result.files).toBeGreaterThanOrEqual(5);
    expect(result.violations).toEqual([]);
    const out = execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    expect(out).toMatch(/^check:tenant-sql: \d+ files, no Drizzle call/);
  });

  it('fails with the file, line and table on a fixture outside withTenant; skips tests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tenant-sql-'));
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        "import { organizations } from '@shoebox/db';\nexport const rows = db.select().from(organizations);\n",
      );
      writeFileSync(
        join(dir, 'bad.test.ts'),
        "import { organizations } from '@shoebox/db';\nexport const rows = db.select().from(organizations);\n",
      );
      expect(listSourceFiles([dir])).toEqual([join(dir, 'bad.ts')]);
      let status = 0;
      let stderr = '';
      try {
        execFileSync(process.execPath, [script, dir], {
          cwd: root,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch (error) {
        const e = error as { status?: number; stderr?: string };
        status = e.status ?? -1;
        stderr = e.stderr ?? '';
      }
      expect(status).toBe(1);
      expect(stderr).toContain(
        'bad.ts:2:21  from(organizations) on a tenant table outside withTenant()',
      );
      expect(stderr).toContain('check:tenant-sql: 1 violation(s) in 1 files');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
