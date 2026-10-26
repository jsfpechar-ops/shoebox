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
