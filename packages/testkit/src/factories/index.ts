import { documentDetailFactories } from './document-details';
import { documentFactories } from './documents';
import { partnerFactories } from './partners';
import { platformFactories } from './platform';
import { createFactoryRegistry, type FactoryRegistry, type TenantFactory } from './registry';
import { tenancyFactories } from './tenancy';

export {
  documentFieldFactory,
  documentLineFactory,
  documentLinkFactory,
  documentVatSummaryFactory,
  extractionRunFactory,
  reviewQuestionFactory,
  validationResultFactory,
} from './document-details';
export {
  documentFactory,
  documentRevisionFactory,
  expectedDocumentFactory,
  inboundEmailFactory,
  ingestItemFactory,
  sourceFileFactory,
} from './documents';
export { partnerBankAccountFactory, partnerFactory, vendorProfileFactory } from './partners';
export { auditLogFactory, llmUsageDailyFactory, privacyRequestFactory } from './platform';
export type { FactoryContext, FactoryRegistry, Row, TenantFactory } from './registry';
export { createFactoryRegistry } from './registry';
export { membershipFactory, organizationFactory, taxpayerProfileFactory } from './tenancy';

/**
 * The one registry of tenant-table factories that the RLS suite (packages/db/test/rls) iterates.
 * Each migration slice adds `src/factories/<area>.ts` exporting its factories and registers them
 * below (a tenant table without a factory fails the RLS meta-test). tenancy.ts covers 0002,
 * partners.ts covers 0004, documents.ts covers 0005, document-details.ts covers 0006,
 * platform.ts covers 0007.
 */
export const tenantFactories: FactoryRegistry = createFactoryRegistry();
for (const [table, factory] of [
  ...tenancyFactories,
  ...partnerFactories,
  ...documentFactories,
  ...documentDetailFactories,
  ...platformFactories,
]) {
  tenantFactories.define(table, factory);
}

/** The factory of a tenant table from the shared registry; throws for an unknown table. */
export function factoryFor(table: string): TenantFactory {
  return tenantFactories.factoryFor(table);
}
