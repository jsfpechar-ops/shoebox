import {
  loadDocumentForRead,
  type ReadingWrite,
  recordFailedRead,
  saveDocumentReading,
  setDocumentStatus,
} from '@shoebox/db';
import { type Clock, createCzRules, parseLegalDate, pragueToday } from '@shoebox/domain';
import {
  AnthropicHttpError,
  buildProtoRequest,
  isProtoMediaType,
  type LlmClient,
  type LlmResponse,
  PROTO_PROMPT_VERSION,
  ProtoParseError,
  parseProtoExtraction,
} from '@shoebox/extraction';
import { DEFAULT_RETRY, type DocumentStagePayload } from '@shoebox/pipeline';
import { runProtoChecks } from '@shoebox/validation';
import type { TenantHandler } from '../registry';
import {
  documentPatchOf,
  fieldsOf,
  statusAfterRead,
  type VatRates,
  validationRowsOf,
  vatSummaryOf,
} from './rows';

export interface ReadingStore {
  readonly load: typeof loadDocumentForRead;
  readonly setStatus: typeof setDocumentStatus;
  readonly save: typeof saveDocumentReading;
  readonly fail: typeof recordFailedRead;
}

export const dbReadingStore: ReadingStore = {
  load: loadDocumentForRead,
  setStatus: setDocumentStatus,
  save: saveDocumentReading,
  fail: recordFailedRead,
};

export interface DocExtractDeps {
  readonly llm: LlmClient;
  readonly blobs: { get(path: string): Promise<Uint8Array> };
  readonly model: string;
  readonly clock: Clock;
  readonly store?: ReadingStore; // default dbReadingStore
}

/** Maps a thrown error to a code for the run record; never carries document content. */
function errorCode(error: unknown, fallback: 'error' | 'storage'): string {
  if (error instanceof AnthropicHttpError) return `http_${error.status}`;
  if (error instanceof ProtoParseError) return 'parse';
  return fallback;
}

/** VAT rates in force at the document's date; falls back to today when the date is outside the rule tables. */
function ratesFor(date: string | null, clock: Clock): VatRates {
  try {
    return createCzRules()
      .at(parseLegalDate(date ?? ''))
      .get('vat.rates');
  } catch {
    return createCzRules().at(pragueToday(clock)).get('vat.rates');
  }
}

export function createDocExtractHandler(deps: DocExtractDeps): TenantHandler<DocumentStagePayload> {
  const store = deps.store ?? dbReadingStore;

  return async (payload, ctx) => {
    const doc = await store.load(ctx.tx, payload.documentId);
    if (doc === null) {
      return;
    }
    // Already read (or failed): nothing to do.
    if (doc.status !== 'received' && doc.status !== 'extracting') {
      return;
    }

    // A failure before the last attempt is re-thrown so pg-boss retries it;
    // on the last attempt it is recorded and the document shows "Nepodařilo se přečíst".
    const final = ctx.attempt >= DEFAULT_RETRY.retryLimit + 1;
    const run = {
      orgId: doc.orgId,
      documentId: doc.id,
      model: deps.model,
      promptVersion: PROTO_PROMPT_VERSION,
      attempt: ctx.attempt,
    };
    const onError = async (error: unknown, code: string): Promise<void> => {
      if (!final) {
        throw error;
      }
      await store.fail(ctx.tx, { ...run, error: code, final: true });
    };

    await store.setStatus(ctx.tx, doc.id, 'extracting');

    const mediaType = doc.mimeType;
    if (!isProtoMediaType(mediaType)) {
      await store.fail(ctx.tx, { ...run, error: 'unsupported_type', final: true });
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = await deps.blobs.get(doc.storagePath);
    } catch (error) {
      return onError(error, errorCode(error, 'storage'));
    }

    let response: LlmResponse;
    try {
      response = await deps.llm.complete(
        buildProtoRequest({ model: deps.model, file: { bytes, mediaType } }),
      );
    } catch (error) {
      return onError(error, errorCode(error, 'error'));
    }

    let write: ReadingWrite;
    try {
      const extraction = parseProtoExtraction(response.json);
      const rates = ratesFor(
        extraction.dates.duzp ?? extraction.dates.issue_date ?? null,
        deps.clock,
      );
      const today = pragueToday(deps.clock);
      const org =
        doc.orgIco === null && doc.orgDic === null
          ? undefined
          : { ico: doc.orgIco, dic: doc.orgDic };
      const checks = runProtoChecks(extraction, org === undefined ? { today } : { today, org });
      const rows = validationRowsOf(checks);
      write = {
        orgId: doc.orgId,
        documentId: doc.id,
        status: statusAfterRead(extraction, rows),
        patch: documentPatchOf(extraction),
        vatSummary: vatSummaryOf(extraction, rates),
        fields: fieldsOf(extraction),
        validations: rows,
        run: {
          model: response.model,
          promptVersion: PROTO_PROMPT_VERSION,
          attempt: ctx.attempt,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cacheReadInputTokens,
          cacheWriteTokens: response.usage.cacheCreationInputTokens,
          latencyMs: response.latencyMs,
        },
      };
    } catch (error) {
      // Any throw after parsing (e.g. an invalid currency code) counts as a parse failure.
      return onError(error, 'parse');
    }

    try {
      await store.save(ctx.tx, write);
    } catch (error) {
      return onError(error, errorCode(error, 'error'));
    }
  };
}
