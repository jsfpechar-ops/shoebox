# 0025b: isolation and role cases, `check:tenant-sql`

Status: review
Ticket: P0-DB-03 (part b of a/b) | Depends on: 0025a (same branch) | Base commit: head of task/0025-rls-suite after 0025a | Branch: task/0025-rls-suite | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`isolation.db.test.ts` runs the generated org A × org B cases of M12 §4.4 item 2 for every tenant table of the catalog and every role (select of B's rows → none, insert for B → `42501`, update/delete of B's rows → 0); `roles.db.test.ts` runs item 3 (viewer writes nothing, accountant only `ACCOUNTANT_WRITABLE`, member not the owner-only tables, owner everything a user may write). `scripts/check-tenant-sql.ts` is item 6: `pnpm check:tenant-sql` fails when a Drizzle call on a tenant table is outside a `withTenant`/`withServiceRole` callback or a `TenantTx`/`ServiceTx` function, and `pnpm lint` runs it, so CI catches a worker query that would bypass tenant scoping.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 3: "Every query is org-scoped." Hard rule 7: no new dependency. Hard rule 8: never push to `main`.
- M12 §4.4 item 2 (verbatim): "**Generated isolation cases:** fixture factory creates org A and org B with one row in every tenant table (from `packages/testkit` factories; a missing factory fails the test). For each table × role in {owner, member, accountant, viewer} of org A, executed as `authenticated` with `request.jwt.claims` set: `select` of B's rows returns 0; `insert` with `org_id = B` raises; `update`/`delete` of B's rows affect 0 rows."
- M12 §4.4 item 3: "**Role cases:** viewer cannot write anything; accountant can write only `comments`, `review_questions.answer/answered_by/answered_at` (column-level check via trigger or `with check`), `accountant_packages`; member cannot write `memberships`, `taxpayer_profiles`, `organizations`."
- M12 §4.4 item 6: "**Static:** `check:tenant-sql` scans Drizzle query builders in `apps/worker` and `packages/*` (ts-morph) for calls on tenant tables outside a `withTenant` callback → error." M12 §9 AC-3: "Generated isolation cases pass for every tenant table and every role."
- Backlog acceptance: "`pnpm check:tenant-sql` (ts-morph) flags a Drizzle call on a tenant table outside `withTenant` in a fixture file."
- decisions 2026-10-18 [tooling]: "T-17 resolved: Biome 2.5 GritQL plugins cover all custom lint rules …; ts-morph not used." and [deps]: "ts-morph (T-17 fallback only)". So the static check uses the **TypeScript compiler API** (`typescript` is a root devDependency) on Node 22 with its built-in type stripping (`node scripts/check-tenant-sql.ts`, no flag, no warning on Node 22.18+; the repo pins `>=22 <23`). No ts-morph, no new dependency. Scope rule, a brief-writer decision: a call is scoped when it sits in an argument of `withTenant(...)`/`*.withTenant(...)`/`withServiceRole(...)`, or inside any function that has a parameter typed `TenantTx` or `ServiceTx` (repository helpers). Matched calls: `.from(T)`, `.insert(T)`, `.update(T)`, `.delete(T)`, `.into(T)` and `.query.T` where `T` is a `pgTable` export of `packages/db/src/schema/*.ts` that is not a global table. `test/` folders and `*.test.ts` are skipped (the db tests query as the worker on purpose).
- Role cases encode 05 §10.2 through the catalog of 0025a (`OWNER_ONLY_TABLES`, `ACCOUNTANT_WRITABLE`, `READ_ONLY_FOR_USERS`, `NO_USER_INSERT`, `OWNER_ONLY_SELECT_TABLES`), so every later migration slice is covered without editing these test files; the column-level accountant rules of `review_questions` and `accountant_packages` are tested by the slice that adds them (P0-DB-06), as the backlog says.
- `pnpm lint` is the CI `lint` job (`.github/workflows/ci.yml`, `run: pnpm lint`); adding `pnpm check:tenant-sql` to it makes the check run in CI now (the `db` job of P0-CI-02 does not exist yet).

Anchors, root `package.json` (step 5), two lines:

```json
    "lint": "biome ci . && pnpm check:i18n",
```

```json
    "check:tenant-sql": "echo 'TODO(P0-DB): check:tenant-sql' && exit 1",
```

