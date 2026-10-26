import { createAnthropicClient } from '@shoebox/extraction';
import { docCategorizeJob } from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { JobRegistry } from '../registry';
import { createDocCategorizeHandler } from './handler';

export function registerDocCategorize(
  registry: Pick<JobRegistry, 'registerTenant' | 'enqueue'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn({ missing: ['ANTHROPIC_API_KEY'] }, 'doc.categorize not registered');
    return false;
  }
  const model = env.SHOEBOX_LLM_MODEL || 'claude-haiku-5-5';
  registry.registerTenant(
    docCategorizeJob,
    createDocCategorizeHandler({
      llm: createAnthropicClient({ apiKey }),
      model,
      clock: { now: () => Date.now() },
      enqueue: (def, payload) => registry.enqueue(def, payload),
      logger,
    }),
  );
  logger.info({ model }, 'doc.categorize registered');
  return true;
}
