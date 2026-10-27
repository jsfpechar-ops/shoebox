'use client';
import { t } from '@shoebox/i18n';
import { cn, focusRing, motion } from '@shoebox/ui';
import { Upload } from 'lucide-react';
import { type ChangeEvent, type DragEvent, useState } from 'react';
import { useUploadSend } from './upload-send';

const ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.isdoc,.isdocx,.xml,.gpc,.abo,.sta,.mt940';

/** One drop zone: drag files in or tap to pick them. Sends all files at once to POST /api/documents. */
export function UploadDropzone() {
  const { busy, message, send } = useUploadSend();
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void send(Array.from(event.dataTransfer.files));
  }

  function onDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(true);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    void send(Array.from(event.currentTarget.files ?? []));
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed bg-card p-6 text-center focus-within:ring-[3px] focus-within:ring-ring ${dragging ? 'border-ring' : 'border-border'}`}
      >
        <input
          type="file"
          multiple
          accept={ACCEPT}
          disabled={busy}
          onChange={onChange}
          className="sr-only"
        />
        <Upload aria-hidden="true" className="size-6 text-foreground" />
        <span className="text-card-title text-foreground">
          {busy ? t('inbox.upload.busy') : t('inbox.upload.cta')}
        </span>
        <span className="text-body text-foreground">{t('inbox.upload.hint')}</span>
      </label>
      <p aria-live="polite" className="text-body text-foreground">
        {message}
      </p>
    </div>
  );
}
