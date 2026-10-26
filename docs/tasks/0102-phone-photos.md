# 0102: Phone photos upload small, without location, and iPhone HEIC works

Status: done
Ticket: P1-ING-04 (image part, browser side) | Depends on: none | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A phone photo is 3-8 MB with GPS data, and iPhones may send HEIC, which the reader cannot take. Before upload the browser re-draws each photo as a JPEG of at most 2400 px on the long edge: upload is faster, reading is cheaper, the location data is gone, and HEIC becomes JPEG wherever the browser can open it.

## 2. Context

- Decision (orchestrator 2026-10-26, logged in decisions): no new dependency; HEIC is converted by the browser (`createImageBitmap` + canvas). iPhone Safari already hands JPEG to a web page; Safari on a Mac decodes HEIC. Where a browser cannot open a HEIC we say so plainly. No crop step and no separate camera button: tapping the upload area on a phone already offers "Take photo" (fewest buttons).
- Rules: JPEG, WebP, HEIC/HEIF → always re-encoded as JPEG quality 0.88 (this strips EXIF/GPS). PNG (screenshots, no GPS) → kept as is unless its long edge is over 2400 px, then JPEG. PDFs and ISDOC files are never touched. If re-drawing a non-HEIC file fails, upload the original.
- Excerpts in `apps/web/src/documents/upload-dropzone.tsx` (find verbatim):

```tsx
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.isdoc,.isdocx,.xml';
```

```tsx
  async function send(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setMessage('');
    try {
      const body = new FormData();
      for (const file of files) body.append('files', file);
```

```tsx
        .filter((part) => part.n > 0)
        .map((part) => t(part.key, { n: part.n }));
```

- Excerpt in `packages/i18n/messages/en.json` (find verbatim):

```json
  "inbox.upload.error": "The upload failed. Please try again.",
```

## 3. Files

| Path | Action | What |
|---|---|---|
| apps/web/src/documents/prepare-image.ts | new | pure helpers + `prepareFile` |
| apps/web/test/prepare-image.test.ts | new | the test below |
| apps/web/src/documents/upload-dropzone.tsx | edit | prepare files before sending |
| packages/i18n/messages/en.json | edit | 1 key |

No other file may change.

## 4. Steps

1. Edit `en.json`: after the `inbox.upload.error` line add:

```json
  "inbox.upload.heic_unsupported": "{n, plural, one {# iPhone photo (HEIC) can't be opened in this browser} other {# iPhone photos (HEIC) can't be opened in this browser}}. Upload it from your phone, or save it as JPEG first.",
```

   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → passes.

2. Create `apps/web/test/prepare-image.test.ts` exactly (do not edit it later):

```ts
import { describe, expect, it } from 'vitest';
import { isHeic, jpegName, MAX_EDGE, planImage, scaledSize } from '../src/documents/prepare-image';

describe('isHeic', () => {
  it('knows HEIC by type or by extension', () => {
    expect(isHeic('IMG_1.HEIC', '')).toBe(true);
    expect(isHeic('a.heif', 'application/octet-stream')).toBe(true);
    expect(isHeic('photo', 'image/heic')).toBe(true);
    expect(isHeic('a.jpg', 'image/jpeg')).toBe(false);
  });
});

describe('planImage', () => {
  it('re-encodes photos, keeps small PNGs, never touches PDFs or ISDOC', () => {
    expect(planImage('a.jpg', 'image/jpeg', 1000, 800)).toBe('jpeg');
    expect(planImage('a.webp', 'image/webp', 1000, 800)).toBe('jpeg');
    expect(planImage('a.heic', '', 4032, 3024)).toBe('jpeg');
    expect(planImage('s.png', 'image/png', 1170, 2532)).toBe('jpeg');
    expect(planImage('s.png', 'image/png', 1000, 2000)).toBe('keep');
    expect(planImage('f.pdf', 'application/pdf', 0, 0)).toBe('keep');
    expect(planImage('f.isdoc', 'application/xml', 0, 0)).toBe('keep');
  });
});

describe('needsDecode via planImage before size is known', () => {
  it('a PNG of unknown size is decoded only to measure it', () => {
    expect(planImage('s.png', 'image/png', null, null)).toBe('measure');
    expect(planImage('a.jpg', 'image/jpeg', null, null)).toBe('jpeg');
    expect(planImage('f.pdf', 'application/pdf', null, null)).toBe('keep');
  });
});

describe('scaledSize', () => {
  it('fits the long edge into MAX_EDGE and keeps the ratio', () => {
    expect(MAX_EDGE).toBe(2400);
    expect(scaledSize(4032, 3024)).toEqual({ width: 2400, height: 1800 });
    expect(scaledSize(3024, 4032)).toEqual({ width: 1800, height: 2400 });
  });
  it('never enlarges', () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('rounds and keeps at least 1 px', () => {
    expect(scaledSize(4801, 3)).toEqual({ width: 2400, height: 1 });
  });
});

describe('jpegName', () => {
  it('swaps the extension for .jpg', () => {
    expect(jpegName('IMG_0042.HEIC')).toBe('IMG_0042.jpg');
    expect(jpegName('receipt.photo.png')).toBe('receipt.photo.jpg');
    expect(jpegName('scan')).toBe('scan.jpg');
  });
});
```