All code below was run by the brief writer on `origin/task/0022-db-with-tenant` (c6a5745) + 0025a against Postgres 16 (plain cluster + shim): `tsc` clean, `biome ci` clean, 71 db-package tests pass with `DATABASE_URL` (28 pass + 43 skip without), the unit test of the script passes (8), `pnpm lint` ends with `check:tenant-sql: 57 files, no Drizzle call on a tenant table outside withTenant()`, `context_lint` OK.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/test/rls/isolation.db.test.ts` | create | item 2 (5 tests) |
| `packages/db/test/rls/roles.db.test.ts` | create | item 3 (5 tests) |
| `scripts/check-tenant-sql.ts` | create | item 6, TypeScript compiler API |
| `scripts/lint/test/tenant-sql.test.ts` | create | unit test of the script (8 tests, `unit` project) |
| `package.json` (root) | edit | `check:tenant-sql` script; `lint` runs it |

No other file may change.

## 4. Steps

Setup (once): `git checkout task/0025-rls-suite && git log --oneline -1` (expect the last 0025a commit) and `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test`.

Rules for every step: write each new file with **one Write call**, contents exactly as given (already Biome-formatted). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0025b step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `packages/db/test/rls/isolation.db.test.ts`

Full file; do not edit it:

```ts
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ONLY_SELECT_TABLES } from '../../src/rls-catalog';
import {
  asUser,
  buildRow,
  cleanupTenants,
  DATABASE_URL,
  deleteCount,
  errorCodeAs,
  insertRow,
  ORG_A,
  ORG_B,
  ROLES,
  seedTenants,
  serviceSql,
  type Tenants,
  USERS,
  updateCount,
  visibleOrgs,
} from './helpers';

// M12 §4.4 RLS test suite item 2 (generated isolation cases) and §9 AC-3. For every tenant table
// of the catalog × every role of org A, run as `authenticated` with the JWT claims set: B's rows
// are invisible, an insert for org B raises 42501, update and delete of B's rows touch 0 rows.
// The fixture comes from the testkit factories; a table without a factory fails in beforeAll.

describe.skipIf(DATABASE_URL === undefined)(
  'RLS isolation: org A × org B for every tenant table and role',
  () => {
    const url = DATABASE_URL ?? '';
    let sql: Sql;
    let tenants: Tenants;

    beforeAll(async () => {
      sql = serviceSql(url);
      tenants = await seedTenants(sql, url);
    });

    afterAll(async () => {
      if (sql !== undefined) {
        await cleanupTenants(sql);
        await sql.end();
      }
    });

    it('the fixture has one factory row per org in every tenant table', async () => {
      expect(tenants.tables.length).toBeGreaterThanOrEqual(3);
      for (const table of tenants.tables) {
        expect(await visibleOrgs(sql, table), table).toEqual(
          expect.arrayContaining([ORG_A, ORG_B]),
        );
      }
    });

    it('an anonymous session sees no row of any tenant table', async () => {
      for (const table of tenants.tables) {
        expect(await asUser(sql, null, (tx) => visibleOrgs(tx, table)), table).toEqual([]);
      }
    });

    it('every role of org A sees only A rows (or none, where only the owner may select)', async () => {
      for (const table of tenants.tables) {
        for (const role of ROLES) {
          const seen = await asUser(sql, USERS.A[role], (tx) => visibleOrgs(tx, table));
          const ownerOnly = role !== 'owner' && OWNER_ONLY_SELECT_TABLES.includes(table);
          const expected = ownerOnly ? [] : [ORG_A];
          expect(seen, `${table} as ${role} of A`).toEqual(expected);
        }
        expect(await asUser(sql, USERS.B.owner, (tx) => visibleOrgs(tx, table)), table).toEqual([
          ORG_B,
        ]);
      }
    });

    it('every role of org A gets 42501 on an insert for org B', async () => {
      for (const table of tenants.tables) {
        for (const role of ROLES) {
          const row = await buildRow(sql, table, tenants.ctx.B);
          if (table === 'organizations') {
            row.id = '0000000b-0000-4000-8000-0000000000fe';
            row.inbound_email_slug = 'org-probe-iso';
          }
          const code = await errorCodeAs(sql, USERS.A[role], (tx) => insertRow(tx, table, row));
          expect(code, `${table}: insert for B as ${role} of A`).toBe('42501');
        }
      }
    });

    it('every role of org A updates and deletes 0 rows of org B', async () => {
      for (const table of tenants.tables) {
        for (const role of ROLES) {
          const counts = await asUser(sql, USERS.A[role], async (tx) => ({
            updated: await updateCount(tx, table, ORG_B),
            deleted: await deleteCount(tx, table, ORG_B),
          }));
          expect(counts, `${table} as ${role} of A`).toEqual({ updated: 0, deleted: 0 });
        }
      }
    });
  },
);
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  7 passed (7)` and `Tests  66 passed (66)`. Commit.

### Step 2: create `packages/db/test/rls/roles.db.test.ts`

Full file; do not edit it:

```ts
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTANT_WRITABLE,
  NO_USER_INSERT,
  OWNER_ONLY_TABLES,
  READ_ONLY_FOR_USERS,
} from '../../src/rls-catalog';
import {
  asUser,
  buildRow,
  cleanupTenants,
  DATABASE_URL,
  deleteCount,
  errorCodeAs,
  insertRow,
  ORG_A,
  type Role,
  seedTenants,
  serviceSql,
  type Tenants,
  USERS,
  updateCount,
} from './helpers';

