'use client';
import { t } from '@shoebox/i18n';
import { Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, type DragEvent, useState } from 'react';
import { prepareFile } from './prepare-image';

type UploadAnswer = { items?: { status: 'accepted' | 'duplicate' | 'rejected' | 'statement' }[] };

const ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.isdoc,.isdocx,.xml,.gpc,.abo,.sta,.mt940';

/** One drop zone: drag files in or tap to pick them. Sends all files at once to POST /api/documents. */
export function UploadDropzone() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState('');

  async function send(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setMessage('');
    try {
      const prepared = await Promise.all(files.map((file) => prepareFile(file)));
      const unreadable = prepared.filter((file) => file === null).length;
      const ready = prepared.filter((file): file is File => file !== null);
      if (ready.length === 0) {
        setMessage(t('inbox.upload.heic_unsupported', { n: unreadable }));
        return;
      }
      const body = new FormData();
      for (const file of ready) body.append('files', file);
      const response = await fetch('/api/documents', { method: 'POST', body });
      if (!response.ok) {
        setMessage(t('inbox.upload.error'));
        return;
      }
      const answer = (await response.json()) as UploadAnswer;
      const items = Array.isArray(answer.items) ? answer.items : [];
      const count = (status: string) => items.filter((item) => item.status === status).length;
      const parts = [
        { n: count('accepted'), key: 'inbox.upload.accepted' as const },
        { n: count('duplicate'), key: 'inbox.upload.duplicate' as const },
        { n: count('statement'), key: 'inbox.upload.statement' as const },
        { n: count('rejected'), key: 'inbox.upload.rejected' as const },
      ]
        .filter((part) => part.n > 0)
        .map((part) => t(part.key, { n: part.n }));
      if (unreadable > 0) parts.push(t('inbox.upload.heic_unsupported', { n: unreadable }));
      setMessage(parts.join(' '));
    } catch {
      setMessage(t('inbox.upload.error'));
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

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
