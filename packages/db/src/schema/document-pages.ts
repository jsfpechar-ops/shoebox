// Drizzle mirror of migrations/0060_document_pages.sql. The SQL file is the source of truth.
import { boolean, index, pgTable, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { documents, sourceFiles } from './documents';
import { organizations } from './tenancy';

export const documentPages = pgTable(
  'document_pages',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    sourceFileId: uuid('source_file_id')
      .notNull()
      .references(() => sourceFiles.id),
    filePage: smallint('file_page').notNull(),
    region: text('region').notNull().default(''),
    supplierKey: text('supplier_key').notNull().default(''),
    docNumber: text('doc_number').notNull().default(''),
    labelN: smallint('label_n'),
    labelOf: smallint('label_of'),
    hasTotals: boolean('has_totals').notNull().default(false),
    startsDocument: boolean('starts_document').notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.position] }),
    index('document_pages_org_id_source_file_id_idx').on(t.orgId, t.sourceFileId),
  ],
);
