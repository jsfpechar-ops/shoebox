import { importSpreadsheetRunJob } from '@shoebox/pipeline';
import { createSupabaseBlobStore, type Logger } from '@shoebox/platform';
import type { JobRegistry } from '../registry';
import { createImportRunHandler } from './handler';

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export function registerImportRun(
  registry: Pick<JobRegistry, 'registerTenant' | 'enqueue'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    logger.warn(
      { missing: REQUIRED.filter((name) => !env[name]) },
      'import.spreadsheet.run not registered',
    );
    return false;
  }
  registry.registerTenant(
    importSpreadsheetRunJob,
    createImportRunHandler({
      blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }),
      clock: { now: () => Date.now() },
      enqueueNext: (payload) =>
        registry.enqueue(importSpreadsheetRunJob, payload, { startAfterSeconds: 1 }),
      logger,
    }),
  );
  logger.info({}, 'import.spreadsheet.run registered');
  return true;
}
