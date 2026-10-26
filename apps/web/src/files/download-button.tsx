'use client';

import { t } from '@shoebox/i18n';
import { Button } from '@shoebox/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type State = 'idle' | 'busy' | 'changed' | 'not_ready' | 'forbidden' | 'failed';

function fileNameOf(res: Response, href: string): string {
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
  if (match?.[1] !== undefined) return match[1];
  const path = href.split('?')[0] ?? '';
  return path.split('/').pop() || 'download';
}

const MESSAGE: Record<Exclude<State, 'idle' | 'busy'>, () => string> = {
  changed: () => t('download.changed'),
  not_ready: () => t('download.not_ready'),
  forbidden: () => t('download.forbidden'),
  failed: () => t('download.failed'),
};

/** Fetches the file first, so a refusal becomes a sentence instead of raw JSON. */
export function DownloadButton({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>('idle');

  async function onClick() {
    setState('busy');
    try {
      const res = await fetch(href);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileNameOf(res, href);
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setState('idle');
        return;
      }
      if (res.status === 409) {
        const body: unknown = await res.json().catch(() => null);
        const error =
          typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
        if (error === 'period_changed') {
          setState('changed');
          router.refresh();
        } else {
          setState(error === 'not_generated' ? 'not_ready' : 'failed');
        }
      } else {
        setState(res.status === 403 ? 'forbidden' : 'failed');
      }
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="grid gap-1">
      <Button type="button" variant="secondary" disabled={state === 'busy'} onClick={onClick}>
        {state === 'busy' ? t('download.busy') : label}
      </Button>
      {state !== 'idle' && state !== 'busy' ? (
        <p role="alert" className="text-body">
          {MESSAGE[state]()}
        </p>
      ) : null}
    </div>
  );
}
