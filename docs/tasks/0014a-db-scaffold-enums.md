# 0014a: packages/db scaffold, Drizzle config and the enums migration

Status: done
Ticket: P0-DB-01 (part a of a/b/c) | Depends on: none (P0-REPO-01, P0-DOM-03 merged) | Base commit: head of phase/0 | Branch: task/0014-db-scaffold | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Give `packages/db` its dependencies (Drizzle, the `postgres` driver, `@shoebox/domain`), a `drizzle.config.ts`, the first migration `0001_enums.sql` (extensions, schema `app`, the 25 canonical enums) with its Drizzle journal, the Drizzle `pgEnum` mirrors, and a unit test that proves the SQL enum values equal `@shoebox/domain` ENUMS. Every later table uses these enums, so a drifted value here would put documents in the wrong state or VAT box.

Part b (brief 0014b, same branch) adds `0002_tenancy.sql`, the RLS helpers, the Drizzle tenancy schema and the database test. Part c (0014c) wires the Supabase CLI and the root scripts. No database is needed for this part.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- "Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only, Postgres 16. Names exactly as in `docs/v3/05-data-model.md`."
- Hard rule 5: names are canonical in 04/05. 04: "Every enum is a Postgres enum or check constraint *and* a TypeScript union in `packages/domain`". The TypeScript side already exists: `packages/domain/src/enums/index.ts` exports `VAT_STATUS_VALUES` … `PACKAGE_STATE_VALUES` (25 `as const` tuples) and `ENUMS` (a record `{ vat_status: VAT_STATUS_VALUES, … }` keyed by the Postgres type name). Do not open or change it.
- Approved dependencies (decisions.md): Drizzle (stack line, 2026-10-17), Supabase. The `postgres` driver (postgres-js) is the Drizzle Postgres driver this brief uses; drizzle-kit is Drizzle's own CLI. Exact versions: `drizzle-orm@0.45.3`, `drizzle-kit@0.31.11`, `postgres@3.4.9` (all published ≥ 14 days ago). Nothing else.
- 05 intro: "Drizzle definitions in `packages/db/src/schema/*.ts` must match it 1:1". 05 "Migration order": 1. extensions + schema `app` → 2. enums (§1) → 3. tenancy (§2, brief 0014b).
- 05 extensions block and §1 enum block are pasted verbatim into the migration file in step 4 (25 `create type` statements over 35 lines; the executor writes them exactly as given).
- Migrations are hand-written SQL (names fixed by 05) with a hand-maintained `migrations/meta/_journal.json` in drizzle-kit's format; `drizzle-kit migrate` and `drizzle-orm`'s migrator both read that journal. `drizzle-kit generate` is not used.
- The root `vitest.workspace.ts` (P0-REPO-01) puts `packages/*/test/**/*.test.ts` in the `unit` project and only `packages/db/test/**/*.db.test.ts` in the `db` project. The test in this brief needs no database, so it is a plain `*.test.ts` and runs in CI today.

Current `packages/db/package.json` (anchor for step 1):

```json
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Current `packages/db/src/index.ts` (anchor for step 6):

```ts
export const packageName = '@shoebox/db' as const;
```

All code below was run once by the brief writer against `phase/0` (Drizzle 0.45.3, postgres 3.4.9, Postgres 16.15): `tsc` clean, `biome ci` clean, the parity test passes (27 tests).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/package.json` | edit | dependencies, `migrate` script |
| `pnpm-lock.yaml` | edit (by `pnpm install`) | lockfile |
| `packages/db/drizzle.config.ts` | create | drizzle-kit config |
| `packages/db/migrations/0001_enums.sql` | create | extensions, schema `app`, 25 enums |
| `packages/db/migrations/meta/_journal.json` | create | Drizzle journal, entry 0 |
| `packages/db/src/schema/enums.ts` | create | 25 `pgEnum` mirrors built from `@shoebox/domain` tuples |
| `packages/db/src/index.ts` | edit | export the enums |
| `packages/db/test/enums-parity.test.ts` | create | SQL enums = domain ENUMS |

