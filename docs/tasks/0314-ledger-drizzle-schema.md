# 0314: Drizzle mirror of migration 0041 (`taxLedgerEntries`, `vatLedgerEntries`)

Status: todo
Ticket: P1-LEDG-01 / P1-LEDG-02 (typed queries) | Depends on: 0313 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 15 tool calls, 35k tokens

## 1. Objective

Typed Drizzle tables for the two ledger tables so that the worker job (later brief) and the Přehled loader can query them through `db.query.taxLedgerEntries` / `db.query.vatLedgerEntries`. The SQL migration (0313) stays the source of truth for DDL; this file mirrors it one to one, as `schema/platform.ts` mirrors 0007.

## 2. Context

Pattern (pasted from `packages/db/src/schema/platform.ts` header): "Drizzle mirror of migrations/NNNN. The SQL file is the source of truth for DDL; this file gives typed queries. … the RLS policies and the grants exist only in SQL. Money is numeric: a string in Drizzle, never a float." `schema/index.ts` does `export * from './<area>'` per slice; `DbSchema` in `tenant.ts` is `typeof import('./schema/index')`. Existing helpers to import: `documents` (`./documents`), `documentLines` (`./document-details`), `categories` (`./partners`), `organizations` (`./tenancy`), enums `taxEffectEnum`, `vatTreatmentEnum`, `vatRateTypeEnum` (`./enums`). Drizzle 0.45.3 (`pgTable`, `uuid`, `date`, `smallint`, `integer`, `bigint`, `numeric`, `text`, `char`, `check`, `index`, `pgSequence`). Column names: snake_case strings as in SQL; property names camelCase. Index names: Postgres' default for `create index on t (a, b)` is `t_a_b_idx`; use those names so a future `drizzle-kit` diff is quiet.

