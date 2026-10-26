import {
  knownSupplierIcos,
  loadDocumentForRead,
  type ReadingWrite,
  recordFailedRead,
  rememberSupplier,
  saveDocumentReading,
  setDocumentStatus,
  type TenantTx,
} from '@shoebox/db';
import { type Clock, createCzRules, parseLegalDate, pragueToday } from '@shoebox/domain';
import {
  AnthropicHttpError,
  applyExactData,
  buildProtoRequest,
  type DocumentScan,
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
  scanDocument,
} from '@shoebox/extraction';
import { DEFAULT_RETRY, type DocumentStagePayload } from '@shoebox/pipeline';
import { icoChecksumValid, icoRepairCandidates, runProtoChecks } from '@shoebox/validation';
import type { TenantHandler } from '../registry';
import { defaultRegistryDeps, type RegistryDeps, registryRows } from './registry-checks';
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
  readonly knownSupplierIcos?: typeof knownSupplierIcos;
  readonly rememberSupplier?: typeof rememberSupplier;
}

export const dbReadingStore: ReadingStore = {
  load: loadDocumentForRead,
  setStatus: setDocumentStatus,
  save: saveDocumentReading,
  fail: recordFailedRead,
  knownSupplierIcos,
  rememberSupplier,
};

export interface DocExtractDeps {
  readonly llm: LlmClient;
  readonly blobs: { get(path: string): Promise<Uint8Array> };
  readonly model: string;
  readonly clock: Clock;
  readonly store?: ReadingStore; // default dbReadingStore
  readonly scan?: (bytes: Uint8Array, mediaType: string) => Promise<DocumentScan>; // default scanDocument
  readonly registries?: RegistryDeps; // default defaultRegistryDeps()
}

const NO_SCAN: DocumentScan = { text: null, textGood: false, qrTexts: [] };

/** Maps a thrown error to a code for the run record; never carries document content. */
function errorCode(error: unknown, fallback: 'error' | 'storage'): string {
  if (error instanceof AnthropicHttpError) return `http_${error.status}`;
  if (error instanceof ProtoParseError) return 'parse';
  return fallback;
}

/** A supplier IČO that fails its check digit, replaced by the one saved supplier one digit (or swap) away. */
interface IcoRepair {
  readonly extraction: ProtoExtraction;
  readonly from: string;
  readonly to: string;
  readonly fieldKeys: readonly string[];
}

