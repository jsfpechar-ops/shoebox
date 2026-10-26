import {
  loadDocumentForRead,
  loadDocumentPages,
  type ReadingWrite,
  recordFailedRead,
  saveDocumentReading,
  setDocumentStatus,
} from '@shoebox/db';
import { type Clock, createCzRules, parseLegalDate, pragueToday } from '@shoebox/domain';
import {
  AnthropicHttpError,
  buildPartsRequest,
  buildProtoRequest,
  ISDOC_READER_VERSION,
  type IsdocReading,
  isProtoMediaType,
  type LlmClient,
  type LlmResponse,
  PROTO_PROMPT_VERSION,
  type ProtoExtraction,
  ProtoParseError,
  parseProtoExtraction,
  readIsdoc,
  type ReadPart,
} from '@shoebox/extraction';
import { DEFAULT_RETRY, type DocumentStagePayload } from '@shoebox/pipeline';
import { runProtoChecks } from '@shoebox/validation';
import type { TenantHandler } from '../registry';
import { partsOf } from './parts';
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
  /** Page sorting (0505): the document's chosen pages; optional so test stores can leave it out. */
  readonly loadPages?: typeof loadDocumentPages;
  readonly setStatus: typeof setDocumentStatus;
  readonly save: typeof saveDocumentReading;
  readonly fail: typeof recordFailedRead;
}

export const dbReadingStore: ReadingStore = {
  load: loadDocumentForRead,
  loadPages: loadDocumentPages,
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

/** Media types stored for .isdoc/.xml and .isdocx uploads: only their ISDOC data can be read. */
const ISDOC_ONLY_TYPES: readonly string[] = ['application/xml', 'application/x-isdocx'];

/** ISDOC data of the file, or null (none, or unreadable: the caller then uses the model). */
function isdocOf(bytes: Uint8Array): IsdocReading | null {
  try {
    return readIsdoc(bytes);
  } catch {
    return null;
  }
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
    const isdocOnly = ISDOC_ONLY_TYPES.includes(mediaType);
    const modelType = isProtoMediaType(mediaType) ? mediaType : null;
    if (modelType === null && !isdocOnly) {
      await store.fail(ctx.tx, { ...run, error: 'unsupported_type', final: true });
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = await deps.blobs.get(doc.storagePath);
    } catch (error) {
      return onError(error, errorCode(error, 'storage'));
    }

    // Page sorting (0505): a document made of chosen pages is read from those pages only.
    let parts: ReadPart[] | null = null;
    try {
      const pages = store.loadPages ? await store.loadPages(ctx.tx, doc.id) : [];
      if (pages.length > 0) parts = await partsOf(pages, deps.blobs);
    } catch (error) {
      return onError(error, errorCode(error, 'storage'));
    }

    const toWrite = (
      extraction: ProtoExtraction,
      source: 'llm' | 'isdoc',
      runRow: ReadingWrite['run'],
    ): ReadingWrite => {
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
      return {
        orgId: doc.orgId,
        documentId: doc.id,
        status: statusAfterRead(extraction, rows),
        patch: documentPatchOf(extraction),
        vatSummary: vatSummaryOf(extraction, rates),
        fields: fieldsOf(extraction, source),
        validations: rows,
        run: runRow,
      };
    };

    let write: ReadingWrite;
    // Step 1: exact data first. An ISDOC (plain, .isdocx or embedded in the PDF) is read without AI.
    const isdoc =
      parts === null && (mediaType === 'application/pdf' || isdocOnly) ? isdocOf(bytes) : null;
    if (isdoc !== null) {
      try {
        write = toWrite(isdoc.extraction, 'isdoc', {
          method: 'isdoc',
          model: null,
          promptVersion: ISDOC_READER_VERSION,
          attempt: ctx.attempt,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          latencyMs: 0,
        });
      } catch (error) {
        return onError(error, 'parse');
      }
    } else if (modelType === null) {
      // An XML or .isdocx without readable ISDOC data: nothing a model could read either.
      await store.fail(ctx.tx, { ...run, error: 'isdoc_unreadable', final: true });
      return;
    } else {
      // Step 2: no ISDOC, so the model reads the page.
      let response: LlmResponse;
      try {
        response = await deps.llm.complete(
          parts === null
            ? buildProtoRequest({ model: deps.model, file: { bytes, mediaType: modelType } })
            : buildPartsRequest({ model: deps.model, parts }),
        );
      } catch (error) {
        return onError(error, errorCode(error, 'error'));
      }
      try {
        write = toWrite(parseProtoExtraction(response.json), 'llm', {
          model: response.model,
          promptVersion: PROTO_PROMPT_VERSION,
          attempt: ctx.attempt,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cacheReadInputTokens,
          cacheWriteTokens: response.usage.cacheCreationInputTokens,
          latencyMs: response.latencyMs,
        });
      } catch (error) {
        // Any throw after parsing (e.g. an invalid currency code) counts as a parse failure.
        return onError(error, 'parse');
      }
    }

    try {
      await store.save(ctx.tx, write);
    } catch (error) {
      return onError(error, errorCode(error, 'error'));
    }
  };
}
