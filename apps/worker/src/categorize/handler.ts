import {
  type CategorizationWrite,
  loadDocumentForCategorize,
  saveCategorization,
} from '@shoebox/db';
import {
  type Clock,
  createCzRules,
  pragueToday,
  type RULE_SCHEMAS,
  type RuleResolver,
} from '@shoebox/domain';
import { buildCategorizeRequest, type LlmClient, runCategorize } from '@shoebox/extraction';
import {
  type DocCategorizePayload,
  docCategorizeJob,
  type LedgerRebuildDocumentPayload,
  ledgerRebuildDocumentJob,
  type TenantJobDefinition,
} from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { TenantHandler } from '../registry';
import { type PlanResult, planCategorization } from './plan';

export interface CategorizeStore {
  readonly load: typeof loadDocumentForCategorize;
  readonly save: typeof saveCategorization;
}

export const dbCategorizeStore: CategorizeStore = {
  load: loadDocumentForCategorize,
  save: saveCategorization,
};

export type Enqueue = <P extends { orgId: string }>(
  def: TenantJobDefinition<P>,
  payload: P,
) => Promise<string | null>;

export interface DocCategorizeDeps {
  readonly llm: LlmClient;
  readonly model: string;
  readonly clock: Clock;
  readonly rules?: RuleResolver<typeof RULE_SCHEMAS>; // default createCzRules()
  readonly enqueue: Enqueue;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
  readonly store?: CategorizeStore; // default dbCategorizeStore
}

/** Statuses a categorize job never touches: the document is still being read, failed, a duplicate, or immutable. */
export const SKIPPED_STATUSES: readonly string[] = [
  'received',
  'splitting',
  'classifying',
  'extracting',
  'failed',
  'duplicate',
  'supporting',
  'finalized',
];

export function createDocCategorizeHandler(
  deps: DocCategorizeDeps,
): TenantHandler<DocCategorizePayload> {
  const store = deps.store ?? dbCategorizeStore;
  const rules = deps.rules ?? createCzRules();

  return async (payload, ctx) => {
    const doc = await store.load(ctx.tx, payload.documentId);
    if (doc === null || SKIPPED_STATUSES.includes(doc.status)) {
      return;
    }
    // A job for an older revision of the document: the newer revision has its own job.
    if (payload.revision !== doc.revision) {
      return;
    }

    const today = pragueToday(deps.clock);
    const planInput = {
      doc,
      rules,
      today,
      model: deps.model,
      categorizeVersion: docCategorizeJob.version,
    } as const;

    const first = planCategorization({ ...planInput, llm: null });
    let final: PlanResult = first;
    let runs: CategorizationWrite['runs'] = [];

    if (first.needsLlm && first.llmRequest) {
      const built = buildCategorizeRequest(first.llmRequest);
      // A thrown provider error propagates: pg-boss retries the job.
      const result = await runCategorize(deps.llm, built);
      runs = result.attempts.map((a) => ({
        model: a.model,
        promptVersion: a.promptVersion,
        attempt: a.attempt,
        inputTokens: a.usage.inputTokens,
        outputTokens: a.usage.outputTokens,
        cacheReadTokens: a.usage.cacheReadInputTokens,
        cacheWriteTokens: a.usage.cacheCreationInputTokens,
        latencyMs: a.latencyMs,
        ok: a.ok,
        error: a.error,
      }));
      if (result.ok) {
        final = planCategorization({ ...planInput, llm: result.output });
      } else {
        // Two invalid answers: the fallback plan is saved without LLM output, both attempts stay recorded; the job succeeds.
        final = first;
      }
    }

    await store.save(ctx.tx, { ...final.write, runs });

    deps.logger.info(
      {
        event: 'document.categorized',
        documentId: doc.id,
        status: final.write.status,
        model: deps.model,
        lowConfidenceLines: final.event.lowConfidenceLines,
        questions: final.event.questions,
      },
      'document.categorized',
    );

    const rebuild: LedgerRebuildDocumentPayload = {
      orgId: doc.orgId,
      documentId: doc.id,
      reason: 'categorized',
      nonce: Date.now(),
    };
    try {
      await deps.enqueue(ledgerRebuildDocumentJob, rebuild);
    } catch {
      // The nightly ledger.verify catches the gap; the categorization itself is saved.
      deps.logger.warn(
        { documentId: doc.id, job: ledgerRebuildDocumentJob.name },
        'ledger rebuild enqueue failed',
      );
    }
  };
}
