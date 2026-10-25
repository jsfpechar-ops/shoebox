// Drizzle mirror of migrations/0006_documents_detail.sql (05 §4 Ingestion and documents, the seven
// detail tables). The SQL file is the source of truth for DDL; this file gives typed queries. The
// partial index, the accountant trigger, the RLS policies and the grants exist only in SQL. Money
// columns are numeric(15,2), quantities numeric(15,4), percentages numeric(5,2): strings in
// Drizzle, never floats.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { documents } from './documents';
import {
  docLinkKindEnum,
  fieldSourceEnum,
  lineTypeEnum,
  severityEnum,
  validationStateEnum,
  vatRateTypeEnum,
  vatTreatmentEnum,
} from './enums';
import { categories } from './partners';
import { authUsers, organizations } from './tenancy';

export const documentLinks = pgTable(
  'document_links',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    fromDocumentId: uuid('from_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    toDocumentId: uuid('to_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: docLinkKindEnum('kind').notNull(),
    note: text('note'),
    createdBy: text('created_by').notNull().default('system'),
  },
  (t) => [
    primaryKey({
      name: 'document_links_pkey',
      columns: [t.fromDocumentId, t.toDocumentId, t.kind],
    }),
    index('document_links_org_id_to_document_id_idx').on(t.orgId, t.toDocumentId),
  ],
);

export const documentLines = pgTable(
  'document_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    lineType: lineTypeEnum('line_type').notNull().default('item'),
    description: text('description'),
    code: text('code'),
    quantity: numeric('quantity', { precision: 15, scale: 4 }),
    unit: text('unit'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 4 }),
    net: numeric('net', { precision: 15, scale: 2 }),
    vat: numeric('vat', { precision: 15, scale: 2 }),
    gross: numeric('gross', { precision: 15, scale: 2 }),
    vatRateType: vatRateTypeEnum('vat_rate_type').notNull().default('none'),
    vatRatePct: numeric('vat_rate_pct', { precision: 5, scale: 2 }),
    vatTreatment: vatTreatmentEnum('vat_treatment'),
    categoryCode: text('category_code').references(() => categories.code),
    businessSharePct: numeric('business_share_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('100'),
    deductibility: text('deductibility'),
    coveredByDocumentId: uuid('covered_by_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    rcCommodityCode: text('rc_commodity_code'),
    classificationSource: fieldSourceEnum('classification_source'),
    classificationConfidence: numeric('classification_confidence', { precision: 4, scale: 3 }),
  },
  (t) => [
    unique('document_lines_document_id_position_key').on(t.documentId, t.position),
    index('document_lines_org_id_document_id_idx').on(t.orgId, t.documentId),
    check(
      'document_lines_deductibility_check',
      sql`${t.deductibility} in ('deductible','non_deductible','partially_deductible','not_applicable')`,
    ),
  ],
);

export const documentVatSummary = pgTable(
  'document_vat_summary',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    vatRateType: vatRateTypeEnum('vat_rate_type').notNull(),
    vatRatePct: numeric('vat_rate_pct', { precision: 5, scale: 2 }).notNull(),
    base: numeric('base', { precision: 15, scale: 2 }).notNull(),
    vat: numeric('vat', { precision: 15, scale: 2 }).notNull(),
    baseForeign: numeric('base_foreign', { precision: 15, scale: 2 }),
    vatForeign: numeric('vat_foreign', { precision: 15, scale: 2 }),
  },
  (t) => [
    primaryKey({
      name: 'document_vat_summary_pkey',
      columns: [t.documentId, t.vatRateType, t.vatRatePct],
    }),
  ],
);

export const documentFields = pgTable(
  'document_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    valueText: text('value_text'),
    valueJson: jsonb('value_json'),
    source: fieldSourceEnum('source').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    page: integer('page'),
    bbox: numeric('bbox').array(),
    extractionRunId: uuid('extraction_run_id'),
    isCurrent: boolean('is_current').notNull().default(true),
    setBy: uuid('set_by').references(() => authUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_fields_document_id_field_key_idx')
      .on(t.documentId, t.fieldKey)
      .where(sql`${t.isCurrent}`),
  ],
);

export const extractionRuns = pgTable(
  'extraction_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    method: fieldSourceEnum('method').notNull(),
    model: text('model'),
    promptVersion: text('prompt_version'),
    attempt: smallint('attempt').notNull().default(1),
    inputMode: text('input_mode'),
    imageCount: smallint('image_count'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 5 }),
    escalationReasons: text('escalation_reasons').array().notNull().default([]),
    latencyMs: integer('latency_ms'),
    ok: boolean('ok').notNull(),
    error: text('error'),
    rawResponsePath: text('raw_response_path'),
    batchId: uuid('batch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('extraction_runs_org_id_document_id_idx').on(t.orgId, t.documentId),
    check(
      'extraction_runs_stage_check',
      sql`${t.stage} in ('split','classify','extract','categorize')`,
    ),
    check(
      'extraction_runs_input_mode_check',
      sql`${t.inputMode} in ('text+thumb','text+images','images','none')`,
    ),
  ],
);

export const validationResults = pgTable(
  'validation_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    severity: severityEnum('severity').notNull(),
    state: validationStateEnum('state').notNull().default('open'),
    fieldKeys: text('field_keys').array().notNull().default([]),
    params: jsonb('params').notNull().default({}),
    dismissReason: text('dismiss_reason'),
    resolvedBy: uuid('resolved_by').references(() => authUsers.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('validation_results_document_id_rule_id_key').on(t.documentId, t.ruleId),
    index('validation_results_org_id_state_severity_idx').on(t.orgId, t.state, t.severity),
  ],
);

export const reviewQuestions = pgTable(
  'review_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id'),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    answer: jsonb('answer'),
    answeredBy: uuid('answered_by').references(() => authUsers.id),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('review_questions_org_id_answered_at_idx').on(t.orgId, t.answeredAt)],
);