No other file may change.

## 4. Steps

Setup (once): `git fetch origin phase/0 && git checkout -b task/0014-db-scaffold origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3`

Rules for every step: write each new file with **one Write call**, contents exactly as given. Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0014a step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: edit `packages/db/package.json`

Replace the anchor block (§2) with:

```json
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@shoebox/domain": "workspace:*",
    "drizzle-orm": "0.45.3",
    "postgres": "3.4.9"
  },
  "devDependencies": {
    "drizzle-kit": "0.31.11",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Command: `pnpm install 2>&1 | tail -5` → ends with `Done in …`; `git status --short | head -5` shows `M packages/db/package.json` and `M pnpm-lock.yaml`, nothing else. Commit (this commit includes the lockfile).

### Step 2: create `packages/db/drizzle.config.ts`

```ts
import { defineConfig } from 'drizzle-kit';

// Hand-written SQL migrations in ./migrations with a hand-maintained meta/_journal.json
// (names from 05: NNNN_name.sql). `drizzle-kit migrate` applies them; `generate` is not used.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/*.ts',
  out: './migrations',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  },
  strict: true,
  verbose: true,
});
```

Command: `pnpm exec biome ci packages/db/drizzle.config.ts 2>&1 | tail -3` → `Checked 1 file … No fixes applied.` (an info line about `biome.json` `recommended` being deprecated is fine). Commit.

### Step 3: create `packages/db/migrations/meta/_journal.json`

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1760745600000, "tag": "0001_enums", "breakpoints": true }
  ]
}
```

Command: `node -e "JSON.parse(require('fs').readFileSync('packages/db/migrations/meta/_journal.json','utf8')); console.log('ok')"` → `ok`. Commit.

### Step 4: create `packages/db/migrations/0001_enums.sql`

Exactly this content (the 25 `create type` statements (35 lines) are 05 §1 verbatim, including its comments):

