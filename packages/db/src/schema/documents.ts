// Drizzle mirror of migrations/0005_documents_core.sql (05 §4 Ingestion and documents, the core
// six tables). The SQL file is the source of truth for DDL; this file gives typed queries. The
// partial and expression indexes, the updated_at triggers, the RLS policies and the grants exist
// only in SQL. Money columns are numeric(15,2), FX numeric(12,6): strings in Drizzle, never floats.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bit,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  directionEnum,
  documentClassEnum,
  documentStatusEnum,
  fieldSourceEnum,
  taxDocStatusEnum,
} from './enums';
import { partners } from './partners';
import { authUsers, organizations } from './tenancy';

export const inboundEmails = pgTable(
  'inbound_emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    fromAddress: text('from_address'),
    toAddress: text('to_address'),
    subject: text('subject'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    purpose: text('purpose').notNull().default('documents'),
    emlPath: text('eml_path').notNull(),
    bodyText: text('body_text'),
    bodyHtmlPath: text('body_html_path'),
    spamVerdict: text('spam_verdict'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    unique('inbound_emails_org_id_message_id_key').on(t.orgId, t.messageId),
    index('inbound_emails_org_id_received_at_idx').on(t.orgId, t.receivedAt),
    index('inbound_emails_org_id_from_address_received_at_idx').on(
      t.orgId,
      t.fromAddress,
      t.receivedAt,
    ),
    check('inbound_emails_purpose_check', sql`${t.purpose} in ('documents','bank_notice')`),
    check(
      'inbound_emails_spam_verdict_check',
      sql`${t.spamVerdict} in ('pass','spoof_fail','unknown')`,
    ),
  ],
);

export const sourceFiles = pgTable(
  'source_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sha256: char('sha256', { length: 64 }).notNull(),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    originalFilename: text('original_filename'),
    filenameNfc: text('filename_nfc'),
    pageCount: integer('page_count'),
    hasTextLayer: boolean('has_text_layer'),
    hasEmbeddedIsdoc: boolean('has_embedded_isdoc'),
    textQuality: numeric('text_quality', { precision: 4, scale: 3 }),
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
    phash: bit('phash', { dimensions: 64 }),
    isEncrypted: boolean('is_encrypted').notNull().default(false),
    pdfActiveContent: boolean('pdf_active_content').notNull().default(false),
    scanStatus: text('scan_status').notNull().default('pending'),
    origin: text('origin').notNull().default('original'),
    inboundEmailId: uuid('inbound_email_id').references(() => inboundEmails.id),
    uploadedBy: uuid('uploaded_by').references(() => authUsers.id),
    channel: text('channel').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('source_files_org_id_sha256_key').on(t.orgId, t.sha256),
    index('source_files_org_id_idx').on(t.orgId).where(sql`${t.phash} is not null`),
    check(
      'source_files_scan_status_check',
      sql`${t.scanStatus} in ('pending','clean','infected','error')`,
    ),
    check(
      'source_files_origin_check',
      sql`${t.origin} in ('original','email_body_render','camera_bundle')`,
    ),
    check(
      'source_files_channel_check',
      sql`${t.channel} in ('upload','email','camera','api','import')`,
    ),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sourceFileId: uuid('source_file_id').references(() => sourceFiles.id),
    entryMode: text('entry_mode').notNull().default('captured'),
    substituteReason: text('substitute_reason'),
    importId: uuid('import_id'),
    importRow: integer('import_row'),
    pageFrom: integer('page_from').notNull().default(1),
    pageTo: integer('page_to'),
    uploadBatchId: uuid('upload_batch_id'),
    status: documentStatusEnum('status').notNull().default('received'),
    stageVersion: jsonb('stage_version').notNull().default({}),
    class: documentClassEnum('class').notNull().default('unknown'),
    classConfidence: numeric('class_confidence', { precision: 4, scale: 3 }),
    classSource: fieldSourceEnum('class_source'),
    classRuleIds: text('class_rule_ids').array().notNull().default([]),
    direction: directionEnum('direction'),
    taxDocStatus: taxDocStatusEnum('tax_doc_status').notNull().default('unknown'),
    partnerId: uuid('partner_id').references(() => partners.id),
    partnerSnapshot: jsonb('partner_snapshot'),
    buyerSnapshot: jsonb('buyer_snapshot'),
    documentNumber: text('document_number'),
    variableSymbol: text('variable_symbol'),
    constantSymbol: text('constant_symbol'),
    specificSymbol: text('specific_symbol'),
    orderNumber: text('order_number'),
    issueDate: date('issue_date'),
    duzp: date('duzp'),
    receivedDate: date('received_date'),
    dueDate: date('due_date'),
    servicePeriodFrom: date('service_period_from'),
    servicePeriodTo: date('service_period_to'),
    vatPointDate: date('vat_point_date'),
    currency: char('currency', { length: 3 }).notNull().default('CZK'),
    fxRate: numeric('fx_rate', { precision: 12, scale: 6 }),
    fxRateDate: date('fx_rate_date'),
    totalNet: numeric('total_net', { precision: 15, scale: 2 }),
    totalVat: numeric('total_vat', { precision: 15, scale: 2 }),
    totalGross: numeric('total_gross', { precision: 15, scale: 2 }),
    printedTotal: numeric('printed_total', { precision: 15, scale: 2 }),
    rounding: numeric('rounding', { precision: 15, scale: 2 }).notNull().default('0'),
    amountDue: numeric('amount_due', { precision: 15, scale: 2 }),
    paymentMethod: text('payment_method'),
    payToAccount: jsonb('pay_to_account'),
    isPaidPerDocument: boolean('is_paid_per_document'),
    paidAt: date('paid_at'),
    businessFlag: text('business_flag').notNull().default('business'),
    summaryCs: text('summary_cs'),
    semanticDedupeExempt: boolean('semantic_dedupe_exempt').notNull().default(false),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    finalizedBy: uuid('finalized_by').references(() => authUsers.id),
    revision: integer('revision').notNull().default(1),
    retentionUntil: date('retention_until'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('documents_org_id_status_idx').on(t.orgId, t.status),
    index('documents_org_id_upload_batch_id_idx').on(t.orgId, t.uploadBatchId),
    index('documents_org_id_issue_date_idx').on(t.orgId, t.issueDate),
    check('documents_entry_mode_check', sql`${t.entryMode} in ('captured','manual','imported')`),
    check(
      'documents_substitute_reason_check',
      sql`${t.substituteReason} in ('lost','damaged','never_issued','other')`,
    ),
    check(
      'documents_payment_method_check',
      sql`${t.paymentMethod} in ('bank_transfer','card','cash','cod','platform_offset','other')`,
    ),
    check(
      'documents_business_flag_check',
      sql`${t.businessFlag} in ('business','personal','mixed','unknown')`,
    ),
    check(
      'documents_source_required',
      sql`${t.entryMode} <> 'captured' or ${t.sourceFileId} is not null`,
    ),
  ],
);

export const documentRevisions = pgTable(
  'document_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    changedBy: uuid('changed_by').references(() => authUsers.id),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('document_revisions_document_id_revision_key').on(t.documentId, t.revision),
    index('document_revisions_org_id_document_id_idx').on(t.orgId, t.documentId),
  ],
);

