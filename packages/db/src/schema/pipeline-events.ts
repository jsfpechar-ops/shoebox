// Drizzle mirror of migrations/0063_pipeline_events.sql (05 §4). The SQL file is the source of truth;
// the trigger app.log_document_status(), audit_document() v2, the RLS policies and grants exist only in SQL.
import { sql } from 'drizzle-orm';
import { bigserial, index, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { extractionRuns } from './document-details';
import { documents } from './documents';
import { organizations } from './tenancy';

export const PIPELINE_EVENT_KINDS = [
  'status',
  'read',
  'read_failed',
  'user_edit',
  'user_trash',
  'user_restore',
  'user_manual',
  'user_answer',
] as const;
export type PipelineEventKind = (typeof PIPELINE_EVENT_KINDS)[number];

export const pipelineEvents = pgTable(
  'pipeline_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').$type<PipelineEventKind>().notNull(),
    code: text('code'),
    detail: text('detail'),
    fromStatus: text('from_status'),
    fieldKey: text('field_key'),
    extractionRunId: uuid('extraction_run_id').references(() => extractionRuns.id, {
      onDelete: 'set null',
    }),
    method: text('method'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    attempt: smallint('attempt'),
    blocking: text('blocking').array().notNull().default(sql`'{}'`),
    warnings: text('warnings').array().notNull().default(sql`'{}'`),
  },
  (t) => [
    index('pipeline_events_org_id_at_idx').on(t.orgId, t.at),
    index('pipeline_events_document_id_at_idx').on(t.documentId, t.at),
    index('pipeline_events_kind_at_idx').on(t.kind, t.at),
  ],
);