/** Repairs a misread supplier IČO only when exactly one saved supplier (never the org itself) is one digit or one swap away. */
function repairSupplierIco(
  x: ProtoExtraction,
  known: readonly string[],
  orgIco: string | null,
): IcoRepair | null {
  const ico = x.supplier.ico;
  if (!ico || icoChecksumValid(ico)) {
    return null;
  }
  const hits = icoRepairCandidates(ico).filter((c) => known.includes(c) && c !== orgIco);
  const to = hits[0];
  if (hits.length !== 1 || to === undefined) {
    return null;
  }
  const dicDerived = x.supplier.dic === `CZ${ico}`;
  return {
    extraction: {
      ...x,
      supplier: { ...x.supplier, ico: to, ...(dicDerived ? { dic: `CZ${to}` } : {}) },
    },
    from: ico,
    to,
    fieldKeys: dicDerived ? ['supplier.ico', 'supplier.dic'] : ['supplier.ico'],
  };
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

    // IČOs of suppliers already saved for this org: used to repair a misread IČO. Best effort.
    let known: string[] = [];
    try {
      known = (await store.knownSupplierIcos?.(ctx.tx, doc.orgId)) ?? [];
    } catch {
      known = [];
    }

    // Exact data in the file itself (QR codes, PDF text layer): read for PDFs and images only.
    let scan: DocumentScan = NO_SCAN;
    if (modelType !== null) {
      try {
        scan = await (deps.scan ?? scanDocument)(bytes, mediaType);
      } catch {
        scan = NO_SCAN;
      }
    }

    const read: { extraction: ProtoExtraction | null } = { extraction: null };
    const toWrite = (
      reading: ProtoExtraction,
      source: 'llm' | 'isdoc',
      runRow: ReadingWrite['run'],
    ): ReadingWrite => {
      const exact = applyExactData(
        reading,
        scan,
        { ico: doc.orgIco, dic: doc.orgDic },
        { keepIdentifiers: source === 'isdoc' },
      );
      const repair =
        source === 'isdoc' ? null : repairSupplierIco(exact.extraction, known, doc.orgIco);
      const extraction = repair?.extraction ?? exact.extraction;
      const rates = ratesFor(
        extraction.dates.duzp ?? extraction.dates.issue_date ?? null,
        deps.clock,
      );
      const today = pragueToday(deps.clock);
      const org =
        doc.orgIco === null && doc.orgDic === null
          ? undefined
          : { ico: doc.orgIco, dic: doc.orgDic };
      const checks = runProtoChecks(
        { ...extraction, qr: { amount: exact.qrAmount } },
        org === undefined ? { today } : { today, org },
      );
      const rows = [
        ...validationRowsOf(checks),
        ...(repair === null
          ? []
          : [
              {
                ruleId: 'PROTO_ICO_REPAIRED',
                ruleVersion: 1,
                severity: 'warning' as const,
                params: {
                  from: repair.from,
                  to: repair.to,
                  messageKey: 'proto.check.ico_repaired.warn',
                },
              },
            ]),
      ];
      const fields = fieldsOf(extraction, source).map((row) => {
        if (repair?.fieldKeys.includes(row.fieldKey)) {
          return { ...row, source: 'vendor_memory' as const };
        }
        const exactSource = exact.sources[row.fieldKey];
        return exactSource === undefined ? row : { ...row, source: exactSource };
      });
      if (exact.qrAmount !== null) {
        fields.push({ fieldKey: 'qr.amount', valueText: exact.qrAmount, source: 'qr' });
      }
      read.extraction = extraction;
      return {
        orgId: doc.orgId,
        documentId: doc.id,
        status: statusAfterRead(extraction, rows),
        patch: documentPatchOf(extraction),
        vatSummary: vatSummaryOf(extraction, rates),
        fields,
        validations: rows,
        run: runRow,
      };
    };

    let write: ReadingWrite;
    // Step 1: exact data first. An ISDOC (plain, .isdocx or embedded in the PDF) is read without AI.
    const isdoc = mediaType === 'application/pdf' || isdocOnly ? isdocOf(bytes) : null;
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
          buildProtoRequest({ model: deps.model, file: { bytes, mediaType: modelType } }),
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

    // Registry warnings (never blocking), added to the saved reading only.
    if (read.extraction !== null) {
      const found = await registryRows(
        read.extraction,
        { ico: doc.orgIco, dic: doc.orgDic },
        deps.registries ?? defaultRegistryDeps(),
      );
      write = { ...write, validations: [...write.validations, ...found] };
    }

    try {
      await store.save(ctx.tx, write);
    } catch (error) {
      return onError(error, errorCode(error, 'error'));
    }

    // Remember the saved supplier for next time. Own savepoint, best effort: the reading is already saved.
    const supplier = read.extraction?.supplier;
    const savedIco = supplier?.ico ?? null;
    const remember = store.rememberSupplier;
    if (
      remember !== undefined &&
      supplier !== undefined &&
      savedIco !== null &&
      savedIco !== '' &&
      icoChecksumValid(savedIco) &&
      savedIco !== doc.orgIco
    ) {
      try {
        await ctx.tx.transaction((sp) =>
          remember(sp as TenantTx, {
            orgId: doc.orgId,
            documentId: doc.id,
            ico: savedIco,
            name: supplier.name === '' ? null : supplier.name,
            dic: supplier.dic === '' ? null : supplier.dic,
            country: supplier.country === '' ? null : supplier.country,
          }),
        );
      } catch {
        // A failed memory write never fails the reading.
      }
    }
  };
}
