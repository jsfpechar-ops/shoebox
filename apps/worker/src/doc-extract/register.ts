import { createAnthropicClient } from '@shoebox/extraction';
import { docExtractJob } from '@shoebox/pipeline';
import { createSupabaseBlobStore, type Logger } from '@shoebox/platform';
import type { JobRegistry } from '../registry';
import { createDocExtractHandler } from './handler';

const REQUIRED = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export function registerDocExtract(
  registry: Pick<JobRegistry, 'registerTenant'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  const apiKey = env.ANTHROPIC_API_KEY;
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !url || !serviceKey) {
    logger.warn({ missing: REQUIRED.filter((name) => !env[name]) }, 'doc.extract not registered');
    return false;
  }
  const model = env.SHOEBOX_LLM_MODEL || 'claude-haiku-5-5';
  registry.registerTenant(
    docExtractJob,
    createDocExtractHandler({
      llm: createAnthropicClient({ apiKey }),
      blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }),
      model,
      clock: { now: () => Date.now() },
    }),
  );
  logger.info({ model }, 'doc.extract registered');
  return true;
}
