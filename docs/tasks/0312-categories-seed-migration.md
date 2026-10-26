# 0312: migration 0040, seed the 56 categories from the domain taxonomy

Status: done
Ticket: P1-LEDG-01 / P1-LEDG-02 (ledger tables prerequisite) | Depends on: 0301 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

The global `categories` table (migration 0004, 05 §5) is empty. The ledger tables (brief 0313) reference `categories(code)` with `not null`, and the RLS suite's fixture rows need an existing code. This migration inserts the 56 categories of 04 §3.1 exactly as `CATEGORIES` in `packages/domain/src/taxonomy/categories.ts` (brief 0301) defines them, and a DB test proves the two lists are identical.

## 2. Context

Hard rule 5: names are canonical in 04; the domain list (0301) is the TypeScript mirror of 04 §3.1 and the DB seed must equal it. Hard rule 6 (owner 2026-10-25): English only; `label_cs` and `explanation_cs` are `not null` in 0004, so they get the English label and an empty string, marked `-- TODO(i18n-cs)`. Changing their nullability would be a schema change (05 edit) that nobody asked for.

DDL of `categories` (0004, pasted): `code text primary key, direction direction not null, tax_effect tax_effect not null, label_cs text not null, label_en text not null, explanation_cs text not null, icon text, sort integer not null, replaced_by text references categories(code), valid_from date not null default '2000-01-01', valid_to date`. `direction` is the two-valued enum `in | out`; the domain has `direction: 'in' | 'out' | 'both'` for `pt_*`, `transfer_*` and `private_withdrawal`. Seed rule (spec gap, see notes): `both` → `'in'` (every such category appears first on the expense side of a bank statement; the cascade of 0303 skips the direction check for statements).

Migration mechanics: `packages/db/migrations/NNNN_name.sql` plus one entry in `packages/db/migrations/meta/_journal.json` (drizzle's migrator reads the journal; the last entry today is `idx 8, when 1760745600008, tag 0015_onboarding`). Forward-only (`scripts/migration-lint.ts`: no drop/rename). Lane C owns migration numbers 0040–0049. `on conflict (code) do nothing` makes the seed re-runnable and lets a future yearly update add rows without editing this file.

DB tests: `packages/db/test/migrations/*.db.test.ts` run against `DATABASE_URL` (`pnpm db:start` first), `describe.skipIf(DATABASE_URL === undefined)`, `runMigrations(url)` migrates forward. `@shoebox/domain` is already a dependency of `@shoebox/db`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0040_categories_seed.sql` | create | 56 inserts |
| `packages/db/migrations/meta/_journal.json` | edit | one entry |
| `packages/db/test/migrations/categories-seed.db.test.ts` | create | verbatim below |

## 4. Steps

1. Create `packages/db/test/migrations/categories-seed.db.test.ts` with exactly:

```ts
import { CATEGORIES } from '@shoebox/domain';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0040_categories_seed: the global categories table holds exactly the 56 categories of 04 §3.1 as
// packages/domain/src/taxonomy/categories.ts defines them (brief 0301). Migrates forward only.
const DATABASE_URL = process.env.DATABASE_URL;

interface CategoryRow {
  code: string;
  direction: string;
  tax_effect: string;
  label_cs: string;
  label_en: string;
  explanation_cs: string;
  icon: string | null;
  sort: number;
  replaced_by: string | null;
  valid_from: string;
  valid_to: string | null;
}

describe.skipIf(DATABASE_URL === undefined)('0040: categories seed', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let rows: CategoryRow[];

  beforeAll(async () => {
    await runMigrations(url);
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    rows = await sql<CategoryRow[]>`select code, direction, tax_effect, label_cs, label_en,
      explanation_cs, icon, sort, replaced_by, valid_from::text, valid_to::text
      from categories order by sort`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('holds the 56 domain categories, same codes in the same order', () => {
    expect(rows.map((r) => r.code)).toEqual(CATEGORIES.map((c) => c.code));
  });

  it('tax_effect, label_en, icon, sort and validity equal the domain list; direction maps both → in', () => {
    for (const c of CATEGORIES) {
      const row = rows.find((r) => r.code === c.code);
      expect(row, c.code).toBeDefined();
      if (row === undefined) {
        continue;
      }
      expect(row.tax_effect, c.code).toBe(c.taxEffect);
      expect(row.label_en, c.code).toBe(c.labelEn);
      expect(row.icon, c.code).toBe(c.icon);
      expect(row.sort, c.code).toBe(c.sort);
      expect(row.direction, c.code).toBe(c.direction === 'both' ? 'in' : c.direction);
      expect(row.replaced_by, c.code).toBeNull();
      expect(row.valid_from, c.code).toBe('2000-01-01');
      expect(row.valid_to, c.code).toBeNull();
      // English only (owner 2026-10-25): the Czech columns carry the English label and no explanation.
      expect(row.label_cs, c.code).toBe(c.labelEn);
      expect(row.explanation_cs, c.code).toBe('');
    }
  });

  it('is re-runnable: a second insert of a seeded code is a no-op', async () => {
    const first = CATEGORIES[0];
    if (first === undefined) {
      throw new Error('no categories');
    }
    await sql`insert into categories (code, direction, tax_effect, label_cs, label_en, explanation_cs, icon, sort)
      values (${first.code}, 'in', ${first.taxEffect}, 'x', 'x', '', null, 9999)
      on conflict (code) do nothing`;
    const [row] = await sql<CategoryRow[]>`select * from categories where code = ${first.code}`;
    expect(row?.label_en).toBe(first.labelEn);
    expect(row?.sort).toBe(first.sort);
  });

  it('authenticated users can read the seed (05 §10.3 global read)', async () => {
    const count = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      const [r] = await tx<{ n: number }[]>`select count(*)::int as n from categories`;
      return r?.n;
    });
    expect(count).toBe(CATEGORIES.length);
  });
});
```

2. Create `packages/db/migrations/0040_categories_seed.sql`. Header comment, then one `insert ... on conflict (code) do nothing;` with 56 value rows copied from `packages/domain/src/taxonomy/categories.ts` (read that file; it is the source of the labels and icons). Shape:

```sql
-- 0040_categories_seed: the 56 categories of 04 §3.1 (global seed data, 05 §5), the mirror of
-- packages/domain/src/taxonomy/categories.ts (brief 0301). Re-runnable (on conflict do nothing).
-- English only (owner 2026-10-25): label_cs = label_en, explanation_cs = ''. TODO(i18n-cs).
-- direction 'both' of the domain list is stored as 'in' (the enum is two-valued). Forward-only.

