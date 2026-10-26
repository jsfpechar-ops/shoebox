# 0505: Read a document from its chosen pages

Status: todo
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0501, 0502 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

When page sorting has decided that a document is "page 3 and 4 of this scan" or "photo 1 plus photo 2", the reader sends Haiku exactly those pages, in order, in one call, and reads one document from them. A document without `document_pages` rows is read as today.

## 2. Context

- `document_pages` (0501): `orgId, documentId, position, sourceFileId, filePage, region, ...`. The Drizzle table `documentPages` is in `packages/db/src/schema/document-pages.ts`. `packages/db/src/index.ts` exports schema files one by one (`export * from './schema/documents';` ...) and does not export `document-pages` yet.
- `packages/db/src/document-reading.ts` starts with `import { and, eq, isNull } from 'drizzle-orm';` and uses `TenantTx` from `./tenant`, and `documents, sourceFiles` from `./schema/documents`.
- `@shoebox/extraction` exports `buildProtoRequest({ model, file: { bytes, mediaType } })`, `PROTO_USER_PROMPT`, `type ProtoMediaType`, `isProtoMediaType(value)`, and (0502) `pdfPickPages(bytes, pages)`. `buildProtoRequest` returns `messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: PROTO_USER_PROMPT }] }]`.
- Lane B also edits `apps/worker/src/doc-extract/handler.ts`: keep the handler edit to the anchors below.
- `apps/worker/src/doc-extract/handler.ts` excerpts (find verbatim):

```ts
import {
  loadDocumentForRead,
  type ReadingWrite,
```

```ts
  buildProtoRequest,
  ISDOC_READER_VERSION,
```

```ts
import {
  documentPatchOf,
```

```ts
export interface ReadingStore {
  readonly load: typeof loadDocumentForRead;
```

```ts
export const dbReadingStore: ReadingStore = {
  load: loadDocumentForRead,
```

```ts
    let bytes: Uint8Array;
    try {
      bytes = await deps.blobs.get(doc.storagePath);
    } catch (error) {
      return onError(error, errorCode(error, 'storage'));
    }
```

```ts
    const isdoc = mediaType === 'application/pdf' || isdocOnly ? isdocOf(bytes) : null;
```

```ts
        response = await deps.llm.complete(
          buildProtoRequest({ model: deps.model, file: { bytes, mediaType: modelType } }),
        );
```

- `apps/worker/test/doc-extract-handler.test.ts` has `fakeStore(doc)` returning a `ReadingStore` without `loadPages`, `llmReturning(json)` with `.requests`, `blobs`, `clock`, `ctx()`, `ORG`, `DOC`, and its first test is `it('reads, checks and saves a clean invoice as ready', ...)`. The file ends `});`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/document-pages.ts` | new | `loadDocumentPages` |
| `packages/db/src/index.ts` | edit | 2 exports |
| `packages/extraction/src/sort/read-parts.ts` | new | `buildPartsRequest` |
| `packages/extraction/test/read-parts.test.ts` | new | given below |
| `packages/extraction/src/index.ts` | edit | export it |
| `apps/worker/src/doc-extract/parts.ts` | new | `partsOf` |
| `apps/worker/test/doc-extract-parts.test.ts` | new | given below |
| `apps/worker/src/doc-extract/handler.ts` | edit | use the parts |
| `apps/worker/test/doc-extract-handler.test.ts` | edit | one test |

No other file may change.

## 4. Steps

1. New `packages/db/src/document-pages.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import { documentPages } from './schema/document-pages';
import { sourceFiles } from './schema/documents';
import type { TenantTx } from './tenant';

/** One page (or one region of a page) of a sorted document, with its file. */
export interface DocumentPageForRead {
  readonly position: number;
  readonly sourceFileId: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly filePage: number;
  readonly region: string;
}

/** The document's pages in order; [] when it has none (then the whole source file is the document). */
export async function loadDocumentPages(
  tx: TenantTx,
  documentId: string,
): Promise<DocumentPageForRead[]> {
  return tx
    .select({
      position: documentPages.position,
      sourceFileId: documentPages.sourceFileId,
      storagePath: sourceFiles.storagePath,
      mimeType: sourceFiles.mimeType,
      filePage: documentPages.filePage,
      region: documentPages.region,
    })
    .from(documentPages)
    .innerJoin(sourceFiles, eq(sourceFiles.id, documentPages.sourceFileId))
    .where(eq(documentPages.documentId, documentId))
    .orderBy(asc(documentPages.position));
}
```

2. `packages/db/src/index.ts`: add `export * from './document-pages';` after `export * from './document-reading';`, and `export * from './schema/document-pages';` before `export * from './schema/documents';`. Run `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`.

3. New `packages/extraction/src/sort/read-parts.ts` with these exports; implement until step 4 passes:

```ts
import type { LlmRequest } from '../llm/client';
import { buildProtoRequest, PROTO_USER_PROMPT, type ProtoMediaType } from '../proto/schema';

/** One file or PDF cut to read, in order. `region` '' = the whole page. */
export interface ReadPart {
  readonly bytes: Uint8Array;
  readonly mediaType: ProtoMediaType;
  readonly region: string;
}

