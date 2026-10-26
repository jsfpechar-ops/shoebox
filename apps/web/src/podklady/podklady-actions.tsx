'use client';

import { t } from '@shoebox/i18n';
import { Button } from '@shoebox/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type State = 'idle' | 'busy' | 'done' | 'failed';

export function PrepareSummaryButton({
  year,
  answers,
}: {
  year: number;
  answers?: Record<string, unknown>;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>('idle');

  async function prepare() {
    setState('busy');
    try {
      const response = await fetch(`/api/v1/podklady/${year}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answers === undefined ? {} : { answers }),
      });
      if (response.status === 202) {
        setState('done');
        router.refresh();
        return;
      }
      setState('failed');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="grid gap-1">
      <Button
        type="button"
        disabled={state === 'busy' || state === 'done'}
        onClick={() => void prepare()}
      >
        {t('podklady.action.prepare')}
      </Button>
      {state === 'done' ? (
        <p role="status" className="text-body">
          {t('podklady.action.preparing')}
        </p>
      ) : null}
      {state === 'failed' ? (
        <p role="alert" className="text-body">
          {t('podklady.action.failed')}
        </p>
      ) : null}
    </div>
  );
}
