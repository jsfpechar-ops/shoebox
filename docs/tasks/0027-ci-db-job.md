# 0027: CI `db` job and migration lint

Status: review (merged in #43)
Ticket: P0-CI-02 | Depends on: none (P0-DB-01, P0-DB-02 and P0-CI-01 are merged on `phase/0`) | Base commit: f90bf08 (`origin/phase/0`) | Branch: task/0027-ci-db-job | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Every PR migrates an ephemeral local Supabase (Postgres 17) from scratch with the Drizzle migrations and runs the DB suite, and a lint refuses destructive migrations (`drop table`, `drop column`, `alter column … type`, `rename`) that lack a `-- contract: <ticket>` header. This protects the tenants' data: a migration that drops or renames something can only ship as the second step of expand → migrate → contract.

## 2. Context

Spec and rules (pasted; do not open `docs/v3/`):

- M12 §4.3 step 3: "`db`: `supabase start` → apply migrations from scratch → `pnpm test:db` (migration smoke, RLS suite, `check:tenant-sql`) → `supabase db diff` must be empty."
- M12 §4.3 step 4: "`migration-lint`: new files in `packages/db/migrations/` are forward-only; statements `drop table|drop column|alter column … type|rename` fail unless the file header has `-- contract: <ticket>` and the previous release already stopped using the object (expand → migrate → contract over two releases)."
- rules.md Database: "Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only."
- Owner decisions 2026-10-18: Postgres 17 (`supabase/config.toml` `[db] major_version = 17`), Supabase CLI 2.119.0 is a root devDependency (`pnpm exec supabase`), migrations are applied by drizzle-kit (`pnpm db:migrate` = `pnpm --filter @shoebox/db migrate` = `drizzle-kit migrate`) from `packages/db/migrations/` with the hand-maintained `meta/_journal.json`; `supabase/migrations/` is not used.

Decisions taken in this brief (the orchestrator confirms them with the owner; you only implement):

- **`supabase db diff` is not used.** The CLI documents it as "Compares a shadow built from supabase/migrations with a live database". `supabase/migrations/` is empty here, so the diff would always print the whole schema. In its place the `db` job (a) runs `pnpm db:migrate` a second time, which must be a no-op, and (b) checks that `drizzle.__drizzle_migrations` holds exactly one row per `_journal.json` entry. A Drizzle-schema drift check is a follow-up ticket, not this brief.
- `check:tenant-sql` is still a stub (`exit 1`, TODO(P0-DB)) and is **not** part of the `db` job yet.
- **The executor sandbox has no Docker**, so `supabase start` cannot run here (0014c report: `failed to connect to the docker API`). You verify only what runs without Docker: the migration-lint unit test, the lint script with Node, a YAML parse of the workflow and, if you can download it, `actionlint`. The `db` job itself is verified by the CI run on your PR; the orchestrator reads that run.
- Node 22.22 runs `.ts` files directly (type stripping, no flag). The lint script has no dependency; CI runs it as `node scripts/migration-lint.ts`.
- The root `unit` Vitest project only includes `scripts/lint/test/**/*.test.ts`. Step 3 adds `scripts/test/**/*.test.ts` so the new test runs in the `unit` CI job (`pnpm test:unit`).

Excerpts (anchors; if one is not found verbatim, STOP):

`vitest.workspace.ts`:
```ts
      include: [
        'apps/*/test/**/*.test.ts',
        'packages/*/test/**/*.test.ts',
        'scripts/lint/test/**/*.test.ts',
      ],
```

`.github/workflows/ci.yml` (last lines of the file, the `depcruise` job):
```yaml
      - name: Import boundaries (dependency-cruiser)
        run: pnpm depcruise
```

`docs/context/test-map.md`:
```md
| `scripts/` (Python guards) | `python3 scripts/test/test_pii_guard.py` and `python3 scripts/pii_guard.py --all apps packages scripts testdata` |
```

Facts you rely on (already true on the base commit): `packages/db/migrations/` holds `0001_enums.sql`, `0002_tenancy.sql`, `0003_app_worker.sql` and `meta/_journal.json` with 3 entries; none of the three contains a destructive statement outside comments (`drop policy if exists` inside function bodies is not in the rule list). `packages/db/drizzle.config.ts` reads `DATABASE_URL` and defaults to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. The `.github/actions/setup` composite action gives Node 22 + pnpm + frozen install.

## 3. Files

| Path | Action | What |
|---|---|---|
| `scripts/migration-lint.ts` | create | forward-only lint: `lintMigration`, `lintFiles`, `contractTicket`, CLI `main` |
| `scripts/test/migration-lint.test.ts` | create | the spec (15 tests), given in full below |
| `vitest.workspace.ts` | edit | `unit` project also includes `scripts/test/**/*.test.ts` |
| `.github/workflows/ci.yml` | edit | append jobs `db` and `migration-lint` |
| `docs/context/test-map.md` | edit | row for `scripts/*.ts` |

No other file may change.

## 4. Steps

Setup (once): `git fetch origin phase/0 && git checkout -b task/0027-ci-db-job origin/phase/0 && git log --oneline -1` (expect `f90bf08`), then `pnpm install --frozen-lockfile 2>&1 | tail -3`.

Rules for every step: write each new file with **one Write call**, contents exactly as given. Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0027 step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `scripts/migration-lint.ts`

Exports: `type Violation`, `const MIGRATIONS_DIR`, `contractTicket(source: string): string | null`, `lintMigration(source: string, file: string): Violation[]`, `lintFiles(files: readonly string[], root: string): Violation[]`. Contents, exactly:

```ts
#!/usr/bin/env node
// Migration lint (M12 §4.3 step 4, rules.md Database): migrations in packages/db/migrations are
// forward-only. A destructive statement (drop table, drop column, alter column ... type, rename)
// fails unless the file's header comment carries `-- contract: <ticket>` (expand → migrate →
// contract over two releases). Runs with plain Node 22 (type stripping), no dependencies.
//
// Usage: node scripts/migration-lint.ts [file.sql ...]   (no files: every packages/db/migrations/*.sql)

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Violation = {
  file: string;
  line: number;
  rule: 'drop-table' | 'drop-column' | 'alter-column-type' | 'rename';
  statement: string;
};

export const MIGRATIONS_DIR = 'packages/db/migrations';

/** `-- contract: P0-DB-07` in the header (the leading run of comment and blank lines). */
const CONTRACT_HEADER = /^--\s*contract:\s*(\S+)/i;

const RULES: ReadonlyArray<readonly [Violation['rule'], RegExp]> = [
  ['drop-table', /\bdrop\s+table\b/i],
  ['drop-column', /\bdrop\s+column\b/i],
  ['alter-column-type', /\balter\s+column\s+(?:"[^"]+"|\w+)\s+(?:set\s+data\s+)?type\b/i],
  ['rename', /\brename\b/i],
];

/** Returns the ticket named by `-- contract: <ticket>` in the header, or null. */
export function contractTicket(source: string): string | null {
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    if (!line.startsWith('--')) {
      return null;
    }
    const match = CONTRACT_HEADER.exec(line);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}

/** Blanks line comments and block comments, keeping line numbers (newlines survive). */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.replace(/--[^\n]*/g, '');
}

/** Splits SQL into statements on `;` outside dollar-quoted bodies; returns [statement, firstLine]. */
function splitStatements(sql: string): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let dollarTag: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === '\n') {
      line += 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[\w]*\$/.exec(sql.slice(i));
      if (tag !== null) {
        if (dollarTag === null) {
          dollarTag = tag[0];
        } else if (dollarTag === tag[0]) {
          dollarTag = null;
        }
        i += tag[0].length - 1;
        continue;
      }
    }
    if (ch === ';' && dollarTag === null) {
      const text = sql.slice(start, i);
      const lead = text.length - text.trimStart().length;
      const leadLines = (text.slice(0, lead).match(/\n/g) ?? []).length;
      out.push([text.trim(), startLine + leadLines]);
      start = i + 1;
      startLine = line;
    }
  }
  const rest = sql.slice(start);
  if (rest.trim() !== '') {
    const lead = rest.length - rest.trimStart().length;
    out.push([rest.trim(), startLine + (rest.slice(0, lead).match(/\n/g) ?? []).length]);
  }
  return out;
}

/** Lints one migration. An empty array means the file passes. */
export function lintMigration(source: string, file: string): Violation[] {
  if (contractTicket(source) !== null) {
    return [];
  }
  const violations: Violation[] = [];
  for (const [statement, line] of splitStatements(stripComments(source))) {
    for (const [rule, pattern] of RULES) {
      if (pattern.test(statement)) {
        violations.push({ file, line, rule, statement: statement.replace(/\s+/g, ' ') });
      }
    }
  }
  return violations;
}

/** Lints the given files (or every migration) and returns the violations. */
export function lintFiles(files: readonly string[], root: string): Violation[] {
  const targets =
    files.length > 0
      ? files
      : readdirSync(join(root, MIGRATIONS_DIR))
          .filter((name) => name.endsWith('.sql'))
          .sort()
          .map((name) => join(MIGRATIONS_DIR, name));
  return targets.flatMap((file) => {
    const abs = resolve(root, file);
    return lintMigration(readFileSync(abs, 'utf8'), relative(root, abs));
  });
}

function main(argv: readonly string[]): number {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const violations = lintFiles(argv, root);
  for (const v of violations) {
    const msg = `${v.rule}: "${v.statement}" needs a "-- contract: <ticket>" header (forward-only, M12 §4.3)`;
    console.log(`::error file=${v.file},line=${v.line}::${msg}`);
  }
  if (violations.length === 0) {
    console.log(`migration-lint: OK (${argv.length > 0 ? argv.length : 'all'} file(s))`);
    return 0;
  }
  console.log(`migration-lint: ${violations.length} violation(s)`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
```

Command: `node scripts/migration-lint.ts 2>&1 | tail -3` → `migration-lint: OK (all file(s))`. Commit.

### Step 2: create `scripts/test/migration-lint.test.ts`

The tests are the spec: implement until they pass; do not edit this file. Contents, exactly:

```ts
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
```

Command: `pnpm exec vitest run --project unit scripts/test/migration-lint.test.ts 2>&1 | tail -6` → `Test Files  1 passed (1)` and `Tests  15 passed (15)` (a Vite warning about `configLoader: 'native'` above it is normal). Commit.

### Step 3: edit `vitest.workspace.ts`

Anchor (see §2). Replace with:

```ts
      include: [
        'apps/*/test/**/*.test.ts',
        'packages/*/test/**/*.test.ts',
        'scripts/lint/test/**/*.test.ts',
        'scripts/test/**/*.test.ts',
      ],
```

Command: `pnpm exec vitest list --project unit 2>&1 | grep -c 'migration-lint'` → `15`. Commit.

### Step 4: edit `.github/workflows/ci.yml`

Anchor: the two last lines of the file (see §2). Keep them and append the two jobs below after them, so the file ends with:

```yaml
      - name: Import boundaries (dependency-cruiser)
        run: pnpm depcruise

  db:
    needs: setup
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    env:
      # Local Supabase defaults (supabase/config.toml [db] port 54322); same URL as drizzle.config.ts.
      DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - name: Start local Supabase (Postgres 17 and auth only; API, Studio and mail containers are not needed)
        run: >
          pnpm exec supabase start
          -x realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
      - name: Migrate from scratch (drizzle-kit, packages/db/migrations)
        run: pnpm db:migrate
      - name: Migrate again (forward-only ledger, must be a no-op)
        run: pnpm db:migrate
      - name: DB suite (migration smoke, RLS, withTenant)
        run: pnpm test:db
      - name: Every journal entry is applied exactly once
        run: |
          expected=$(python3 -c 'import json; print(len(json.load(open("packages/db/migrations/meta/_journal.json"))["entries"]))')
          applied=$(psql "$DATABASE_URL" -tAc 'select count(*) from drizzle.__drizzle_migrations')
          echo "journal entries: $expected, applied: $applied"
          test "$applied" = "$expected"
      - name: Stop local Supabase
        if: always()
        run: pnpm exec supabase stop --no-backup

  migration-lint:
    needs: setup
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 0
      - uses: ./.github/actions/setup
      - name: Migration journal is consistent (drizzle-kit check)
        run: pnpm --filter @shoebox/db exec drizzle-kit check
      - name: Forward-only lint on the migrations added or changed by this PR or push
        env:
          EVENT: ${{ github.event_name }}
          PR_BASE: ${{ github.event.pull_request.base.sha }}
          PR_HEAD: ${{ github.event.pull_request.head.sha }}
          PUSH_BEFORE: ${{ github.event.before }}
          SHA: ${{ github.sha }}
        run: |
          if [ "$EVENT" = pull_request ]; then
            range="$PR_BASE...$PR_HEAD"
          elif [ -n "$PUSH_BEFORE" ] && git cat-file -e "${PUSH_BEFORE}^{commit}" 2>/dev/null; then
            range="$PUSH_BEFORE..$SHA"
          elif git cat-file -e "${SHA}~1^{commit}" 2>/dev/null; then
            range="${SHA}~1..$SHA"
          else
            echo 'first commit, nothing to compare'; exit 0
          fi
          files=$(git diff --name-only --diff-filter=AMR "$range" -- 'packages/db/migrations/*.sql')
          if [ -z "$files" ]; then
            echo 'no migration added or changed'; exit 0
          fi
          echo "$files"
          # shellcheck disable=SC2086
          node scripts/migration-lint.ts $files
```

Commands:
- `python3 -c 'import yaml; d=yaml.safe_load(open(".github/workflows/ci.yml")); print(sorted(d["jobs"]))'` → `['context-lint', 'db', 'depcruise', 'lint', 'migration-lint', 'pii', 'secrets', 'setup', 'typecheck', 'unit']`.
- `pnpm --filter @shoebox/db exec drizzle-kit check 2>&1 | tail -1` → `Everything's fine 🐶🔥`.
- Optional, only if the download works in one try (otherwise skip and say so in the report): `mkdir -p /tmp/al && curl -sSfL -o /tmp/al/al.tgz https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_linux_amd64.tar.gz && tar -xzf /tmp/al/al.tgz -C /tmp/al actionlint && /tmp/al/actionlint .github/workflows/ci.yml 2>&1 | tail -5; echo "exit=$?"` → no output and `exit=0`.

Commit.

### Step 5: edit `docs/context/test-map.md`

Anchor: the `scripts/` (Python guards) row (see §2). Insert this row directly after it:

```md
| `scripts/*.ts`, `scripts/test/*.test.ts` (TypeScript guards, e.g. migration-lint) | `pnpm exec vitest run --project unit scripts/test/<file>` and `pnpm exec biome ci scripts` |
```

Command: `python3 scripts/context_lint.py 2>&1 | tail -3` → `context lint: OK` (WARN lines about commits since the last status update are fine). Commit.

## 5. Do not touch

`packages/db/**` (migrations, journal, schema, tests), `supabase/**`, `package.json`, `pnpm-lock.yaml`, `.github/actions/**`, the existing jobs in `ci.yml`, `scripts/lint/**`, `scripts/*.py`, `docs/v3/**`. Hard rules: 7 (no new dependency: the lint runs on plain Node, `actionlint` is only a local check and is never added to the repo), 8 (never push to `main`; PR base is `phase/0`), 4 (no document content or personal data anywhere; the test fixtures are synthetic SQL). Do not try `supabase start`, `docker` or `pnpm test:db` locally: the sandbox has no Docker; the `db` job is proven by CI on your PR.

## 6. Commands

```bash
pnpm exec vitest run --project unit scripts/test/migration-lint.test.ts 2>&1 | tail -6   # Tests 15 passed (15)
pnpm exec vitest list --project unit 2>&1 | grep -c 'migration-lint'                      # 15
node scripts/migration-lint.ts 2>&1 | tail -3                                             # migration-lint: OK (all file(s))
pnpm exec biome ci scripts/migration-lint.ts scripts/test/migration-lint.test.ts vitest.workspace.ts 2>&1 | tail -3   # Checked 3 files ... No fixes applied.
pnpm --filter @shoebox/db exec drizzle-kit check 2>&1 | tail -1                           # Everything's fine
python3 -c 'import yaml; d=yaml.safe_load(open(".github/workflows/ci.yml")); print(sorted(d["jobs"]))' 2>&1 | tail -1
python3 scripts/context_lint.py 2>&1 | tail -3                                            # context lint: OK
```

A negative check for the report (write the fixture outside the repo, do not commit it): write `/tmp/0099_bad.sql` with the three lines `-- 0099_bad: fixture`, `create table a (id int);`, `alter table a drop column x;`, then `node scripts/migration-lint.ts /tmp/0099_bad.sql 2>&1 | tail -3; echo "exit=$?"` → one `::error file=...,line=3::drop-column: ...` line, `migration-lint: 1 violation(s)`, `exit=1`.

## 7. Acceptance

- [ ] `scripts/test/migration-lint.test.ts`: 15 tests pass through the root `unit` project; `vitest list --project unit` counts them (they run in the CI `unit` job).
- [ ] `node scripts/migration-lint.ts` passes on the three current migrations and exits 1 with a `::error file=…,line=…::` annotation on the `/tmp/0099_bad.sql` fixture.
- [ ] `ci.yml` parses, lists jobs `db` and `migration-lint`, and `drizzle-kit check` passes locally.
- [ ] Biome clean on the three TypeScript files; `context lint: OK`.
- [ ] On the PR (checked by the orchestrator, not you): job `db` green (`supabase start` on Postgres 17, `pnpm db:migrate` twice, `pnpm test:db` with 21 tests in 2 files, journal 3 = applied 3); job `migration-lint` green (`no migration added or changed`); job `unit` green with the 15 new tests.

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

Write `docs/tasks/0027-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command of §6 and the negative check, with the last 5 lines of its output; whether `actionlint` ran.
3. §7 ticked (leave the PR item for the orchestrator).
4. Deviations.
5. Questions.
6. Owner steps left: none (the orchestrator opens the PR against `phase/0` and reads the `db` run).

## Risk list (for the reviewer)

- `.github/workflows/ci.yml`, jobs `db` and `migration-lint`: the `-x` exclude list (keeps `gotrue` so `auth.users` exists for the `memberships` FK), the `DATABASE_URL`, the `psql` ledger check, the diff range logic (copied from the `pii` job).
- `scripts/migration-lint.ts`: the four regexes and the header rule; a contract header disables the whole file, by spec.
- `vitest.workspace.ts`: the new include only adds `scripts/test/**/*.test.ts` to `unit`; the Python files there are not matched.

## Owner steps

None for this brief. The orchestrator opens the PR against `phase/0`, confirms the `db`, `migration-lint` and `unit` jobs are green, and takes the open questions (`supabase db diff` replaced; Drizzle-schema drift check as a follow-up ticket) to you with the review.