/** Users only read it (05 §10.2); the worker writes it. */
export const ingestItems = pgTable(
  'ingest_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id'),
    origin: text('origin').notNull(),
    channel: text('channel').notNull(),
    parentItemId: uuid('parent_item_id').references((): AnyPgColumn => ingestItems.id, {
      onDelete: 'cascade',
    }),
    bundleId: uuid('bundle_id'),
    bundleIndex: smallint('bundle_index'),
    companionOfItemId: uuid('companion_of_item_id').references((): AnyPgColumn => ingestItems.id),
    inboundEmailId: uuid('inbound_email_id').references(() => inboundEmails.id, {
      onDelete: 'cascade',
    }),
    uploadedBy: uuid('uploaded_by').references(() => authUsers.id),
    originalFilename: text('original_filename'),
    filenameNfc: text('filename_nfc'),
    declaredMime: text('declared_mime'),
    sniffedFormat: text('sniffed_format'),
    sniffMismatch: boolean('sniff_mismatch').notNull().default(false),
    byteSize: bigint('byte_size', { mode: 'number' }),
    sha256: char('sha256', { length: 64 }),
    bodySha256: char('body_sha256', { length: 64 }),
    emailDisposition: text('email_disposition'),
    emailContentId: text('email_content_id'),
    stagingPath: text('staging_path'),
    state: text('state').notNull().default('pending_upload'),
    stateReason: text('state_reason'),
    sourceFileId: uuid('source_file_id').references(() => sourceFiles.id),
    duplicateOfDocumentId: uuid('duplicate_of_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    duplicateInTrash: boolean('duplicate_in_trash').notNull().default(false),
    nearDuplicateCandidateId: uuid('near_duplicate_candidate_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ingest_items_org_id_batch_id_idx').on(t.orgId, t.batchId),
    index('ingest_items_org_id_state_idx')
      .on(t.orgId, t.state)
      .where(sql`${t.state} in ('pending_upload','uploaded','processing')`),
    index('ingest_items_org_id_body_sha256_idx')
      .on(t.orgId, t.bodySha256)
      .where(sql`${t.bodySha256} is not null`),
    index('ingest_items_org_id_inbound_email_id_idx').on(t.orgId, t.inboundEmailId),
    check(
      'ingest_items_origin_check',
      sql`${t.origin} in ('upload','email_attachment','email_body','archive_member','camera_bundle','spreadsheet_import')`,
    ),
    check(
      'ingest_items_channel_check',
      sql`${t.channel} in ('upload','email','camera','api','import')`,
    ),
    check(
      'ingest_items_email_disposition_check',
      sql`${t.emailDisposition} in ('attachment','inline')`,
    ),
    check(
      'ingest_items_state_check',
      sql`${t.state} in ('pending_upload','uploaded','processing','accepted','exact_duplicate','companion','expanded','bundled','ignored','unsupported','too_large','infected','encrypted','quarantined','failed','expired')`,
    ),
  ],
);

export const expectedDocuments = pgTable(
  'expected_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    partnerId: uuid('partner_id').references(() => partners.id),
    expectedAmount: numeric('expected_amount', { precision: 15, scale: 2 }),
    currency: char('currency', { length: 3 }).notNull().default('CZK'),
    expectedBy: date('expected_by').notNull(),
    state: text('state').notNull().default('open'),
    fulfilledByDocumentId: uuid('fulfilled_by_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('expected_documents_source_document_id_kind_key').on(t.sourceDocumentId, t.kind),
    index('expected_documents_org_id_state_expected_by_idx').on(t.orgId, t.state, t.expectedBy),
    check('expected_documents_kind_check', sql`${t.kind} in ('invoice','final_invoice')`),
    check(
      'expected_documents_state_check',
      sql`${t.state} in ('open','fulfilled','dismissed','expired')`,
    ),
  ],
);
