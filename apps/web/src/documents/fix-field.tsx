'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { Button, Input } from '@shoebox/ui';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { EDITABLE, type EditKey, type FixKind } from './correction';
import { type FixState, fixFieldAction } from './correction-actions';
import { OPEN_FIX_EVENT } from './issue-questions';
import { cleanPicked, isPickTarget, PICK_EVENT, requestLocate, setPickTarget } from './pick';

const idle: FixState = { error: null, saved: false, suggestion: null };

// The same cs-CZ currency pattern as the VAT preview, with cents: a total is never shown rounded.
const CZK2 = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onOpenFix(event: Event) {
      if ((event as CustomEvent).detail === editKey) setOpen(true);
    }
    window.addEventListener(OPEN_FIX_EVENT, onOpenFix);
    return () => window.removeEventListener(OPEN_FIX_EVENT, onOpenFix);
  }, [editKey]);

  useEffect(() => {
    if (state.saved) setOpen(false);
  }, [state.saved]);

  useEffect(() => {
    if (!open) return;
    setPickTarget(id);
    requestLocate(kind, current);
    function onPick(event: Event) {
      if (!isPickTarget(id) || !inputRef.current) return;
      const value = cleanPicked(kind, String((event as CustomEvent).detail ?? ''));
      if (value === null) return;
      inputRef.current.value = value;
      inputRef.current.focus();
    }
    window.addEventListener(PICK_EVENT, onPick);
    return () => window.removeEventListener(PICK_EVENT, onPick);
  }, [open, id, kind, current]);

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
        {state.saved && state.suggestion ? (
          <form action={action} className="flex flex-col gap-1">
            <input type="hidden" name="id" value={documentId} />
            <input type="hidden" name="key" value={state.suggestion.editKey} />
            <input type="hidden" name="value" value={state.suggestion.value} />
            <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
              {t('doc.fix.suggest', {
                field: t(EDITABLE[state.suggestion.editKey].label),
                amount: CZK2.format(state.suggestion.value as unknown as number),
              })}
            </Button>
            <p className="text-body text-muted-foreground">{t('doc.fix.suggest_help')}</p>
          </form>
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
          ref={inputRef}
          onFocus={() => setPickTarget(id)}
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
      <p className="text-body text-muted-foreground">{t('doc.fix.pick_hint')}</p>
      {state.error ? (
        <p id={errorId} role="alert" className="text-body text-destructive">
          {t(state.error)}
        </p>
      ) : null}
    </div>
  );
}
