import { createAnthropicClient } from '@shoebox/extraction';
import { docExtractJob, docSplitJob } from '@shoebox/pipeline';
import { createSupabaseBlobStore, type Logger } from '@shoebox/platform';
import type { JobRegistry } from '../registry';
import { createDocSplitHandler } from './handler';

const REQUIRED = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export function registerDocSplit(
  registry: Pick<JobRegistry, 'registerTenant' | 'enqueue'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  const apiKey = env.ANTHROPIC_API_KEY;
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !url || !serviceKey) {
    logger.warn({ missing: REQUIRED.filter((name) => !env[name]) }, 'doc.split not registered');
    return false;
  }
  const model = env.SHOEBOX_LLM_MODEL || 'claude-haiku-5-5';
  registry.registerTenant(
    docSplitJob,
    createDocSplitHandler({
      llm: createAnthropicClient({ apiKey, maxAttempts: 2 }),
      blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }),
      model,
      enqueueRead: (orgId, documentId) =>
        registry.enqueue(docExtractJob, { orgId, documentId }, { startAfterSeconds: 5 }),
    }),
  );
  logger.info({ model }, 'doc.split registered');
  return true;
}
