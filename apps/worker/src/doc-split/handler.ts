import {
  applySortPlan,
  loadSplitBatch,
  type SortPlan,
  type SplitBatchFile,
  type SplitRun,
  setDocumentsStatus,
} from '@shoebox/db';
import {
  buildSortRequest,
  groupPages,
  isProtoMediaType,
  type LlmClient,
  type PageMapPage,
  parsePageMap,
  pdfPageCount,
  pdfPickPages,
  readIsdoc,
  SORT_MAX_PAGES_PER_CALL,
  SORT_PROMPT_VERSION,
  type SortPage,
  type SortPart,
} from '@shoebox/extraction';
import type { DocSplitPayload } from '@shoebox/pipeline';
import type { TenantHandler } from '../registry';
import { planSort } from './plan';

export interface DocSplitStore {
  readonly loadBatch: typeof loadSplitBatch;
  readonly setStatus: typeof setDocumentsStatus;
  readonly apply: typeof applySortPlan;
}

export const dbDocSplitStore: DocSplitStore = {
  loadBatch: loadSplitBatch,
  setStatus: setDocumentsStatus,
  apply: applySortPlan,
};

export interface DocSplitDeps {
  readonly llm: LlmClient;
  readonly blobs: { get(path: string): Promise<Uint8Array> };
  readonly model: string;
  /** Queues doc.extract for one document, a few seconds later (the sort's writes commit first). */
  readonly enqueueRead: (orgId: string, documentId: string) => Promise<unknown>;
  readonly store?: DocSplitStore;
  readonly countPages?: (bytes: Uint8Array) => Promise<number>;
  readonly pick?: (bytes: Uint8Array, pages: readonly number[]) => Promise<Uint8Array>;
}

interface Sortable {
  readonly file: SplitBatchFile;
  readonly bytes: Uint8Array;
  readonly mediaType: SortPart['mediaType'];
  readonly pageCount: number;
}

interface PageRef {
  readonly fileIndex: number;
  readonly filePage: number;
}

/**
 * Sorts the pages of one upload drop into documents (M01 page sorting), then queues one read per
 * document. Direct files (not a model type, ISDOC, unreadable page count) and drops of at most one
 * page skip the look-over. Any failure of the look-over reverts to reading every file on its own.
 */
export function createDocSplitHandler(deps: DocSplitDeps): TenantHandler<DocSplitPayload> {
  const store = deps.store ?? dbDocSplitStore;
  const countPages = deps.countPages ?? pdfPageCount;
  const pick = deps.pick ?? pdfPickPages;

  const readAll = async (orgId: string, files: readonly SplitBatchFile[]): Promise<void> => {
    for (const file of files) await deps.enqueueRead(orgId, file.documentId);
  };

  return async (payload, ctx) => {
    const files = await store.loadBatch(ctx.tx, payload.batchId);
    if (files.length === 0) return;

    const direct = new Set<string>();
    const sortable: Sortable[] = [];
    for (const file of files) {
      const bytes = await deps.blobs.get(file.storagePath);
      const mime = file.mimeType;
      if (!isProtoMediaType(mime) || (mime === 'application/pdf' && hasIsdoc(bytes))) {
        direct.add(file.documentId);
        continue;
      }
      let pageCount = 1;
      if (mime === 'application/pdf') {
        try {
          pageCount = await countPages(bytes);
        } catch {
          direct.add(file.documentId);
          continue;
        }
      }
      sortable.push({ file, bytes, mediaType: mime, pageCount });
    }

    const totalPages = sortable.reduce((sum, s) => sum + s.pageCount, 0);
    if (totalPages <= 1) {
      await readAll(payload.orgId, files);
      return;
    }

    const sortableFiles = sortable.map((s) => s.file);
    await store.setStatus(
      ctx.tx,
      sortableFiles.map((f) => f.documentId),
      'splitting',
    );

    let plan: SortPlan;
    try {
      const refs: PageRef[] = [];
      const chunks = await buildChunks(sortable, pick, refs);
      const runs: SplitRun[] = [];
      const pageMaps: PageMapPage[] = [];
      for (const parts of chunks) {
        const expected = parts.flatMap((p) => range(p.firstPage, p.firstPage + p.pageCount - 1));
        const response = await deps.llm.complete(buildSortRequest({ model: deps.model, parts }));
        pageMaps.push(...parsePageMap(response.json, expected));
        runs.push({
          model: response.model,
          promptVersion: SORT_PROMPT_VERSION,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cacheReadInputTokens,
          cacheWriteTokens: response.usage.cacheCreationInputTokens,
          latencyMs: response.latencyMs,
        });
      }
      const pages: SortPage[] = pageMaps.map((pm) => {
        const ref = refs[pm.page - 1];
        if (!ref) throw new Error('doc.split: page outside the look-over');
        return { fileIndex: ref.fileIndex, filePage: ref.filePage, blank: pm.blank, items: pm.items };
      });
      plan = planSort(payload.orgId, payload.batchId, sortableFiles, groupPages(pages), runs);
    } catch {
      await store.setStatus(
        ctx.tx,
        sortableFiles.map((f) => f.documentId),
        'received',
      );
      await readAll(payload.orgId, files);
      return;
    }

    const ids = await store.apply(ctx.tx, plan);
    for (const id of ids) await deps.enqueueRead(payload.orgId, id);
    await readAll(
      payload.orgId,
      files.filter((f) => direct.has(f.documentId)),
    );
  };
}

function hasIsdoc(bytes: Uint8Array): boolean {
  try {
    return readIsdoc(bytes) !== null;
  } catch {
    return false;
  }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * Cuts the sortable pages into look-over calls of at most SORT_MAX_PAGES_PER_CALL pages.
 * A file that fits the current call stays whole; a longer PDF is cut into page ranges.
 * Global pages are numbered 1..N in file order; `refs` maps global page N to its file and page.
 */
async function buildChunks(
  sortable: readonly Sortable[],
  pick: (bytes: Uint8Array, pages: readonly number[]) => Promise<Uint8Array>,
  refs: PageRef[],
): Promise<SortPart[][]> {
  const limit = SORT_MAX_PAGES_PER_CALL;
  const chunks: SortPart[][] = [];
  let parts: SortPart[] = [];
  let used = 0;
  const close = (): void => {
    if (parts.length > 0) chunks.push(parts);
    parts = [];
    used = 0;
  };

  for (const [fileIndex, s] of sortable.entries()) {
    if (s.pageCount <= limit && used + s.pageCount > limit) close();
    let filePage = 1;
    while (filePage <= s.pageCount) {
      if (used === limit) close();
      const take = Math.min(limit - used, s.pageCount - filePage + 1);
      const whole = filePage === 1 && take === s.pageCount;
      const bytes = whole ? s.bytes : await pick(s.bytes, range(filePage, filePage + take - 1));
      parts.push({ bytes, mediaType: s.mediaType, firstPage: refs.length + 1, pageCount: take });
      for (let p = 0; p < take; p++) refs.push({ fileIndex, filePage: filePage + p });
      used += take;
      filePage += take;
    }
  }
  close();
  return chunks;
}