// M12 §4.4 RLS test suite item 3 (role cases) for every tenant table of the catalog, inside org A:
// a viewer writes nothing; an accountant writes only the ACCOUNTANT_WRITABLE tables (their
// column rules are tested by the slice that adds them); a member writes everything except the
// OWNER_ONLY_TABLES; nobody but the worker writes READ_ONLY_FOR_USERS tables; the owner writes
// every table a user may write. 42501 = insufficient_privilege (RLS with check).

/** What the role matrix (M12 §4.4, 05 §10.2) says this role may do with this table. */
function mayWrite(table: string, role: Role): boolean {
  if (READ_ONLY_FOR_USERS.includes(table)) {
    return false;
  }
  switch (role) {
    case 'owner':
      return true;
    case 'member':
      return !OWNER_ONLY_TABLES.includes(table);
    case 'accountant':
      return ACCOUNTANT_WRITABLE.includes(table);
    case 'viewer':
      return false;
  }
}

describe.skipIf(DATABASE_URL === undefined)(
  'RLS role cases: owner, member, accountant, viewer of org A',
  () => {
    const url = DATABASE_URL ?? '';
    let sql: Sql;
    let tenants: Tenants;

    beforeAll(async () => {
      sql = serviceSql(url);
      tenants = await seedTenants(sql, url);
    });

    afterAll(async () => {
      if (sql !== undefined) {
        await cleanupTenants(sql);
        await sql.end();
      }
    });

    it('mayWrite follows 05 §10.2 for the tenancy tables', () => {
      expect(mayWrite('organizations', 'owner')).toBe(true);
      expect(mayWrite('memberships', 'member')).toBe(false);
      expect(mayWrite('taxpayer_profiles', 'accountant')).toBe(false);
      expect(mayWrite('taxpayer_profiles', 'viewer')).toBe(false);
      expect(mayWrite('comments', 'accountant')).toBe(true);
      expect(mayWrite('ingest_items', 'owner')).toBe(false);
    });

    it('a viewer cannot insert, update or delete in any tenant table', async () => {
      for (const table of tenants.tables) {
        const row = await buildRow(sql, table, tenants.ctx.A);
        expect(
          await errorCodeAs(sql, USERS.A.viewer, (tx) => insertRow(tx, table, row)),
          `${table}: insert as viewer`,
        ).toBe('42501');
        const counts = await asUser(sql, USERS.A.viewer, async (tx) => ({
          updated: await updateCount(tx, table, ORG_A),
          deleted: await deleteCount(tx, table, ORG_A),
        }));
        expect(counts, `${table} as viewer`).toEqual({ updated: 0, deleted: 0 });
      }
    });

    it('an accountant writes only the ACCOUNTANT_WRITABLE tables', async () => {
      for (const table of tenants.tables.filter((t) => !ACCOUNTANT_WRITABLE.includes(t))) {
        const row = await buildRow(sql, table, tenants.ctx.A);
        expect(
          await errorCodeAs(sql, USERS.A.accountant, (tx) => insertRow(tx, table, row)),
          `${table}: insert as accountant`,
        ).toBe('42501');
        const counts = await asUser(sql, USERS.A.accountant, async (tx) => ({
          updated: await updateCount(tx, table, ORG_A),
          deleted: await deleteCount(tx, table, ORG_A),
        }));
        expect(counts, `${table} as accountant`).toEqual({ updated: 0, deleted: 0 });
      }
    });

    it('a member cannot write organizations, memberships or taxpayer_profiles (05 §10.2)', async () => {
      for (const table of ['organizations', 'memberships', 'taxpayer_profiles']) {
        expect(tenants.tables, table).toContain(table);
        const row = await buildRow(sql, table, tenants.ctx.A);
        if (table === 'organizations') {
          row.id = '0000000a-0000-4000-8000-0000000000fd';
          row.inbound_email_slug = 'org-probe-member';
        }
        expect(
          await errorCodeAs(sql, USERS.A.member, (tx) => insertRow(tx, table, row)),
          `${table}: insert as member`,
        ).toBe('42501');
        const counts = await asUser(sql, USERS.A.member, async (tx) => ({
          updated: await updateCount(tx, table, ORG_A),
          deleted: await deleteCount(tx, table, ORG_A),
        }));
        expect(counts, `${table} as member`).toEqual({ updated: 0, deleted: 0 });
      }
    });

    it('owner and member insert, update and delete exactly where the role matrix allows', async () => {
      for (const table of tenants.tables) {
        for (const role of ['owner', 'member'] as const) {
          const allowed = mayWrite(table, role);
          const row = await buildRow(sql, table, tenants.ctx.A);
          if (!NO_USER_INSERT.includes(table)) {
            const code = await errorCodeAs(sql, USERS.A[role], (tx) => insertRow(tx, table, row));
            expect(code, `${table}: insert as ${role}`).toBe(allowed ? null : '42501');
          }
          const counts = await asUser(sql, USERS.A[role], async (tx) => ({
            updated: await updateCount(tx, table, ORG_A),
            deleted: await deleteCount(tx, table, ORG_A),
          }));
          if (allowed) {
            expect(counts.updated, `${table}: update as ${role}`).toBeGreaterThanOrEqual(1);
            expect(counts.deleted, `${table}: delete as ${role}`).toBeGreaterThanOrEqual(1);
          } else {
            expect(counts, `${table} as ${role}`).toEqual({ updated: 0, deleted: 0 });
          }
        }
      }
    });
  },
);
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  8 passed (8)` and `Tests  71 passed (71)`. Then `pnpm exec biome ci packages/db 2>&1 | tail -3` → no errors. Commit.

### Step 3: create `scripts/check-tenant-sql.ts`

```ts
// check:tenant-sql (M12 §4.4 RLS test suite item 6): a Drizzle query on a tenant table that is not
// inside a withTenant()/withServiceRole() callback, or inside a function that takes a TenantTx or
// ServiceTx, is an error. Runs on Node 22 (type stripping) with the TypeScript compiler API that is
// already a root devDependency; no ts-morph (decisions 2026-10-18 [tooling] T-17).
//
//   node scripts/check-tenant-sql.ts            # scans apps/*/src and packages/*/src
//   node scripts/check-tenant-sql.ts <path...>  # scans these files or directories instead
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { GLOBAL_TABLES } from '../packages/db/src/rls-catalog.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SCHEMA_DIR = join(ROOT, 'packages', 'db', 'src', 'schema');

