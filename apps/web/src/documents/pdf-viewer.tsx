'use client';

import { t } from '@shoebox/i18n';
import { useEffect, useRef, useState } from 'react';
import type { FixKind } from './correction';
import { findMatch, type TextItem } from './locate';
import { LOCATE_EVENT, PICK_EVENT } from './pick';

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
    const items: TextItem[] = [];
    const wraps: HTMLElement[] = [];
    let pending: { kind: FixKind; value: string } | null = null;
    let box: HTMLElement | null = null;

    function locate(): void {
      if (!pending) return;
      const m = findMatch(items, pending.kind, pending.value);
      box?.remove();
      box = null;
      const wrap = m ? wraps[m.page - 1] : undefined;
      if (!m || !wrap) return;
      pending = null;
      box = document.createElement('div');
      box.setAttribute('aria-hidden', 'true');
      box.style.cssText = `position:absolute;pointer-events:none;border-radius:2px;background:color-mix(in srgb, var(--color-focus) 45%, transparent);left:${m.rect.x}px;top:${m.rect.y}px;width:${m.rect.w}px;height:${m.rect.h}px`;
      wrap.append(box);
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      box.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    }
    function onLocate(event: Event): void {
      const d = (event as CustomEvent).detail as { kind: FixKind; value: string } | undefined;
      if (!d) return;
      pending = d;
      locate();
    }
    window.addEventListener(LOCATE_EVENT, onLocate);
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({ url }).promise;
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
          wraps[n - 1] = wrap;
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
          const content = await page.getTextContent();
          for (const raw of content.items) {
            if (!('str' in raw) || raw.str.trim() === '') continue;
            const tx = pdfjs.Util.transform(viewport.transform, raw.transform);
            const h = raw.height * scale;
            items.push({
              str: raw.str,
              page: n,
              x: tx[4] ?? 0,
              y: (tx[5] ?? 0) - h,
              w: raw.width * scale,
              h,
            });
          }
          locate();
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener(LOCATE_EVENT, onLocate);
      root.replaceChildren();
    };
  }, [url]);

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const selected = window.getSelection()?.toString() ?? '';
    const target = event.target instanceof HTMLElement ? event.target : null;
    const words =
      selected.trim() !== ''
        ? selected
        : target?.tagName === 'SPAN'
          ? (target.textContent ?? '')
          : '';
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
      {pages > MAX_PAGES ? (
        <p className="text-body">{t('doc.pdf.more_pages', { n: MAX_PAGES })}</p>
      ) : null}
    </figure>
  );
}
