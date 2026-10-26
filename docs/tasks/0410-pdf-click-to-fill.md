# 0410: PDF click-to-fill on the document page

Status: todo
Ticket: lane D, M11 §5.6 | Depends on: none | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The document page shows a PDF itself (first 5 pages) with its words selectable. When a "Fix" input is open, clicking a word or selecting a few words on the invoice puts them, cleaned up, into that input. Laymen point at the number instead of retyping it.

## 2. Context

- Dependency approved (decisions.md 2026-10-26): `pdfjs-dist` **6.4.299** exactly.
- CSP (`src/security/headers.ts`): `worker-src 'self' blob:`, `script-src 'self' 'nonce-…' 'strict-dynamic'`; pdf.js sets styles through CSSOM (allowed). The signed file URL is on the Supabase origin, already in `connect-src`.
- `apps/web/src/documents/fix-field.tsx`: when open it renders `<Input name="value" … defaultValue={current} autoFocus …/>`; `kind` is `'text' | 'date' | 'money'`. The server's money format is `1210.50`; a date input needs `YYYY-MM-DD`.
- Document page `apps/web/app/(app)/inbox/[id]/page.tsx` ends with: when `detail.file && fileUrl`, an `<img>` for images, else an `<a … >{t('doc.detail.open_file')}</a>` link.
- 07: tokens only (`globals.css` header says no raw colours); the text layer is transparent text over the canvas.

## 3. Files

| Path | Action |
|---|---|
| `apps/web/package.json` | edit: `"pdfjs-dist": "6.4.299"` in dependencies (alphabetical), `pnpm install 2>&1 | tail -3` |
| `apps/web/src/documents/pick.ts` | new (pure + event) |
| `apps/web/test/pick.test.ts` | new (below) |
| `apps/web/src/documents/pdf-viewer.tsx` | new (code below) |
| `apps/web/src/documents/fix-field.tsx` | edit |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | edit |
| `apps/web/app/globals.css` | edit: text layer CSS |
| `packages/i18n/messages/en.json` | edit: keys |

## 4. Steps

1. package.json + install.
2. `en.json` keys (after `"doc.fix.error.save"`):
   ```
     "doc.fix.pick_hint": "Or click the value on the document.",
     "doc.pdf.label": "The document",
     "doc.pdf.failed": "We can't show this file here.",
     "doc.pdf.more_pages": "Only the first {n} pages are shown here.",
   ```
3. New `apps/web/src/documents/pick.ts`:
   ```ts
   import type { FixKind } from './correction';
   export const PICK_EVENT = 'sysel:pick';
   let active: string | null = null;
   /** The open Fix input that last had focus receives picks. */
   export function setPickTarget(id: string | null): void { active = id; }
   export function isPickTarget(id: string): boolean { return active === id; }
   /** Picked words → the input's format: money '8 150,00 Kč' → '8150.00'; date '30. 9. 2026' or '30.09.2026' → '2026-09-30'; text trimmed, spaces collapsed, ≤ 200 chars. null when nothing usable. */
   export function cleanPicked(kind: FixKind, raw: string): string | null;
   ```
   Money: drop everything except digits, `,`, `.`, `-`; if both `,` and `.` occur, the last one is the decimal mark and the other is removed; a single `,` is the decimal mark; result must match `/^-?\d+(\.\d{1,2})?$/` (pad to 2 decimals when a mark exists), else null. Date: `/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/` → zero-padded ISO; or already `YYYY-MM-DD`; else null. Test `apps/web/test/pick.test.ts` (do not edit):
   ```ts
   import { describe, expect, it } from 'vitest';
   import { cleanPicked, isPickTarget, setPickTarget } from '../src/documents/pick';

   describe('cleanPicked', () => {
     it('money from Czech and English formats', () => {
       expect(cleanPicked('money', '8 150,00 Kč')).toBe('8150.00');
       expect(cleanPicked('money', '1,210.5')).toBe('1210.50');
       expect(cleanPicked('money', '1.210,50')).toBe('1210.50');
       expect(cleanPicked('money', '350')).toBe('350');
       expect(cleanPicked('money', 'Celkem')).toBeNull();
     });
     it('dates to ISO', () => {
       expect(cleanPicked('date', '30. 9. 2026')).toBe('2026-09-30');
       expect(cleanPicked('date', 'Datum: 01.10.2026')).toBe('2026-10-01');
       expect(cleanPicked('date', '2026-10-01')).toBe('2026-10-01');
       expect(cleanPicked('date', 'zítra')).toBeNull();
     });
     it('text trimmed and collapsed', () => {
       expect(cleanPicked('text', '  FV   2026/0412 ')).toBe('FV 2026/0412');
       expect(cleanPicked('text', '   ')).toBeNull();
     });
   });

   describe('pick target', () => {
     it('only the last focused input receives picks', () => {
       setPickTarget('a');
       expect(isPickTarget('a')).toBe(true);
       setPickTarget('b');
       expect(isPickTarget('a')).toBe(false);
       setPickTarget(null);
       expect(isPickTarget('b')).toBe(false);
     });
   });
   ```
