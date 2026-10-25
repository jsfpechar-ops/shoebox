'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { cn, focusRing } from '@shoebox/ui';
import { useId, useState } from 'react';

/** A "?" beside a term. It opens a two-sentence explanation in place (07 §2 rule 12). */
export function HelpTip({ term, text }: { term: MessageKey; text: MessageKey }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={t('help.ask', { term: t(term) })}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-body font-medium text-foreground hover:opacity-80',
          focusRing,
        )}
      >
        {'?'}
      </button>
      {open && (
        <p id={id} className="text-body">
          {t(text)}
        </p>
      )}
    </>
  );
}