No DB test here (0313 proves the SQL); the check is `typecheck` plus the existing `enums-parity` and smoke tests.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/schema/ledgers.ts` | create | two tables + sequence |
| `packages/db/src/schema/index.ts` | edit | `export * from './ledgers';` |

## 4. Steps

1. Create `packages/db/src/schema/ledgers.ts`:

```ts
// Drizzle mirror of migrations/0041_ledgers.sql (05 §7 derived ledgers). The SQL file is the source
// of truth for DDL; this file gives typed queries. RLS (users select only, worker writes) and the
// sequence grant exist only in SQL. Money columns are numeric: strings in Drizzle, never floats.
// payment_link_id / transaction_id carry no FK until P0-DB-08 creates payment_links/transactions.
import { sql } from 'drizzle-orm';
import { bigint, char, check, date, index, integer, numeric, pgSequence, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { documentLines } from './document-details';
import { documents } from './documents';
import { taxEffectEnum, vatRateTypeEnum, vatTreatmentEnum } from './enums';
import { categories } from './partners';
import { organizations } from './tenancy';

/** Monotonic, global (M04 §4.13): one value per ledger rebuild. */
export const ledgerBuildVersionSeq = pgSequence('ledger_build_version_seq');

/** Income-tax ledger, cash basis (M04 §4.11). Users select only (05 §10.2). */
export const taxLedgerEntries = pgTable(
  'tax_ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    entryDate: date('entry_date').notNull(),
    taxYear: smallint('tax_year').notNull(),
    basis: text('basis').notNull().default('payment'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    lineId: uuid('line_id').references(() => documentLines.id, { onDelete: 'cascade' }),
    paymentLinkId: uuid('payment_link_id'),
    transactionId: uuid('transaction_id'),
    categoryCode: text('category_code').notNull().references(() => categories.code),
    taxEffect: taxEffectEnum('tax_effect').notNull(),
    amountCzk: numeric('amount_czk', { precision: 15, scale: 2 }).notNull(),
    businessSharePct: numeric('business_share_pct', { precision: 5, scale: 2 }).notNull().default('100'),
    businessAmountCzk: numeric('business_amount_czk', { precision: 15, scale: 2 }).notNull().default('0'),
    buildVersion: bigint('build_version', { mode: 'bigint' }).notNull(),
  },
  (t) => [
    index('tax_ledger_entries_org_id_tax_year_tax_effect_idx').on(t.orgId, t.taxYear, t.taxEffect),
    index('tax_ledger_entries_org_id_document_id_idx').on(t.orgId, t.documentId),
    check('tax_ledger_entries_basis_check', sql`${t.basis} in ('payment','document_evidence','provisional')`),
  ],
);

/** VAT ledger: one entry per (document, vat_treatment, vat_rate_type) group (M05 §4.2). */
export const vatLedgerEntries = pgTable(
  'vat_ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    vatPointDate: date('vat_point_date').notNull(),
    vatPointRule: text('vat_point_rule').notNull().default('duzp'),
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    lineId: uuid('line_id').references(() => documentLines.id, { onDelete: 'cascade' }),
    vatTreatment: vatTreatmentEnum('vat_treatment').notNull(),
    vatRateType: vatRateTypeEnum('vat_rate_type').notNull(),
    vatRatePct: numeric('vat_rate_pct', { precision: 5, scale: 2 }).notNull(),
    baseCzk: numeric('base_czk', { precision: 15, scale: 2 }).notNull(),
    vatCzk: numeric('vat_czk', { precision: 15, scale: 2 }).notNull(),
    deductionPct: numeric('deduction_pct', { precision: 5, scale: 2 }).notNull().default('100'),
    currency: char('currency', { length: 3 }).notNull().default('CZK'),
    baseForeign: numeric('base_foreign', { precision: 15, scale: 2 }),
    fxRate: numeric('fx_rate', { precision: 12, scale: 6 }),
    fxAmount: integer('fx_amount'),
    fxRateDate: date('fx_rate_date'),
    dphdp3Rows: text('dphdp3_rows').array().notNull(),
    khSection: text('kh_section'),
    khDocumentTotalCzk: numeric('kh_document_total_czk', { precision: 15, scale: 2 }),
    shvCode: smallint('shv_code'),
    counterpartyVatId: text('counterparty_vat_id'),
    evidenceNumber: text('evidence_number'),
    buildVersion: bigint('build_version', { mode: 'bigint' }).notNull(),
  },
  (t) => [
    index('vat_ledger_entries_org_id_period_start_idx').on(t.orgId, t.periodStart),
    index('vat_ledger_entries_org_id_document_id_idx').on(t.orgId, t.documentId),
    check(
      'vat_ledger_entries_vat_point_rule_check',
      sql`${t.vatPointRule} in ('duzp','max_duzp_received','issue_date','service_period_end','prepayment','eu_goods_15th','user_override')`,
    ),
    check('vat_ledger_entries_kh_section_check', sql`${t.khSection} in ('A1','A2','A3','A4','A5','B1','B2','B3')`),
    check('vat_ledger_entries_shv_code_check', sql`${t.shvCode} in (0,1,2,3)`),
  ],
);
```

   If `pgSequence` is not exported by the installed `drizzle-orm/pg-core`, remove the sequence line and the import and note it in the report (the sequence then exists only in SQL, like the grants).

2. Edit `packages/db/src/schema/index.ts`: add `export * from './ledgers';` between `export * from './enums';` and `export * from './partners';` (alphabetical). Then `pnpm exec biome check --write packages/db/src/schema 2>&1 | tail -5`, `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`, `pnpm --filter @shoebox/db test -- smoke enums-parity 2>&1 | tail -30`, and, with `pnpm db:start` available, `pnpm --filter @shoebox/db test -- with-tenant 2>&1 | tail -30` (the `DbSchema` type now includes the new tables).

## 5. Do not touch

Migrations, `rls-catalog.ts`, tests, other packages.

## 6. Commands

- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/db test -- smoke enums-parity 2>&1 | tail -30`
- `pnpm exec biome check packages/db 2>&1 | tail -10`

## 7. Acceptance

- [ ] Typecheck and biome clean; `db.query.vatLedgerEntries` resolves in `tenant.ts`'s `DbSchema` (typecheck covers it).
- [ ] Commits `0314 step 1..2`; no push.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0314-report.md`, `Status: review`, commit `0314 report`.

## Spec notes for the reviewer

- `build_version` is `bigint` in SQL; the Drizzle column uses `mode: 'bigint'` (JS `bigint`), not `number`, because `nextval` of a global sequence may exceed 2^53 only in theory, but a `number` mode would silently round. The worker job should pass the sequence value through as `bigint`.

## Risk list (for the reviewer)

`packages/db/src/schema/ledgers.ts` (types only; no runtime behavior).

## Owner steps

None.
