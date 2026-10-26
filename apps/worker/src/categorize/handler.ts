import {
  type CategorizationWrite,
  type CategorizeVendorRow,
  type DocumentForCategorize,
  insertRelearnQuestion,
  loadDocumentForCategorize,
  openDocumentsOfPartner,
  saveCategorization,
  saveVendorProfile,
  type TenantTx,
} from '@shoebox/db';
import {
  type Clock,
  createCzRules,
  parseClassificationRules,
  parseLegalDate,
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
import { parseQuestionPayload } from './answers';
import { type PlanResult, planCategorization } from './plan';
import {
  applyRelearnAnswer,
  confirmationOf,
  emptyProfile,
  learnVendorProfile,
  relearnPayload,
  type VendorObservation,
  type VendorProfileState,
} from './vendor-memory';

export interface CategorizeStore {
  readonly load: typeof loadDocumentForCategorize;
  readonly save: typeof saveCategorization;
  readonly saveVendorProfile?: typeof saveVendorProfile;
  readonly openDocumentsOfPartner?: typeof openDocumentsOfPartner;
  readonly insertRelearnQuestion?: typeof insertRelearnQuestion;
}

export const dbCategorizeStore: CategorizeStore = {
  load: loadDocumentForCategorize,
  save: saveCategorization,
  saveVendorProfile,
  openDocumentsOfPartner,
  insertRelearnQuestion,
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

    const learning = vendorLearningOf(store);
    if (learning !== null && doc.partnerId !== null && doc.issueDate !== null) {
      await learnVendor({
        tx: ctx.tx,
        learning,
        doc,
        partnerId: doc.partnerId,
        trigger: payload.trigger,
        write: final.write,
        dominantLineId: final.event.dominantLineId,
        minConfirmations: parseClassificationRules(rules.at(parseLegalDate(doc.issueDate)))
          .vendorMemoryMinConfirmations,
        now: new Date(deps.clock.now()),
        enqueue: deps.enqueue,
        logger: deps.logger,
      });
    }

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

interface VendorLearning {
  readonly saveVendorProfile: typeof saveVendorProfile;
  readonly openDocumentsOfPartner: typeof openDocumentsOfPartner;
  readonly insertRelearnQuestion: typeof insertRelearnQuestion;
}

function vendorLearningOf(store: CategorizeStore): VendorLearning | null {
  const {
    saveVendorProfile: save,
    openDocumentsOfPartner: open,
    insertRelearnQuestion: insert,
  } = store;
  if (save === undefined || open === undefined || insert === undefined) return null;
  return { saveVendorProfile: save, openDocumentsOfPartner: open, insertRelearnQuestion: insert };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stateOf(vendor: CategorizeVendorRow | null): VendorProfileState {
  if (vendor === null) return emptyProfile();
  return {
    defaultCategoryCode: vendor.defaultCategoryCode,
    defaultVatTreatment: vendor.defaultVatTreatment,
    defaultBusinessFlag: vendor.defaultBusinessFlag,
    confirmations: vendor.confirmations,
    pinned: vendor.pinned,
    multiCategory: vendor.multiCategory,
    extractionHints: isRecord(vendor.extractionHints) ? vendor.extractionHints : {},
    lastConfirmedAt: null,
  };
}

function answerValueOf(answer: unknown): string | null {
  if (!isRecord(answer) || typeof answer.value !== 'string') return null;
  return answer.value;
}

/** §4.7 learning step: relearn answers of the run they triggered, then one confirmation of the dominant line. */
async function learnVendor(input: {
  readonly tx: TenantTx;
  readonly learning: VendorLearning;
  readonly doc: DocumentForCategorize;
  readonly partnerId: string;
  readonly trigger: string;
  readonly write: Omit<CategorizationWrite, 'runs'>;
  readonly dominantLineId: string;
  readonly minConfirmations: number;
  readonly now: Date;
  readonly enqueue: Enqueue;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
}): Promise<void> {
  const { tx, learning, doc, partnerId, now } = input;
  const orgId = doc.orgId;
  const before = stateOf(doc.vendor);
  let state = before;
  let changed = false;

  if (input.trigger === 'question_answered') {
    for (const row of doc.questions) {
      if (row.kind !== 'relearn_vendor' || row.answeredAt === null) continue;
      const payload = parseQuestionPayload(row.payload);
      if (payload?.params?.partner_id !== partnerId) continue;
      const newCode = payload.params?.new_code;
      const value = answerValueOf(row.answer);
      if (typeof newCode !== 'string' || (value !== 'this_only' && value !== 'from_now_on'))
        continue;
      state = applyRelearnAnswer(state, newCode, value);
      state = { ...state, lastConfirmedAt: now };
      changed = true;
    }
  }

  const obs: VendorObservation | null = confirmationOf(
    input.trigger,
    doc,
    input.write,
    input.dominantLineId,
  );
  if (obs !== null) {
    const learned = learnVendorProfile(state, obs, input.minConfirmations, now);
    state = learned.profile;
    changed = changed || learned.changed;
    if (learned.relearn !== null) {
      await learning.insertRelearnQuestion(
        tx,
        orgId,
        doc.id,
        relearnPayload(
          partnerId,
          doc.partner?.name ?? '',
          learned.relearn.oldCode,
          learned.relearn.newCode,
          learned.relearn.count,
        ),
      );
    }
  }

  const reachedThreshold =
    (before.confirmations < input.minConfirmations &&
      state.confirmations >= input.minConfirmations) ||
    (!before.pinned && state.pinned);
  if (!changed) return;

  const subjectHint =
    typeof state.extractionHints.subject_cs === 'string' ? state.extractionHints.subject_cs : null;
  await learning.saveVendorProfile(tx, {
    orgId,
    partnerId,
    defaultCategoryCode: state.defaultCategoryCode,
    defaultVatTreatment: state.defaultVatTreatment,
    defaultBusinessFlag: state.defaultBusinessFlag,
    confirmations: state.confirmations,
    pinned: state.pinned,
    multiCategory: state.multiCategory,
    subjectHint,
    lastConfirmedAt: state.lastConfirmedAt,
  });
  input.logger.info(
    {
      event: 'vendor_profile.changed',
      orgId,
      documentId: doc.id,
      partnerId,
      confirmations: state.confirmations,
    },
    'vendor_profile.changed',
  );

  if (!reachedThreshold) return;
  const open = await learning.openDocumentsOfPartner(tx, orgId, partnerId, doc.id);
  for (const other of open) {
    try {
      await input.enqueue(docCategorizeJob, {
        orgId,
        documentId: other.id,
        revision: other.revision,
        trigger: 'vendor_memory_changed',
      });
    } catch {
      input.logger.warn(
        { documentId: other.id, job: docCategorizeJob.name },
        'categorize re-queue enqueue failed',
      );
    }
  }
}