export const PARTS_PAGES_HINT =
  'Doklad má více stran. Jsou přiložené ve správném pořadí. Vytěž z nich jeden doklad.';

export function partsRegionHint(region: string): string {
  return `Na stránce je více dokladů. Vytěž jen doklad, který je na stránce zde: ${region}.`;
}

/**
 * The reading request for a document made of several parts: buildProtoRequest's request with the
 * user content replaced by [each part's document/image block, in order], then PARTS_PAGES_HINT when
 * there are 2+ parts, then partsRegionHint(region) for the first part with a non-empty region,
 * then PROTO_USER_PROMPT. Throws RangeError for no parts.
 */
export function buildPartsRequest(options: {
  readonly model: string;
  readonly parts: readonly ReadPart[];
}): LlmRequest;
```

(Make each part's block by calling `buildProtoRequest({ model, file: part })` and taking `messages[0].content[0]`, so the block shape stays the reader's.)

4. New `packages/extraction/test/read-parts.test.ts` (do not edit it):

```ts
import { describe, expect, it } from 'vitest';
import { buildProtoRequest, PROTO_USER_PROMPT } from '../src/proto/schema';
import { buildPartsRequest, PARTS_PAGES_HINT, partsRegionHint } from '../src/sort/read-parts';

const pdf = { bytes: new Uint8Array([1]), mediaType: 'application/pdf' as const, region: '' };
const jpg = { bytes: new Uint8Array([2]), mediaType: 'image/jpeg' as const, region: '' };

describe('buildPartsRequest', () => {
  it('sends every part in order, then the hint and the prompt', () => {
    const request = buildPartsRequest({ model: 'm', parts: [pdf, jpg] });
    const content = request.messages[0]?.content ?? [];
    expect(content.map((b) => b.type)).toEqual(['document', 'image', 'text', 'text']);
    expect(content[2]).toEqual({ type: 'text', text: PARTS_PAGES_HINT });
    expect(content[3]).toEqual({ type: 'text', text: PROTO_USER_PROMPT });
  });

  it('keeps everything else of the reader request', () => {
    const one = buildProtoRequest({ model: 'm', file: pdf });
    const request = buildPartsRequest({ model: 'm', parts: [pdf] });
    expect({ ...request, messages: [] }).toEqual({ ...one, messages: [] });
    expect(request.messages[0]?.content).toEqual(one.messages[0]?.content);
  });

  it('names the region when a page holds several documents', () => {
    const request = buildPartsRequest({ model: 'm', parts: [{ ...jpg, region: 'bottom' }] });
    const content = request.messages[0]?.content ?? [];
    expect(content.map((b) => b.type)).toEqual(['image', 'text', 'text']);
    expect(content[1]).toEqual({ type: 'text', text: partsRegionHint('bottom') });
  });

  it('needs at least one part', () => {
    expect(() => buildPartsRequest({ model: 'm', parts: [] })).toThrow(RangeError);
  });
});
```

Run `pnpm --filter @shoebox/extraction test -- read-parts 2>&1 | tail -30` (expect passed).

5. `packages/extraction/src/index.ts`: add `export * from './sort/read-parts';` after `export * from './sort/page-map';`. Run `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30`.

6. New `apps/worker/src/doc-extract/parts.ts`; implement until step 7 passes:

```ts
import type { DocumentPageForRead } from '@shoebox/db';
import { isProtoMediaType, pdfPickPages, type ReadPart } from '@shoebox/extraction';

/**
 * The parts to read for a sorted document. Consecutive rows of the same file and the same region
 * become one part: for a PDF, `pick(bytes, [their filePages in row order])`; for an image, its bytes.
 * Each file is fetched once. Throws TypeError('media') for a file the model cannot read.
 */
export async function partsOf(
  rows: readonly DocumentPageForRead[],
  blobs: { get(path: string): Promise<Uint8Array> },
  pick: (bytes: Uint8Array, pages: readonly number[]) => Promise<Uint8Array> = pdfPickPages,
): Promise<ReadPart[]>;
```

7. New `apps/worker/test/doc-extract-parts.test.ts` (do not edit it):

```ts
import type { DocumentPageForRead } from '@shoebox/db';
import { describe, expect, it } from 'vitest';
import { partsOf } from '../src/doc-extract/parts';

function row(over: Partial<DocumentPageForRead>): DocumentPageForRead {
  return {
    position: 1,
    sourceFileId: 'f1',
    storagePath: 'p/f1',
    mimeType: 'application/pdf',
    filePage: 1,
    region: '',
    ...over,
  };
}

function fakeBlobs() {
  const gets: string[] = [];
  return {
    gets,
    blobs: {
      async get(path: string) {
        gets.push(path);
        return new TextEncoder().encode(path);
      },
    },
  };
}

const picks: string[] = [];
const pick = async (bytes: Uint8Array, pages: readonly number[]) => {
  picks.push(`${new TextDecoder().decode(bytes)}:${pages.join(',')}`);
  return new Uint8Array([pages.length]);
};

