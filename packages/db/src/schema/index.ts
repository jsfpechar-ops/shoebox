// Every Drizzle table in one module: `DbSchema` in tenant.ts is `typeof import('./schema/index')`,
// so db.query.<table> knows each migration slice. Each slice adds its `export * from './<area>'`.
export * from './document-details';
export * from './document-pages';
export * from './documents';
export * from './enums';
export * from './filings';
export * from './imports';
export * from './ledgers';
export * from './obligations';
export * from './partners';
export * from './platform';
export * from './reserve';
export * from './tenancy';