3. Create `apps/web/src/documents/prepare-image.ts` with these exports; implement until the test passes:

```ts
export const MAX_EDGE = 2400;
export const JPEG_QUALITY = 0.88;
export function isHeic(name: string, type: string): boolean;
/** 'jpeg' = re-encode, 'keep' = send as is, 'measure' = a PNG whose size is not known yet. Width/height null = not decoded yet. */
export function planImage(name: string, type: string, width: number | null, height: number | null): 'jpeg' | 'keep' | 'measure';
export function scaledSize(width: number, height: number, max?: number): { width: number; height: number };
export function jpegName(name: string): string;
/** Browser only. Returns the file to upload, or null for a HEIC this browser cannot open. */
export async function prepareFile(file: File): Promise<File | null>;
```

   `planImage`: HEIC (by `isHeic`), `image/jpeg`, `image/webp` → `'jpeg'`; `image/png` → `'measure'` when width or height is null, `'jpeg'` when the long edge > `MAX_EDGE`, else `'keep'`; anything else → `'keep'`.
   `prepareFile`: plan with null sizes; `'keep'` → return the file. Else `createImageBitmap(file)` (on throw: `null` for HEIC, else the original file). Re-plan with the bitmap size; `'keep'` → close the bitmap, return the file. Else draw it on a `document.createElement('canvas')` sized by `scaledSize`, `canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)`; a null blob or missing 2D context → `null` for HEIC, else the original. Return `new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified })`. Always `bitmap.close()` (in `finally`). Never log file names or content.

   Run `pnpm --filter @shoebox/web test -- prepare-image 2>&1 | tail -30` → all pass.

4. Edit `upload-dropzone.tsx`:
   - add `import { prepareFile } from './prepare-image';` after the `react` import;
   - ACCEPT becomes `'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.isdoc,.isdocx,.xml'`;
   - in `send`, replace the excerpt's last two lines (`const body = new FormData();` and the `for` line) with:

```tsx
      const prepared = await Promise.all(files.map((file) => prepareFile(file)));
      const unreadable = prepared.filter((file) => file === null).length;
      const ready = prepared.filter((file): file is File => file !== null);
      if (ready.length === 0) {
        setMessage(t('inbox.upload.heic_unsupported', { n: unreadable }));
        return;
      }
      const body = new FormData();
      for (const file of ready) body.append('files', file);
```

   - replace the `.filter(...).map(...)` excerpt with:

```tsx
        .filter((part) => part.n > 0)
        .map((part) => t(part.key, { n: part.n }));
      if (unreadable > 0) parts.push(t('inbox.upload.heic_unsupported', { n: unreadable }));
```

   Run typecheck → no errors.

## 5. Do not touch

`apps/web/src/documents/upload.ts` and the API route (another thread owns them), `cs.json`. Hard rules 4 (no file names or content in logs), 6, 7 (no new dependency).

## 6. Commands

- `pnpm --filter @shoebox/web test -- prepare-image 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors.
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → passes.
- `pnpm exec biome check apps/web/src/documents apps/web/test packages/i18n 2>&1 | tail -30` → clean.

## 7. Acceptance

- [ ] Tests pass; CI green. `git diff --stat origin/phase/0` lists only §3 files plus this brief and its report.

## 8. Stop and ask

Stop and write the report as `blocked` if an excerpt is not found, a test fails twice, a file outside §3 needs a change, or you reach 25 tool calls.

## 9. Report

`docs/tasks/0102-report.md`, 300 tokens at most: files changed, last 5 lines of each command. Set `Status: review`.
