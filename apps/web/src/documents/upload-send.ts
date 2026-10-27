'use client';

import { t } from '@shoebox/i18n';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { prepareFile } from './prepare-image';

type UploadAnswer = { items?: { status: 'accepted' | 'duplicate' | 'rejected' | 'statement' }[] };

export type UploadResult = { ok: boolean; message: string };

/** Shared upload flow: prepare files, POST /api/documents, report the counts, refresh. */
export function useUploadSend(): {
  busy: boolean;
  message: string;
  send: (files: File[]) => Promise<UploadResult>;
} {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const send = useCallback(
    async (files: File[]): Promise<UploadResult> => {
      if (files.length === 0) return { ok: false, message: '' };
      setBusy(true);
      setMessage('');
      try {
        const prepared = await Promise.all(files.map((file) => prepareFile(file)));
        const unreadable = prepared.filter((file) => file === null).length;
        const ready = prepared.filter((file): file is File => file !== null);
        if (ready.length === 0) {
          const m = t('inbox.upload.heic_unsupported', { n: unreadable });
          setMessage(m);
          return { ok: false, message: m };
        }
        const body = new FormData();
        for (const file of ready) body.append('files', file);
        const response = await fetch('/api/documents', { method: 'POST', body });
        if (!response.ok) {
          const m = t('inbox.upload.error');
          setMessage(m);
          return { ok: false, message: m };
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
        const m = parts.join(' ');
        setMessage(m);
        return { ok: true, message: m };
      } catch {
        const m = t('inbox.upload.error');
        setMessage(m);
        return { ok: false, message: m };
      } finally {
        setBusy(false);
        router.refresh();
      }
    },
    [router],
  );

  return { busy, message, send };
}
