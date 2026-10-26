// Drizzle mirror of migrations/0044_obligations.sql (05 §8 deadlines and payables to authorities).
// The SQL file is the source of truth for DDL; this file gives typed queries. RLS (users update only
// state, done_at, done_source), the column-guard trigger and the policies exist only in SQL.
// `kind` is text, not an enum: the canonical list lives in 04 §9.2.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { documents } from './documents';
import { filings } from './filings';
import { organizations } from './tenancy';

/** Deadlines and payables to authorities. Single writer: the worker (M09 generator, M05 lifecycle). */
export const obligations = pgTable(
  'obligations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    legalDueDate: date('legal_due_date'),
    dueDate: date('due_date').notNull(),
    amountEstimate: numeric('amount_estimate', { precision: 15, scale: 2 }),
    isOptional: boolean('is_optional').notNull().default(false),
    state: text('state').notNull().default('open'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneSource: text('done_source'),
    evidenceDocumentId: uuid('evidence_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    sourceRule: text('source_rule').notNull(),
    generatorVersion: integer('generator_version').notNull().default(1),
    filingId: uuid('filing_id').references(() => filings.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('obligations_uniq').on(t.orgId, t.kind, t.periodStart).nullsNotDistinct(),
    index('obligations_open_due').on(t.orgId, t.dueDate).where(sql`state in ('open','overdue')`),
    check('obligations_state_check', sql`${t.state} in ('open','done','not_applicable','overdue')`),
    check(
      'obligations_done_source_check',
      sql`${t.doneSource} in ('user','filing','evidence_document','bank_payment','profile_change')`,
    ),
  ],
);