insert into categories (code, direction, tax_effect, label_cs, label_en, explanation_cs, icon, sort) values
  ('income_services', 'out', 'taxable_income', '<labelEn>', '<labelEn>', '', '<icon>', 10),
  -- … one row per CATEGORIES entry, in the same order, sort = the domain `sort` …
  ('private_withdrawal', 'in', 'private', '<labelEn>', '<labelEn>', '', '<icon>', 560)
on conflict (code) do nothing;
```

Direction per group: income `'out'`; expenses, non-deductible, asset, taxes/insurance, `private_expense` `'in'`; pass-through, transfers, `private_withdrawal` (`both` in the domain) `'in'`. Escape a `'` inside a label as `''`.

3. Edit `packages/db/migrations/meta/_journal.json`: after the `0015_onboarding` entry add

```json
    {
      "idx": 9,
      "version": "7",
      "when": 1760745600009,
      "tag": "0040_categories_seed",
      "breakpoints": true
    }
```

(keep valid JSON: a comma after the previous entry). Run `node scripts/migration-lint.ts packages/db/migrations/0040_categories_seed.sql 2>&1 | tail -5`.

4. `pnpm db:start 2>&1 | tail -5` (if it fails for lack of Docker/Postgres, stop and report; do not skip the test silently). Then `pnpm --filter @shoebox/db test -- categories-seed 2>&1 | tail -30`. Fix the SQL until green (the test names the failing code). Then `pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30` (the from-scratch run in `tenancy.db.test.ts` and the RLS meta-test must stay green: `categories` is already in `GLOBAL_TABLES`).

## 5. Do not touch

`packages/domain`, 0004, `rls-catalog.ts`, drizzle schema (no column changes), other packages.

## 6. Commands

- `pnpm --filter @shoebox/db test -- categories-seed 2>&1 | tail -30`
- `pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30`
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`
- `node scripts/migration-lint.ts 2>&1 | tail -5`

## 7. Acceptance

- [ ] `select count(*) from categories` = 56 after migration; test file green, unchanged.
- [ ] Journal entry added; migration-lint clean.
- [ ] Commits `0312 step 1..4`; no push.

## 8. Stop and ask

As TEMPLATE §8. Also stop if `CATEGORIES` is not exported from `@shoebox/domain` (0301 not merged).

## 9. Report

`docs/tasks/0312-report.md`, `Status: review`, commit `0312 report`. List any label that needed `''` escaping.

## Spec notes for the reviewer

- 04 §3.1 / 05 §5 give `categories.direction` as `in | out`, while pass-through, transfer and `private_withdrawal` categories appear on both sides (M04 §4.1 H1 "direction check skipped on statements"). The seed stores `'in'`; a later 05 edit could add `both` to the enum (new enum value = forward-only `alter type ... add value`). `TODO(decision)` noted in the migration header.
- `label_cs`/`explanation_cs` `not null` (0004) collides with "no new Czech" (owner 2026-10-25); the seed fills them with English / empty rather than altering the columns.

## Risk list (for the reviewer)

`packages/db/migrations/0040_categories_seed.sql` (data only; no DDL).

## Owner steps

None.
