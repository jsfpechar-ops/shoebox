'use client';

import { t } from '@shoebox/i18n';
import { Button, Card } from '@shoebox/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import { type KeepBothState, keepBothAction } from './duplicate-actions';

const idle: KeepBothState = { error: null };

/** Shown on a duplicate's page: what it repeats, and one button for "two different invoices". */
export function DuplicateNotice({
  documentId,
  originalId,
  canAct,
}: {
  documentId: string;
  originalId: string | null;
  canAct: boolean;
}) {
  const [state, action, pending] = useActionState(keepBothAction, idle);
  return (
    <Card className="flex flex-col gap-3 p-6">
      <p className="text-body">{t('doc.duplicate.notice')}</p>
      {originalId ? (
        <Link prefetch={false} href={`/inbox/${originalId}`} className="text-body underline">
          {t('doc.duplicate.open_original')}
        </Link>
      ) : null}
      {canAct ? (
        <form action={action}>
          <input type="hidden" name="id" value={documentId} />
          <Button type="submit" variant="secondary" disabled={pending}>
            {t('doc.duplicate.keep_both')}
          </Button>
        </form>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-body text-destructive">
          {t(state.error)}
        </p>
      ) : null}
    </Card>
  );
}