4. New `apps/web/src/documents/pdf-viewer.tsx` (use as given; fix only type errors, keeping behaviour):
   ```tsx
   'use client';

   import { t } from '@shoebox/i18n';
   import { useEffect, useRef, useState } from 'react';
   import { PICK_EVENT } from './pick';

   const MAX_PAGES = 5;

   /** Draws the PDF (first pages) with a transparent text layer; a click or selection sends the words as a pick. */
   export function PdfViewer({ url }: { url: string }) {
     const ref = useRef<HTMLDivElement>(null);
     const [failed, setFailed] = useState(false);
     const [pages, setPages] = useState(0);

     useEffect(() => {
       const root = ref.current;
       if (!root) return;
       let cancelled = false;
       (async () => {
         try {
           const pdfjs = await import('pdfjs-dist');
           pdfjs.GlobalWorkerOptions.workerSrc = new URL(
             'pdfjs-dist/build/pdf.worker.min.mjs',
             import.meta.url,
           ).toString();
           const doc = await pdfjs.getDocument({ url, isEvalSupported: false }).promise;
           if (!cancelled) setPages(doc.numPages);
           const width = root.clientWidth || 600;
           for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES) && !cancelled; n++) {
             const page = await doc.getPage(n);
             const scale = width / page.getViewport({ scale: 1 }).width;
             const viewport = page.getViewport({ scale });
             const ratio = window.devicePixelRatio || 1;
             const wrap = document.createElement('div');
             wrap.className = 'sysel-pdf-page';
             wrap.style.width = `${viewport.width}px`;
             wrap.style.height = `${viewport.height}px`;
             const canvas = document.createElement('canvas');
             canvas.width = Math.floor(viewport.width * ratio);
             canvas.height = Math.floor(viewport.height * ratio);
             canvas.style.width = `${viewport.width}px`;
             canvas.style.height = `${viewport.height}px`;
             canvas.setAttribute('aria-hidden', 'true');
             const text = document.createElement('div');
             text.className = 'sysel-text-layer';
             text.style.setProperty('--total-scale-factor', String(scale));
             wrap.append(canvas, text);
             root.append(wrap);
             const params =
               ratio === 1
                 ? { canvas, viewport }
                 : { canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] };
             await page.render(params).promise;
             await new pdfjs.TextLayer({
               textContentSource: page.streamTextContent(),
               container: text,
               viewport,
             }).render();
           }
         } catch {
           if (!cancelled) setFailed(true);
         }
       })();
       return () => {
         cancelled = true;
         root.replaceChildren();
       };
     }, [url]);

     function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
       const selected = window.getSelection()?.toString() ?? '';
       const target = event.target instanceof HTMLElement ? event.target : null;
       const words = selected.trim() !== '' ? selected : target?.tagName === 'SPAN' ? (target.textContent ?? '') : '';
       if (words.trim() !== '') window.dispatchEvent(new CustomEvent(PICK_EVENT, { detail: words }));
     }

     if (failed) return <p className="text-body">{t('doc.pdf.failed')}</p>;
     return (
       <figure className="flex flex-col gap-2">
         <figcaption className="sr-only">{t('doc.pdf.label')}</figcaption>
         <div
           ref={ref}
           onPointerUp={onPointerUp}
           className="flex w-full flex-col gap-4 overflow-hidden rounded-control border border-border bg-card"
         />
         {pages > MAX_PAGES ? <p className="text-body">{t('doc.pdf.more_pages', { n: MAX_PAGES })}</p> : null}
       </figure>
     );
   }
   ```
