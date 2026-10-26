// Drizzle mirror of migrations/0043_filings.sql (05 §8 output tables of Phase 3). The SQL file is the
// source of truth for DDL; this file gives typed queries. RLS policies and the immutability rule for
// filing_entries exist only in SQL. Money columns are numeric: strings in Drizzle, never floats.

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { documents } from './documents';
import {
  filingKindEnum,
  filingOriginEnum,
  filingStateEnum,
  filingTypeEnum,
  vatRateTypeEnum,
  vatTreatmentEnum,
} from './enums';
import { authUsers, organizations } from './tenancy';

/** One filing per (org, type, period, kind) while open; amendments link back via amends_filing_id. */
export const filings = pgTable(
  'filings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: filingTypeEnum('type').notNull(),
    kind: filingKindEnum('kind').notNull().default('radne'),
    origin: filingOriginEnum('origin').notNull().default('generated'),
    sourceDocumentId: uuid('source_document_id').references(() => documents.id),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    state: filingStateEnum('state').notNull().default('draft'),
    amendsFilingId: uuid('amends_filing_id').references((): AnyPgColumn => filings.id),
    bundleId: uuid('bundle_id'),
    formVersion: text('form_version'),
    totals: jsonb('totals').notNull().default({}),
    inputs: jsonb('inputs').notNull().default({}),
    xmlPath: text('xml_path'),
    pdfPath: text('pdf_path'),
    xlsxPath: text('xlsx_path'),
    xsdValid: boolean('xsd_valid'),
    xsdErrors: jsonb('xsd_errors'),
    simpleCheck: jsonb('simple_check').notNull().default({}),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    generatedBy: uuid('generated_by').references(() => authUsers.id),
    markedFiledAt: timestamp('marked_filed_at', { withTimezone: true }),
    filedOn: date('filed_on'),
    submissionRef: text('submission_ref'),
    discoveredOn: date('discovered_on'),
  },
  (t) => [
    uniqueIndex('filings_one_open_per_kind')
      .on(t.orgId, t.type, t.periodStart, t.kind)
      .where(sql`state in ('draft','generated','downloaded')`),
    index('filings_org_id_period_start_idx').on(t.orgId, t.periodStart),
    check('filings_inputs_no_rc', sql`not (inputs ?| array['rodneCislo','rod_c','rodne_cislo'])`),
  ],
);

/** Snapshot of the documents that went into a filing. */
export const filingDocuments = pgTable(
  'filing_documents',
  {
    filingId: uuid('filing_id')
      .notNull()
      .references(() => filings.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    documentRevision: integer('document_revision').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.filingId, t.documentId] }),
    index('filing_documents_org_id_document_id_idx').on(t.orgId, t.documentId),
    index('filing_documents_org_id_filing_id_idx').on(t.orgId, t.filingId),
  ],
);

/** Entry-level snapshot for amendment diffs. Immutable after insert (worker has no update path). */
export const filingEntries = pgTable(
  'filing_entries',
  {
    filingId: uuid('filing_id')
      .notNull()
      .references(() => filings.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    documentRevision: integer('document_revision').notNull(),
    vatTreatment: vatTreatmentEnum('vat_treatment').notNull(),
    vatRateType: vatRateTypeEnum('vat_rate_type').notNull(),
    dphdp3Rows: text('dphdp3_rows').array().notNull(),
    khSection: text('kh_section'),
    shvCode: smallint('shv_code'),
    counterpartyVatId: text('counterparty_vat_id'),
    evidenceNumber: text('evidence_number'),
    vatPointDate: date('vat_point_date').notNull(),
    baseCzk: numeric('base_czk', { precision: 15, scale: 2 }).notNull(),
    vatCzk: numeric('vat_czk', { precision: 15, scale: 2 }).notNull(),
  },
  (t) => [index('filing_entries_org_id_filing_id_idx').on(t.orgId, t.filingId)],
);
