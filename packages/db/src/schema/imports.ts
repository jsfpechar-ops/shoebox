// Drizzle mirror of migrations/0030_spreadsheet_imports.sql. The SQL file is the source of truth.
import { sql } from 'drizzle-orm';
import { char, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sourceFiles } from './documents';
import { authUsers, organizations } from './tenancy';

export const importMappings = pgTable(
  'import_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    moneyAccountId: uuid('money_account_id'), // TODO(M07): FK to money_accounts
    headerSignature: char('header_signature', { length: 64 }).notNull(),
    sheetName: text('sheet_name'),
    mapping: jsonb('mapping').notNull(),
    options: jsonb('options').notNull().default({}),
    createdBy: uuid('created_by').references(() => authUsers.id),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('import_mappings_org_id_kind_money_account_id_header_signature_key')
      .on(t.orgId, t.kind, t.moneyAccountId, t.headerSignature)
      .nullsNotDistinct(),
  ],
);

export const spreadsheetImports = pgTable('spreadsheet_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  sourceFileId: uuid('source_file_id')
    .notNull()
    .references(() => sourceFiles.id, { onDelete: 'cascade' }),
  mappingId: uuid('mapping_id').references(() => importMappings.id, { onDelete: 'set null' }),
  state: text('state').notNull().default('parsed'),
  rowCount: integer('row_count').notNull().default(0),
  importedCount: integer('imported_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  skippedRows: jsonb('skipped_rows').notNull().default(sql`'[]'::jsonb`),
  createdBy: uuid('created_by').references(() => authUsers.id),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  undoneAt: timestamp('undone_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
