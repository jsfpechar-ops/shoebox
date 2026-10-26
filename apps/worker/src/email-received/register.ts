import { docSplitJob, emailReceivedJob } from '@shoebox/pipeline';
import { createSupabaseBlobStore, type Logger } from '@shoebox/platform';
import { finishInboundEmail, insertEmailAttachment, loadInboundEmail } from '@shoebox/db';
import type { JobRegistry } from '../registry';
import { createEmailReceivedHandler } from './handler';

export function registerEmailReceived(
  registry: Pick<JobRegistry, 'registerTenant' | 'enqueue'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    logger.warn(
      { missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !env[name]) },
      'email.received not registered',
    );
    return false;
  }
  registry.registerTenant(
    emailReceivedJob,
    createEmailReceivedHandler({
      blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }),
      store: {
        load: loadInboundEmail,
        finish: finishInboundEmail,
        insertAttachment: insertEmailAttachment,
      },
      enqueueSplit: async (orgId, batchId) => {
        await registry.enqueue(docSplitJob, { orgId, batchId });
      },
    }),
  );
  logger.info({}, 'email.received registered');
  return true;
}