5. `globals.css`, append:
   ```css
   /* pdf.js text layer (0410): transparent words over the canvas, same geometry as pdf.js web/pdf_viewer.css. */
   .sysel-pdf-page { position: relative; }
   .sysel-text-layer { position: absolute; inset: 0; overflow: clip; line-height: 1; transform-origin: 0 0; --min-font-size: 1; --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size)); --min-font-size-inv: calc(1 / var(--min-font-size)); }
   .sysel-text-layer :is(span, br) { color: transparent; position: absolute; white-space: pre; cursor: pointer; transform-origin: 0% 0%; user-select: text; }
   .sysel-text-layer > :not(.markedContent), .sysel-text-layer .markedContent span:not(.markedContent) { --font-height: 0; font-size: calc(var(--text-scale-factor) * var(--font-height)); --scale-x: 1; --rotate: 0deg; transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
   .sysel-text-layer .markedContent { display: contents; }
   .sysel-text-layer span:hover { outline: 2px solid var(--color-ring); }
   .sysel-text-layer ::selection { background: var(--color-muted); }
   ```
   Check the token names exist: `grep -n "color-ring\|color-muted" packages/ui/src/theme.css | head -3`; if a name differs, use the existing one for focus ring and muted fill.
6. `fix-field.tsx`: add `useRef` to the react import and `import { cleanPicked, isPickTarget, PICK_EVENT, setPickTarget } from './pick';`. Add `const inputRef = useRef<HTMLInputElement>(null);` after `useActionState`. Add an effect:
   ```tsx
   useEffect(() => {
     if (!open) return;
     setPickTarget(id);
     function onPick(event: Event) {
       if (!isPickTarget(id) || !inputRef.current) return;
       const value = cleanPicked(kind, String((event as CustomEvent).detail ?? ''));
       if (value === null) return;
       inputRef.current.value = value;
       inputRef.current.focus();
     }
     window.addEventListener(PICK_EVENT, onPick);
     return () => window.removeEventListener(PICK_EVENT, onPick);
   }, [open, id, kind]);
   ```
   On the `<Input name="value"` add `ref={inputRef}` and `onFocus={() => setPickTarget(id)}`. Directly after the closing `</form>` add `<p className="text-body text-muted-foreground">{t('doc.fix.pick_hint')}</p>` (only shown while open, which is already the case there). If `Input` does not forward `ref` (check `packages/ui/src/primitives/basic.tsx` line ~53: React 19 passes `ref` as a prop through `...props`), it works as is.
7. Document page: import `PdfViewer`. Replace the `<a href={fileUrl} …>{t('doc.detail.open_file')}</a>` branch with a fragment: `detail.file.mimeType === 'application/pdf' ? <PdfViewer url={fileUrl} /> : null` followed by the same `<a>` link. Then make the fields + file side by side on wide screens: wrap the whole file block in `<div className="lg:sticky lg:top-6">…</div>` and change the page's outer `<div className="flex flex-col gap-6">` (the second one, of the found document) to `<div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start">`; the back link, the title row and the trash form (if present) get `className` additions `lg:col-span-2` where they are direct children (wrap the title row's existing div class). Keep everything else.
8. `pnpm --filter @shoebox/web test -- pick 2>&1 | tail -20`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`, `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`, `pnpm exec biome check apps/web packages/i18n 2>&1 | tail -15` (fix your files with `--write`), `pnpm --filter @shoebox/web build 2>&1 | tail -15` (must succeed; the pdf.js worker is emitted as a static asset).

## 5. Do not touch

`correction*.ts`, other screens, `headers.ts`. Exactly this one new dependency. Hard rules 4, 6, 7.

## 6. Commands

As in step 8.

## 7. Acceptance

- [ ] pick tests pass; typecheck 0; biome clean; web build succeeds.

## 8. Stop and ask

As TEMPLATE §8. If the build fails on pdf.js bundling twice, stop and report the last 15 lines.

## 9. Report

`docs/tasks/0410-report.md`, 150 tokens at most. Set `Status: review`.
