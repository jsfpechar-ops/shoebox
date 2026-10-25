'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { Button, Input } from '@shoebox/ui';
import { useActionState, useEffect, useId, useState } from 'react';
import type { EditKey, FixKind } from './correction';
import { type FixState, fixFieldAction } from './correction-actions';

const idle: FixState = { error: null, saved: false };

/** A closed "Fix" link opens one input with Save and Cancel. Errors are announced with role="alert". */
export function FixField({
  documentId,
  editKey,
  kind,
  label,
  current,
}: {
  documentId: string;
  editKey: EditKey;
  kind: FixKind;
  label: MessageKey;
  current: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(fixFieldAction, idle);

  useEffect(() => {
    if (state.saved) setOpen(false);
  }, [state.saved]);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="link"
          type="button"
          aria-label={`${t('doc.fix.cta')}: ${t(label)}`}
          onClick={() => setOpen(true)}
        >
          {t('doc.fix.cta')}
        </Button>
        {state.saved ? (
          <p role="status" className="text-body">
            {t('doc.fix.saved')}
          </p>
        ) : null}
      </div>
    );
  }

  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex flex-wrap items-center gap-2" aria-label={t(label)}>
        <input type="hidden" name="id" value={documentId} />
        <input type="hidden" name="key" value={editKey} />
        <Input
          name="value"
          type={kind === 'date' ? 'date' : 'text'}
          inputMode={kind === 'money' ? 'decimal' : undefined}
          defaultValue={current}
          autoFocus
          aria-label={t(label)}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? errorId : undefined}
        />
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {t('doc.fix.save')}
        </Button>
        <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
          {t('doc.fix.cancel')}
        </Button>
      </form>
      {state.error ? (
        <p id={errorId} role="alert" className="text-body text-destructive">
          {t(state.error)}
        </p>
      ) : null}
    </div>
  );
}