```sql
-- 0001_enums: extensions, schema app and the 25 canonical enums (05 intro + §1; names canonical in 04).
-- Forward-only (rules.md Database). Enum values must equal packages/domain/src/enums/index.ts
-- (packages/db/test/enums-parity.test.ts compares this file with ENUMS).

create extension if not exists btree_gist;     -- taxpayer_profiles exclusion constraint
create extension if not exists pg_trgm;        -- register search (M11)
create extension if not exists citext;         -- case-insensitive e-mail (invitations)
create schema if not exists app;

create type vat_status         as enum ('neplatce','identifikovana_osoba','platce');
create type vat_period         as enum ('monthly','quarterly');
create type tax_regime         as enum ('danova_evidence','pausalni_vydaje','pausalni_dan','ucetnictvi');
create type member_role        as enum ('owner','member','accountant','viewer');
create type document_class     as enum ('received_invoice','received_receipt','received_credit_note','received_advance_tax_doc',
  'received_proforma','issued_invoice','issued_credit_note','platform_statement','settlement_statement','order_confirmation',
  'delivery_note','bank_statement','government_filing','contract','other_supporting','non_document','unknown');
create type document_status    as enum ('received','splitting','classifying','extracting','validating','categorizing',
  'needs_review','ready','finalized','supporting','duplicate','failed');
  -- 'supporting' = kept and linked, never booked (all non-bookable classes, 04 §2.4). Renamed from 'rejected' on 2026-10-18.
create type tax_doc_status     as enum ('full_tax_document','simplified_tax_document','not_tax_document','foreign_document','unknown');
create type direction          as enum ('in','out');             -- in = expense side (received), out = income side (issued)
create type line_type          as enum ('item','discount','shipping','fee','rounding','advance_deduction','deposit','text');
create type vat_rate_type      as enum ('standard','reduced','zero','none');
create type vat_treatment      as enum ('rcv_domestic_vat','rcv_domestic_no_vat','rcv_eu_service_reverse_charge',
  'rcv_non_eu_service_reverse_charge','rcv_eu_goods_acquisition','rcv_domestic_reverse_charge','rcv_import_customs',
  'rcv_foreign_vat_charged','rcv_out_of_scope','iss_domestic_vat','iss_eu_service','iss_eu_goods','iss_non_eu_service',
  'iss_export_goods','iss_domestic_reverse_charge','iss_exempt','iss_no_vat');
create type tax_effect         as enum ('taxable_income','non_taxable_income','deductible_expense','non_deductible_expense',
  'asset','pass_through','transfer','tax_or_insurance_payment','private');
create type field_source       as enum ('isdoc','qr','pdf_text','template','llm','llm_escalated','registry','rule','vendor_memory','user','derived');
  -- typed (manual entry) and spreadsheet-imported values are 'user' (04 §2.2a)
create type severity           as enum ('blocking','warning','info');
create type validation_state   as enum ('open','resolved','dismissed');
create type money_account_type as enum ('bank','cash','card','platform');
create type tx_source          as enum ('statement_file','email_notice','bank_api','manual','document_evidence');
create type link_type          as enum ('payment','refund','fee','fx_difference','platform_payout','offset');
create type match_method       as enum ('vs_amount','vs_only','amount_date_counterparty','card_merchant_fuzzy',
  'platform_statement','manual','document_evidence');
create type doc_link_kind      as enum ('duplicate_of','corrects','settles','supports','fulfills','reported_in','same_period_reconciles');
create type filing_type        as enum ('DPHDP3','DPHKH1','DPHSHV','DPFDP7_PARTIAL','PODKLADY_DPFO','VAT_WORKBOOK');
create type filing_kind        as enum ('radne','opravne','dodatecne','nasledne');
create type filing_state       as enum ('draft','generated','downloaded','marked_filed','superseded');
create type filing_origin      as enum ('generated','imported');  -- imported = the user's own filed return (M05 §4.11)
create type package_state      as enum ('draft','ready','sent','acknowledged');
```

Command: `grep -c 'create type' packages/db/migrations/0001_enums.sql` → `25`. Commit.

### Step 5: create `packages/db/src/schema/enums.ts`

