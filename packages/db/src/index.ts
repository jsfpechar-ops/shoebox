export const packageName = '@shoebox/db' as const;
export * from './document-reading';
export * from './document-pages';
export { createDbPing, type DbPing } from './health';
export { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, runMigrations } from './migrate';
export { type RateLimitDb, rateLimitHit } from './rate-limit';
export * from './rls-catalog';
export * from './schema/document-details';
export * from './schema/document-pages';
export * from './schema/documents';
export * from './schema/enums';
export * from './schema/partners';
export * from './schema/platform';
export * from './schema/tenancy';
export {
  closeDb,
  configureDb,
  createTenantDb,
  type Db,
  type DbConnections,
  type DbSchema,
  SERVICE_ROLE_REASONS,
  type ServiceRoleReason,
  type ServiceTx,
  type TenantDb,
  type TenantTx,
  type Tx,
  withServiceRole,
  withTenant,
} from './tenant';
