'use client';

import { t } from '@shoebox/i18n';
import { Button } from '@shoebox/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import type { FilingKind } from './card-view';

type State = 'idle' | 'busy' | 'done' | 'failed' | 'bad_date';

function Feedback({ state, doneText }: { state: State; doneText: string }) {
  if (state === 'done')
    return (
      <p role="status" className="text-body">
        {doneText}
      </p>
    );
  if (state === 'failed' || state === 'bad_date')
    return (
      <p role="alert" className="text-body">
        {state === 'bad_date' ? t('vat.mark_filed.bad_date') : t('vat.action.failed')}
      </p>
    );
  return null;
}

function usePost(url: string) {
  const router = useRouter();
  const [state, setState] = useState<State>('idle');
  async function post(body?: unknown) {
    setState('busy');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (res.ok) {
        setState('done');
        router.refresh();
      } else {
        setState(res.status === 400 ? 'bad_date' : 'failed');
      }
    } catch {
      setState('failed');
    }
  }
  return { state, post };
}

export function PrepareButton({
  periodStart,
  filingKind,
}: {
  periodStart: string;
  filingKind: FilingKind;
}) {
  const { state, post } = usePost(`/api/v1/vat/periods/${periodStart}/filings`);
  return (
    <div className="grid gap-1">
      <Button
        type="button"
        disabled={state === 'busy' || state === 'done'}
        onClick={() => post({ kind: filingKind })}
      >
        {t('vat.action.prepare')}
      </Button>
      <Feedback
        state={state === 'bad_date' ? 'failed' : state}
        doneText={t('vat.action.preparing')}
      />
    </div>
  );
}

export function WorkbookButton({ periodStart }: { periodStart: string }) {
  const { state, post } = usePost(`/api/v1/vat/periods/${periodStart}/workbook`);
  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant="secondary"
        disabled={state === 'busy' || state === 'done'}
        onClick={() => post()}
      >
        {t('vat.action.workbook')}
      </Button>
      <Feedback
        state={state === 'bad_date' ? 'failed' : state}
        doneText={t('vat.action.workbook_preparing')}
      />
    </div>
  );
}

const inputClass =
  'min-h-11 rounded-control border border-border bg-card px-3 text-body text-foreground';

export function MarkFiledForm({ filingId, today }: { filingId: string; today: string }) {
  const { state, post } = usePost(`/api/v1/filings/${filingId}/mark-filed`);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const filedOn = String(data.get('filedOn') ?? '');
    const ref = String(data.get('submissionRef') ?? '').trim();
    void post(ref === '' ? { filedOn } : { filedOn, submissionRef: ref });
  }
  return (
    <form onSubmit={submit} className="grid gap-3">
      <label className="grid gap-1 text-body">
        {t('vat.mark_filed.date')}
        <input
          type="date"
          name="filedOn"
          defaultValue={today}
          max={today}
          required
          className={inputClass}
        />
      </label>
      <label className="grid gap-1 text-body">
        {t('vat.mark_filed.ref')}
        <input type="text" name="submissionRef" maxLength={60} className={inputClass} />
      </label>
      <div>
        <Button type="submit" disabled={state === 'busy' || state === 'done'}>
          {t('vat.mark_filed.submit')}
        </Button>
      </div>
      <Feedback state={state} doneText={t('vat.mark_filed.done')} />
    </form>
  );
}
