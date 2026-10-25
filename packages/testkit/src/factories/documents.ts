import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §4 core tables (migration 0005): inbound_emails, source_files, documents,
 * document_revisions, ingest_items, expected_documents. Columns are snake_case as in SQL. A child
 * row points its foreign key at a fresh id from `ctx.ids`; the RLS suite's `ensureParentRows()`
 * creates that parent with the parent's factory. Array columns stay at their SQL default.
 */

/** The counter part of an id from `createIdGenerator` (its last 12 hex digits). */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(-12), 16);
}

/** 64 hex digits derived from the id, so (org_id, sha256) stays unique per build. */
function sha256Of(id: string): string {
  return counterOf(id).toString(16).padStart(64, '0');
}

export const inboundEmailFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    message_id: `<${counterOf(id)}@example.test>`,
    from_address: 'faktury@example.test',
    received_at: new Date(ctx.clock.now()).toISOString(),
    eml_path: `${ctx.orgId}/emails/${id}.eml`,
    ...overrides,
  };
};

export const sourceFileFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    sha256: sha256Of(id),
    storage_path: `${ctx.orgId}/files/${id}.pdf`,
    mime_type: 'application/pdf',
    byte_size: 1024,
    channel: 'upload',
    ...overrides,
  };
};

/** `documents`: a manual entry (no source file), nothing that the dedupe index would key on. */
export const documentFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  entry_mode: 'manual',
  issue_date: '2026-01-15',
  currency: 'CZK',
  ...overrides,
});

export const documentRevisionFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  revision: 1,
  snapshot: {},
  ...overrides,
});

export const ingestItemFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    origin: 'upload',
    channel: 'upload',
    original_filename: `scan-${counterOf(id)}.pdf`,
    ...overrides,
  };
};

export const expectedDocumentFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  source_document_id: ctx.ids.next(),
  kind: 'invoice',
  expected_by: '2026-02-28',
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const documentFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['inbound_emails', inboundEmailFactory],
  ['source_files', sourceFileFactory],
  ['documents', documentFactory],
  ['document_revisions', documentRevisionFactory],
  ['ingest_items', ingestItemFactory],
  ['expected_documents', expectedDocumentFactory],
];
