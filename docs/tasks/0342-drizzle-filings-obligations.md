# 0342: Drizzle mirrors of 0043 (`filings`, `filing_documents`, `filing_entries`) and 0044 (`obligations`)

Status: todo
Ticket: P3-VAT-09 (schema) | Depends on: 0340, 0341 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 12 tool calls, 35k tokens

## 1. Objective

Typed Drizzle tables for the four new tables so the worker and db helpers (0343+) query them without raw SQL. The SQL migration stays the source of truth.

## 2. Context

Pattern: `packages/db/src/schema/ledgers.ts` (header comment, imports from `drizzle-orm/pg-core`, `organizations`/`authUsers` from `./tenancy`, `documents` from `./documents`, enums from `./enums`: `filingTypeEnum`, `filingKindEnum`, `filingStateEnum`, `filingOriginEnum`, `vatTreatmentEnum`, `vatRateTypeEnum`). Money columns `numeric(15,2)` are strings in Drizzle, never floats. `jsonb('totals').notNull().default({})`. Self-reference: `amendsFilingId: uuid('amends_filing_id').references((): AnyPgColumn => filings.id)`. Composite PK: `(t) => [primaryKey({ columns: [t.filingId, t.documentId] })]`. Partial unique index: `uniqueIndex('filings_one_open_per_kind').on(t.orgId, t.type, t.periodStart, t.kind).where(sql\`state in ('draft','generated','downloaded')\`)`. `check('filings_inputs_no_rc', sql\`not (inputs ?| array['rodneCislo','rod_c','rodne_cislo'])\`)`. `text('kind')` for obligations (no enum), `check` for state/done_source lists, `unique('obligations_uniq').on(orgId, kind, periodStart).nullsNotDistinct()`.

Columns: exactly those of the 0340/0341 DDL (same names, snake_case in SQL, camelCase in TS; `created_at`/`updated_at` with `defaultNow()`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/schema/filings.ts` | create | `filings`, `filingDocuments`, `filingEntries` |
| `packages/db/src/schema/obligations.ts` | create | `obligations` |
| `packages/db/src/schema/index.ts` | edit | `export * from './filings'; export * from './obligations';` (alphabetical) |

## 4. Steps

1. Create both schema files. 2. Index exports. 3. `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → 0 errors; `pnpm --filter @shoebox/db test -- enums-parity 2>&1 | tail -30` unchanged. If a Drizzle/SQL parity test exists (`grep -rln 'pg_tables\|information_schema' packages/db/test | head`), run that file too.
4. Commit `feat(db): Drizzle mirrors for filings and obligations (0342)`.

## 5. Do not touch

Migrations, `tenant.ts`, other schema files.

## 6. Commands

`pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` · `pnpm --filter @shoebox/db test -- enums-parity 2>&1 | tail -30`

## 7. Acceptance

- [ ] Typecheck clean; column names match the SQL one to one (`grep -c` of column names vs the migration in the report).

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0342-report.md`.

## Risk list

None beyond typing (no runtime behaviour).

## Owner steps

None.