/** Query-builder methods whose first argument is a table (Drizzle pg-core). */
const TABLE_METHODS = new Set(['from', 'insert', 'update', 'delete', 'into']);
const SCOPED_CALL = /(^|\.)with(Tenant|ServiceRole)$/;
const SCOPED_PARAM = /\b(TenantTx|ServiceTx)\b/;
const SKIP_DIRS = new Set(['node_modules', 'test', 'dist', '.next', 'coverage']);

export interface Violation {
  file: string;
  line: number;
  column: number;
  /** Drizzle identifier of the table (export name in packages/db/src/schema). */
  table: string;
  /** `from`, `insert`, `update`, `delete`, `into` or `query`. */
  call: string;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Export names of the tenant tables: `export const <name> = pgTable('<table>', …)` in the schema
 * files, minus the global tables of the RLS catalog. Map: identifier → SQL table name.
 */
export function loadTenantIdentifiers(schemaDir: string = SCHEMA_DIR): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of readdirSync(schemaDir)
    .filter((f) => f.endsWith('.ts'))
    .sort()) {
    const source = parse(entry, readFileSync(join(schemaDir, entry), 'utf8'));
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(source) === 'pgTable'
      ) {
        const first = node.initializer.arguments[0];
        if (first !== undefined && ts.isStringLiteral(first) && !(first.text in GLOBAL_TABLES)) {
          found.set(node.name.text, first.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/** True when `node` sits in a withTenant/withServiceRole argument or in a TenantTx/ServiceTx function. */
function isScoped(node: ts.Node, source: ts.SourceFile): boolean {
  let child: ts.Node = node;
  for (let parent = node.parent; parent !== undefined; child = parent, parent = parent.parent) {
    if (
      ts.isCallExpression(parent) &&
      parent.arguments.includes(child as ts.Expression) &&
      SCOPED_CALL.test(parent.expression.getText(source))
    ) {
      return true;
    }
    if (
      ts.isFunctionLike(parent) &&
      parent.parameters.some(
        (p) => p.type !== undefined && SCOPED_PARAM.test(p.type.getText(source)),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** The Drizzle calls on tenant tables in `text` that are not scoped. */
export function findViolations(
  fileName: string,
  text: string,
  tenantIdentifiers: ReadonlySet<string>,
): Violation[] {
  const source = parse(fileName, text);
  const violations: Violation[] = [];
  const report = (node: ts.Node, table: string, call: string) => {
    if (isScoped(node, source)) {
      return;
    }
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push({ file: fileName, line: line + 1, column: character + 1, table, call });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const first = node.arguments[0];
      if (
        TABLE_METHODS.has(method) &&
        first !== undefined &&
        ts.isIdentifier(first) &&
        tenantIdentifiers.has(first.text)
      ) {
        report(node, first.text, method);
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      tenantIdentifiers.has(node.name.text) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'query'
    ) {
      report(node, node.name.text, 'query');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

/** `*.ts`/`*.tsx` files under `paths` (directories are walked; test folders and test files skipped). */
export function listSourceFiles(paths: string[]): string[] {
  const files: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const entry of readdirSync(p, { withFileTypes: true })) {
        if (entry.isDirectory() ? !SKIP_DIRS.has(entry.name) : true) {
          walk(join(p, entry.name));
        }
      }
      return;
    }
    if (/\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p) && !p.endsWith('.d.ts')) {
      files.push(p);
    }
  };
  for (const p of paths) {
    walk(p);
  }
  return files.sort();
}

/** The default scan: every app and package source tree that exists. */
export function defaultPaths(root: string = ROOT): string[] {
  const paths: string[] = [];
  for (const group of ['apps', 'packages']) {
    const dir = join(root, group);
    for (const name of readdirSync(dir).sort()) {
      const src = join(dir, name, 'src');
      try {
        if (statSync(src).isDirectory()) {
          paths.push(src);
        }
      } catch {
        // no src folder
      }
    }
  }
  return paths;
}

export function run(paths: string[], tenantIdentifiers = new Set(loadTenantIdentifiers().keys())) {
  const files = listSourceFiles(paths);
  const violations = files.flatMap((file) =>
    findViolations(relative(ROOT, file), readFileSync(file, 'utf8'), tenantIdentifiers),
  );
  return { files: files.length, violations };
}

function main(argv: string[]): number {
  const paths = argv.length > 0 ? argv.map((p) => resolve(p)) : defaultPaths();
  const { files, violations } = run(paths);
  for (const v of violations) {
    console.error(
      `${v.file}:${v.line}:${v.column}  ${v.call}(${v.table}) on a tenant table outside withTenant()`,
    );
  }
  if (violations.length > 0) {
    console.error(
      `check:tenant-sql: ${violations.length} violation(s) in ${files} files. Run tenant queries inside withTenant(orgId, fn) or in a function that takes a TenantTx (M12 §4.4).`,
    );
    return 1;
  }
  console.log(
    `check:tenant-sql: ${files} files, no Drizzle call on a tenant table outside withTenant()`,
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exit(main(process.argv.slice(2)));
}
```

Command: `node scripts/check-tenant-sql.ts 2>&1 | tail -3` → one line `check:tenant-sql: N files, no Drizzle call on a tenant table outside withTenant()` (N about 57), exit 0. Then `pnpm exec biome ci scripts 2>&1 | tail -3` → no errors. Commit.

### Step 4: create `scripts/lint/test/tenant-sql.test.ts`

Full file; do not edit it:

```ts
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
```

Command: `pnpm exec vitest run --project unit scripts/lint/test/tenant-sql.test.ts 2>&1 | tail -6` → `Tests  8 passed (8)` (a Vite warning about `vitest.workspace` above it is fine). Then `pnpm exec biome ci scripts 2>&1 | tail -3` → no errors. Commit.

### Step 5: edit root `package.json` (two replacements, anchors in §2)

(a) `"lint": "biome ci . && pnpm check:i18n",` → `"lint": "biome ci . && pnpm check:i18n && pnpm check:tenant-sql",`

(b) `"check:tenant-sql": "echo 'TODO(P0-DB): check:tenant-sql' && exit 1",` → `"check:tenant-sql": "node scripts/check-tenant-sql.ts",`

Command: `pnpm lint 2>&1 | tail -3` → ends with the `check:tenant-sql: N files, no Drizzle call …` line, exit 0 (this runs `biome ci .` on the whole repo, about 10 s). Commit. Then `bash packages/db/scripts/local-pg.sh stop 2>&1 | tail -1` → `stopped`, write the report (§9), and open one PR for 0025a + 0025b.

## 5. Do not touch

`packages/db/src/**`, `packages/db/test/rls/helpers.ts`, `packages/db/test/rls/meta.db.test.ts`, `packages/db/test/rls/worker.db.test.ts` (0025a, done), `packages/db/migrations/**`, `packages/db/scripts/**`, `packages/testkit/**`, `tools/biome-plugins/**`, `biome.json`, `vitest.workspace.ts`, `.github/**`, `docs/v3/**`, `docs/tasks/0023*`, `docs/tasks/0024*`. Hard rules: 3, 7 (no ts-morph, no new dependency), 8 (never push to `main`). Never write a connection string with a password.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1                                                        # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -30    # Tests 71 passed (8 files)
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm exec vitest run --project db 2>&1 | tail -30  # Tests 43 passed (6 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                                                   # without DATABASE_URL: 28 passed, 43 skipped
pnpm exec vitest run --project unit scripts/lint/test/tenant-sql.test.ts 2>&1 | tail -30                         # 8 passed
pnpm check:tenant-sql 2>&1 | tail -30                                                                            # check:tenant-sql: N files, no Drizzle call …  (exit 0)
pnpm lint 2>&1 | tail -30                                                                                        # biome ci, check:i18n, check:tenant-sql all green
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                                              # exit 0
pnpm exec biome ci packages/db scripts package.json 2>&1 | tail -30                                              # No fixes applied
bash packages/db/scripts/local-pg.sh stop 2>&1 | tail -1                                                         # stopped
```

Test-map row for `packages/db`: `pnpm --filter @shoebox/db test -- migrations rls` (needs `pnpm db:start`); `DATABASE_URL` from `local-pg.sh` replaces `db:start` because Docker is unavailable. The script's test lives in the `unit` project (`scripts/lint/test/**`, like `custom-rules.test.ts`).

## 7. Acceptance

- [ ] `isolation.db.test.ts`: 5 passed, `roles.db.test.ts`: 5 passed with `DATABASE_URL`; whole db package 71 passed; 28 passed / 43 skipped without.
- [ ] A fixture outside `withTenant` fails: `printf "import { organizations } from '@shoebox/db';\nexport const r = db.select().from(organizations);\n" > /tmp/tsql/bad.ts` (after `mkdir -p /tmp/tsql`) then `node scripts/check-tenant-sql.ts /tmp/tsql; echo exit=$?` → `bad.ts:2:… from(organizations) on a tenant table outside withTenant()` and `exit=1`; `rm -r /tmp/tsql`.
- [ ] `pnpm check:tenant-sql` exit 0 on the repo; `pnpm lint` exit 0 and its last line is the `check:tenant-sql:` summary.
- [ ] `grep -c 'ts-morph' package.json scripts/check-tenant-sql.ts` → `0` in both (no new dependency).
- [ ] PR `task/0025-rls-suite` → `phase/0` with both reports linked (title `0025: RLS test suite and check:tenant-sql (P0-DB-03)`).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0025b-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`roles.db.test.ts` `mayWrite()` (the role matrix in code: a wrong `true` there would pass a policy that is too permissive), the "owner and member … exactly where the role matrix allows" case (positive and negative in one loop), `scripts/check-tenant-sql.ts` `isScoped()` (a `TenantTx`-typed parameter counts as scoped: that is the convention for repository helpers; a helper typed `tx: unknown` or `Db` is flagged), and that `pnpm lint` now includes the check (CI `lint` job).

## Owner steps

1. None to run. Two things to confirm in the review: (a) `pnpm lint` (the CI lint job) now also runs `check:tenant-sql`; (b) the static check uses the TypeScript compiler API instead of ts-morph, as decisions T-17 says; the backlog line "(ts-morph)" is then outdated and the orchestrator edits it.