```ts
// Drizzle mirrors of the 25 Postgres enums created by migrations/0001_enums.sql.
// Values come from @shoebox/domain (04: one TypeScript union per Postgres enum), so the three
// copies (domain, Drizzle, SQL) cannot drift: this file reuses the domain tuples, and
// test/enums-parity.test.ts compares the SQL with the domain.
import {
  DIRECTION_VALUES,
  DOC_LINK_KIND_VALUES,
  DOCUMENT_CLASS_VALUES,
  DOCUMENT_STATUS_VALUES,
  FIELD_SOURCE_VALUES,
  FILING_KIND_VALUES,
  FILING_ORIGIN_VALUES,
  FILING_STATE_VALUES,
  FILING_TYPE_VALUES,
  LINE_TYPE_VALUES,
  LINK_TYPE_VALUES,
  MATCH_METHOD_VALUES,
  MEMBER_ROLE_VALUES,
  MONEY_ACCOUNT_TYPE_VALUES,
  PACKAGE_STATE_VALUES,
  SEVERITY_VALUES,
  TAX_DOC_STATUS_VALUES,
  TAX_EFFECT_VALUES,
  TAX_REGIME_VALUES,
  TX_SOURCE_VALUES,
  VALIDATION_STATE_VALUES,
  VAT_PERIOD_VALUES,
  VAT_RATE_TYPE_VALUES,
  VAT_STATUS_VALUES,
  VAT_TREATMENT_VALUES,
} from '@shoebox/domain';
import { pgEnum } from 'drizzle-orm/pg-core';

export const vatStatusEnum = pgEnum('vat_status', VAT_STATUS_VALUES);
export const vatPeriodEnum = pgEnum('vat_period', VAT_PERIOD_VALUES);
export const taxRegimeEnum = pgEnum('tax_regime', TAX_REGIME_VALUES);
export const memberRoleEnum = pgEnum('member_role', MEMBER_ROLE_VALUES);
export const documentClassEnum = pgEnum('document_class', DOCUMENT_CLASS_VALUES);
export const documentStatusEnum = pgEnum('document_status', DOCUMENT_STATUS_VALUES);
export const taxDocStatusEnum = pgEnum('tax_doc_status', TAX_DOC_STATUS_VALUES);
export const directionEnum = pgEnum('direction', DIRECTION_VALUES);
export const lineTypeEnum = pgEnum('line_type', LINE_TYPE_VALUES);
export const vatRateTypeEnum = pgEnum('vat_rate_type', VAT_RATE_TYPE_VALUES);
export const vatTreatmentEnum = pgEnum('vat_treatment', VAT_TREATMENT_VALUES);
export const taxEffectEnum = pgEnum('tax_effect', TAX_EFFECT_VALUES);
export const fieldSourceEnum = pgEnum('field_source', FIELD_SOURCE_VALUES);
export const severityEnum = pgEnum('severity', SEVERITY_VALUES);
export const validationStateEnum = pgEnum('validation_state', VALIDATION_STATE_VALUES);
export const moneyAccountTypeEnum = pgEnum('money_account_type', MONEY_ACCOUNT_TYPE_VALUES);
export const txSourceEnum = pgEnum('tx_source', TX_SOURCE_VALUES);
export const linkTypeEnum = pgEnum('link_type', LINK_TYPE_VALUES);
export const matchMethodEnum = pgEnum('match_method', MATCH_METHOD_VALUES);
export const docLinkKindEnum = pgEnum('doc_link_kind', DOC_LINK_KIND_VALUES);
export const filingTypeEnum = pgEnum('filing_type', FILING_TYPE_VALUES);
export const filingKindEnum = pgEnum('filing_kind', FILING_KIND_VALUES);
export const filingStateEnum = pgEnum('filing_state', FILING_STATE_VALUES);
export const filingOriginEnum = pgEnum('filing_origin', FILING_ORIGIN_VALUES);
export const packageStateEnum = pgEnum('package_state', PACKAGE_STATE_VALUES);
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5` → no errors (exit 0). Commit.

### Step 6: edit `packages/db/src/index.ts`

Replace the whole file (anchor in §2) with:

```ts
export const packageName = '@shoebox/db' as const;
export * from './schema/enums';
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5` → no errors. Commit.

### Step 7: create `packages/db/test/enums-parity.test.ts`

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENUMS } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';

// Hard rule 5 / 04: every Postgres enum is also a TypeScript union in packages/domain. This test
// reads the SQL migrations (no database needed, runs in the `unit` project) and compares every
// `create type … as enum` and `alter type … add value` with ENUMS, names and values, in order.

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function parseEnums(files: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const file of files) {
    const sql = stripComments(readFileSync(`${MIGRATIONS}/${file}`, 'utf8'));
    for (const m of sql.matchAll(/create type\s+(\w+)\s+as enum\s*\(([^)]*)\)/gi)) {
      const name = m[1] ?? '';
      out[name] = [...(m[2] ?? '').matchAll(/'([^']*)'/g)].map((v) => v[1] ?? '');
    }
    for (const m of sql.matchAll(/alter type\s+(\w+)\s+add value\s+(?:if not exists\s+)?'([^']*)'/gi)) {
      const name = m[1] ?? '';
      const list = out[name];
      if (list === undefined) {
        throw new Error(`${file}: alter type ${name} before its create type`);
      }
      list.push(m[2] ?? '');
    }
  }
  return out;
}

const files = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();
const sqlEnums = parseEnums(files);
const names = Object.keys(ENUMS) as (keyof typeof ENUMS)[];

