import {
  findOrCreateMoneyAccount,
  findStatementImport,
  insertStatementImport,
  insertStatementTransactions,
  loadStatementSource,
} from '@shoebox/db';
import { bankImportStatementJob } from '@shoebox/pipeline';
import { createSupabaseBlobStore, type Logger } from '@shoebox/platform';
import type { JobRegistry } from '../registry';
import { createBankImportHandler } from './handler';

export function registerBankImport(
  registry: Pick<JobRegistry, 'registerTenant'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    logger.warn(
      { missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !env[name]) },
      'bank.import.statement not registered',
    );
    return false;
  }
  registry.registerTenant(
    bankImportStatementJob,
    createBankImportHandler({
      blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }),
      store: {
        loadSource: loadStatementSource,
        findImport: findStatementImport,
        findOrCreateAccount: findOrCreateMoneyAccount,
        insertImport: insertStatementImport,
        insertTransactions: insertStatementTransactions,
      },
    }),
  );
  logger.info({}, 'bank.import.statement registered');
  return true;
}