describe('partsOf', () => {
  it('cuts the chosen PDF pages and keeps photos whole, in order', async () => {
    picks.length = 0;
    const { blobs, gets } = fakeBlobs();
    const parts = await partsOf(
      [
        row({ position: 1, filePage: 3 }),
        row({ position: 2, filePage: 4 }),
        row({ position: 3, sourceFileId: 'f2', storagePath: 'p/f2', mimeType: 'image/jpeg' }),
        row({ position: 4, filePage: 7 }),
      ],
      blobs,
      pick,
    );
    expect(parts.map((p) => p.mediaType)).toEqual(['application/pdf', 'image/jpeg', 'application/pdf']);
    expect(picks).toEqual(['p/f1:3,4', 'p/f1:7']);
    expect(gets).toEqual(['p/f1', 'p/f2']);
  });

  it('keeps two regions of one photo as two parts', async () => {
    const { blobs } = fakeBlobs();
    const parts = await partsOf(
      [row({ mimeType: 'image/png', region: 'top' })],
      blobs,
      pick,
    );
    expect(parts).toEqual([
      { bytes: new TextEncoder().encode('p/f1'), mediaType: 'image/png', region: 'top' },
    ]);
  });

  it('rejects a file the model cannot read', async () => {
    const { blobs } = fakeBlobs();
    await expect(partsOf([row({ mimeType: 'application/xml' })], blobs, pick)).rejects.toThrow(TypeError);
  });
});
```

Run `pnpm --filter @shoebox/worker test -- doc-extract-parts 2>&1 | tail -30`.

8. `handler.ts` edits, all at the excerpts in §2:
   - Add `loadDocumentPages,` before `loadDocumentForRead,` in the `@shoebox/db` import; add `buildPartsRequest,` before `buildProtoRequest,` and `type ReadPart,` in sorted place in the `@shoebox/extraction` import; add `import { partsOf } from './parts';` before `import {\n  documentPatchOf,`.
   - `ReadingStore`: add `  /** Page sorting (0505): the document's chosen pages; optional so test stores can leave it out. */\n  readonly loadPages?: typeof loadDocumentPages;` after the `load` line. `dbReadingStore`: add `  loadPages: loadDocumentPages,` after `load: loadDocumentForRead,`.
   - After the `bytes` try/catch block add:

```ts

    // Page sorting (0505): a document made of chosen pages is read from those pages only.
    let parts: ReadPart[] | null = null;
    try {
      const pages = store.loadPages ? await store.loadPages(ctx.tx, doc.id) : [];
      if (pages.length > 0) parts = await partsOf(pages, deps.blobs);
    } catch (error) {
      return onError(error, errorCode(error, 'storage'));
    }
```

   - The `isdoc` line becomes `const isdoc =\n      parts === null && (mediaType === 'application/pdf' || isdocOnly) ? isdocOf(bytes) : null;` (let biome format it).
   - The `buildProtoRequest(...)` argument becomes:

```ts
          parts === null
            ? buildProtoRequest({ model: deps.model, file: { bytes, mediaType: modelType } })
            : buildPartsRequest({ model: deps.model, parts }),
```

9. `doc-extract-handler.test.ts`: append before the file's last `});`:

```ts

  it('reads a sorted document from its chosen pages in one call', async () => {
    const { store, saved } = fakeStore({ mimeType: 'image/jpeg' });
    const llm = llmReturning(wire());
    const sorted: ReadingStore = {
      ...store,
      loadPages: async () => [
        { position: 1, sourceFileId: 'f1', storagePath: 'a', mimeType: 'image/jpeg', filePage: 1, region: '' },
        { position: 2, sourceFileId: 'f2', storagePath: 'b', mimeType: 'image/png', filePage: 1, region: '' },
      ],
    };
    await createDocExtractHandler({ llm, blobs, model: 'claude-haiku-5-5', clock, store: sorted })(
      { orgId: ORG, documentId: DOC },
      ctx(),
    );
    const content = llm.requests[0]?.messages[0]?.content ?? [];
    expect(content.map((b) => b.type)).toEqual(['image', 'image', 'text', 'text']);
    expect(saved).toHaveLength(1);
  });
```

Run `pnpm --filter @shoebox/worker test -- doc-extract 2>&1 | tail -30` and `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`.

## 5. Do not touch

`packages/extraction/src/proto/*`, the rest of `handler.ts`. Rule 4 (no document content in errors or logs).

## 6. Commands

- `pnpm --filter @shoebox/extraction test -- read-parts 2>&1 | tail -30`
- `pnpm --filter @shoebox/worker test -- doc-extract 2>&1 | tail -30`
- `pnpm --filter @shoebox/db --filter @shoebox/extraction --filter @shoebox/worker typecheck 2>&1 | tail -30`
- `pnpm eval --quick 2>&1 | tail -30`
- `pnpm exec biome check packages/db packages/extraction apps/worker 2>&1 | tail -30` (you may `biome format --write` any file of §3, tests included: formatting only)

## 7. Acceptance

- [ ] The commands in §6 pass. `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0505-report.md` (600 tokens at most) and set `Status: review`.