describe('SQL enums mirror @shoebox/domain ENUMS', () => {
  it('reads the migrations in order, 0001_enums.sql first', () => {
    expect(files[0]).toBe('0001_enums.sql');
  });

  it('defines exactly the 25 domain enums (same names, no extra types)', () => {
    expect(names).toHaveLength(25);
    expect(Object.keys(sqlEnums).sort()).toEqual([...names].sort());
  });

  it.each(names)('%s has the same values in the same order', (name) => {
    expect(sqlEnums[name]).toEqual([...ENUMS[name]]);
  });
});
```

Command: `pnpm --filter @shoebox/db test -- enums-parity 2>&1 | tail -8` → `Tests  27 passed (27)`. Commit.

## 5. Do not touch

`packages/domain/**` (the enum source of truth; a mismatch means the SQL is wrong, not the domain), `packages/db/test/smoke.test.ts`, `packages/db/vitest.config.ts`, `packages/db/tsconfig.json`, root `package.json`, `pnpm-workspace.yaml`, `vitest.workspace.ts`, `biome.json`, `docs/v3/**`. Hard rules: 5 (canonical names; the 25 `create type` lines are 05 §1 verbatim), 7 (no dependency beyond the three named), 8 (never push to `main`).

## 6. Commands

```
pnpm --filter @shoebox/db test -- enums-parity 2>&1 | tail -30     # Tests 27 passed
pnpm --filter @shoebox/db test 2>&1 | tail -30                     # Tests 28 passed (smoke + parity)
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                # exit 0, no output
pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30            # exit 0 (domain unchanged)
pnpm lint 2>&1 | tail -30                                          # Checked N files … No fixes applied. (deprecation info allowed)
```

The test-map row for `packages/db` (`test -- migrations rls`, needs a database) applies to 0014b; this part has no database test.

## 7. Acceptance

- [ ] `packages/db/drizzle.config.ts` exists and `pnpm lint` passes.
- [ ] `packages/db/migrations/0001_enums.sql` exists with 25 `create type` statements and `packages/db/migrations/meta/_journal.json` lists it as entry 0.
- [ ] `packages/db/test/enums-parity.test.ts`: Postgres enum values (as written in the SQL migrations) equal `packages/domain` ENUMS, 27 tests pass. (The ticket's "Postgres enum values equal `packages/domain/src/enums.ts`" is proven against the live database in 0014b's `tenancy.db.test.ts` as well.)
- [ ] `pnpm --filter @shoebox/db typecheck` and `pnpm lint` pass.
- Not in this part (deferred to 0014b/0014c): `0002_tenancy.sql`, the tenancy test, `supabase/config.toml`, root scripts `db:start`/`db:reset`/`test:db`.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- `pnpm install` wants a dependency other than the three in step 1, or fails through the proxy;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0014a-report.md` (600 tokens at most) and set `Status: review`. Then `git push -u origin task/0014-db-scaffold 2>&1 | tail -3` (the orchestrator starts 0014b on this branch and opens the PR after 0014c). The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -15`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

- `packages/db/migrations/0001_enums.sql`: the 25 `create type` statements (35 lines) must be 05 §1 verbatim; the parity test proves the values, the reviewer checks that `create extension` / `create schema app` lines exist (05 migration order step 1) and nothing else was added.
- `packages/db/package.json`: exactly three new runtime/dev dependencies (`drizzle-orm`, `postgres`, `drizzle-kit`) plus `@shoebox/domain`; the lockfile diff should add only these and their transitive packages.
- `packages/db/migrations/meta/_journal.json`: `tag` must equal the file name without `.sql`; the migrator looks the file up by tag.

## Owner steps

1. None for this part. The `postgres` driver and `drizzle-kit` are used as the Drizzle-approved toolchain; if you want them listed as their own line in `docs/context/decisions.md`, tell the orchestrator and it adds "[deps] drizzle-orm 0.45, drizzle-kit 0.31, postgres 3.4 (Drizzle's driver and CLI)".
