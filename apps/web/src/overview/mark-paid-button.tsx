'use client';

import { t } from '@shoebox/i18n';
import { Button } from '@shoebox/ui';
import { useActionState } from 'react';
import { type MarkPaidState, markPaidAction } from './mark-paid-action';

const idle: MarkPaidState = { error: null, done: false };

/** One tap to mark a bill as paid. Errors are announced with role="alert". */
export function MarkPaidButton({ documentId, label }: { documentId: string; label: string }) {
  const [state, action, pending] = useActionState(markPaidAction, idle);
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="id" value={documentId} />
      <Button type="submit" variant="secondary" disabled={pending} aria-label={label}>
        {t('overview.bills.mark_paid')}
      </Button>
      {state.error !== null ? (
        <p role="alert" className="text-body text-destructive">
          {t(state.error)}
        </p>
      ) : null}
    </form>
  );
}
