# 0502: Count and pick PDF pages (pdf-lib)

Status: todo
Ticket: Page sorting (owner 2026-10-26) | Depends on: none | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Page sorting needs to know how many pages a PDF has and to cut a few pages out of it, so that one invoice inside a 12-page scan is read on its own. Two small helpers in `@shoebox/extraction` do that with pdf-lib.

## 2. Context

- Owner decision 2026-10-26 (decisions.md, "Page sorting"): pdf-lib is allowed. It is pure JavaScript and MIT licensed, and M01 §4.1 already names it. Pin `pdf-lib@1.17.1`.
- `packages/extraction/src/index.ts` ends with `export * from './proto/schema';`.
- `packages/extraction/package.json` has only `devDependencies` (no `dependencies` key yet).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/package.json` | edit | `"dependencies": { "pdf-lib": "1.17.1" }` |
| `pnpm-lock.yaml` | edit | by `pnpm install` only |
| `packages/extraction/src/pdf/pages.ts` | new | the helpers |
| `packages/extraction/test/pdf-pages.test.ts` | new | given below |
| `packages/extraction/src/index.ts` | edit | export it |

No other file may change.

## 4. Steps

1. Run `pnpm --filter @shoebox/extraction add pdf-lib@1.17.1 2>&1 | tail -5`. Check that `package.json` now has `"pdf-lib": "1.17.1"` under `dependencies`. If it wrote `^1.17.1`, change it to `1.17.1` and run `pnpm install 2>&1 | tail -3`.

2. New `packages/extraction/src/pdf/pages.ts` with exactly these exports. Implement until step 3's tests pass:

```ts
import { PDFDocument } from 'pdf-lib';

/** Thrown when bytes are not a PDF pdf-lib can open. The message never holds document content. */
export class PdfPagesError extends Error {
  constructor() {
    super('pdf: cannot open');
    this.name = 'PdfPagesError';
  }
}

/** The number of pages of a PDF (encrypted files are opened without decrypting, only to count). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number>;

/**
 * A new PDF holding only `pages` (1-based, in the given order; a page may repeat).
 * Throws RangeError for a page outside 1..count, PdfPagesError for bytes that are not a PDF.
 */
export async function pdfPickPages(bytes: Uint8Array, pages: readonly number[]): Promise<Uint8Array>;
```

Use `PDFDocument.load(bytes, { ignoreEncryption: true })` inside try/catch (→ `PdfPagesError`), `PDFDocument.create()`, `copyPages(src, pages.map((p) => p - 1))`, `addPage`, `save()`. Throw `RangeError('page')` before copying when a page is out of range or not an integer.

3. New `packages/extraction/test/pdf-pages.test.ts` (do not edit it):

```ts
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PdfPagesError, pdfPageCount, pdfPickPages } from '../src/pdf/pages';

/** A PDF whose page i (1-based) is 100 + i points wide, so a test can tell pages apart. */
async function pdfOf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= count; i += 1) doc.addPage([100 + i, 200]);
  return doc.save();
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getWidth());
}

describe('pdfPageCount', () => {
  it('counts pages', async () => {
    expect(await pdfPageCount(await pdfOf(12))).toBe(12);
  });

  it('throws PdfPagesError for bytes that are not a PDF', async () => {
    await expect(pdfPageCount(new TextEncoder().encode('not a pdf'))).rejects.toBeInstanceOf(
      PdfPagesError,
    );
  });
});

describe('pdfPickPages', () => {
  it('keeps the asked pages in the asked order', async () => {
    const picked = await pdfPickPages(await pdfOf(5), [4, 2]);
    expect(await widths(picked)).toEqual([104, 102]);
  });

  it('keeps a single page', async () => {
    expect(await widths(await pdfPickPages(await pdfOf(3), [3]))).toEqual([103]);
  });

  it('rejects a page outside the file', async () => {
    const bytes = await pdfOf(2);
    await expect(pdfPickPages(bytes, [3])).rejects.toBeInstanceOf(RangeError);
    await expect(pdfPickPages(bytes, [0])).rejects.toBeInstanceOf(RangeError);
    await expect(pdfPickPages(bytes, [1.5])).rejects.toBeInstanceOf(RangeError);
  });
});
```

Run `pnpm --filter @shoebox/extraction test -- pdf-pages 2>&1 | tail -30` (expect 5 passed).

4. `index.ts`: add `export * from './pdf/pages';` after `export * from './llm/provider';`. Run `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30`.

## 5. Do not touch

Every other package. Rule 4: the error message holds no document content.

## 6. Commands

- `pnpm --filter @shoebox/extraction test -- pdf-pages 2>&1 | tail -30`
- `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30`
- `pnpm eval --quick 2>&1 | tail -30`
- `pnpm exec biome check packages/extraction 2>&1 | tail -30`

## 7. Acceptance

- [ ] The commands in §6 pass.
- [ ] `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md). If `pnpm add` cannot reach the registry, stop.

## 9. Report

Write `docs/tasks/0502-report.md` (600 tokens at most) and set `Status: review`.
