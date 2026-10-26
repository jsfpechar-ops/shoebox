import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §6 import tables (migration 0030): import_mappings, spreadsheet_imports.
 * `source_file_id` is a fresh id that the RLS suite's `ensureParentRows()` turns into a source file.
 */

/** 64 hex digits derived from the id, so (org_id, kind, money_account_id, header_signature) stays unique. */
function signatureOf(id: string): string {
  return Number.parseInt(id.slice(-12), 16).toString(16).padStart(64, '0');
}

export const importMappingFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    kind: 'documents',
    header_signature: signatureOf(id),
    mapping: { issue_date: 0, total_gross: 1 },
    ...overrides,
  };
};

export const spreadsheetImportFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  source_file_id: ctx.ids.next(),
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const importFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['import_mappings', importMappingFactory],
  ['spreadsheet_imports', spreadsheetImportFactory],
];
