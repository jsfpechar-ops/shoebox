// Drizzle mirror of migrations/0045_tax_reserve.sql (M06 §4.11 cached tax-reserve estimate).
// The SQL file is the source of truth for DDL; this file gives typed queries. One row per org;
// users select only, the worker writes (RLS exists only in SQL).
import { sql } from 'drizzle-orm';
import { check, date, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './tenancy';

/** M06 §4.11 cached "how much to set aside" estimate. Single writer: the worker (podklady.reserve.refresh). */
export const taxReserveEstimates = pgTable(
  'tax_reserve_estimates',
  {
    orgId: uuid('org_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    asOf: date('as_of').notNull(),
    taxYear: smallint('tax_year').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    ledgerHash: text('ledger_hash'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('tax_reserve_estimates_kind_check', sql`${t.kind} in ('estimate','pausalni_dan')`)],
);
