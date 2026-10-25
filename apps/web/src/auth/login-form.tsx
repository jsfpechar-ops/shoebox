'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { Button, Input } from '@shoebox/ui';
import { useActionState, useId } from 'react';
import { sendMagicLink } from './actions';
import type { AuthActionState, AuthErrorCode } from './schemas';

const idle: AuthActionState = { status: 'idle' };

const errorKeys: Readonly<Record<AuthErrorCode, MessageKey>> = {
  invalid_email: 'auth.error.invalid_email',
  rate_limited: 'auth.error.rate_limited',
  link: 'auth.error.link',
  unknown: 'auth.error.unknown',
};

/** The result is announced without moving focus (07 §8). Body size, no fine print (07 rule 13). */
function Status({ state }: { state: AuthActionState }) {
  return (
    <p role="status" aria-live="polite" className="min-h-6 text-body">
      {state.status === 'sent' && (
        <span className="text-success">{t('auth.magic.sent', { email: state.email })}</span>
      )}
      {state.status === 'error' && (
        <span className="text-destructive">{t(errorKeys[state.code])}</span>
      )}
    </p>
  );
}

/** One e-mail field, one button (ADR-012, owner 2026-10-25: passkey and e-mail only). */
export function LoginForm({ next }: { next: string }) {
  const id = useId();
  const [state, action, pending] = useActionState(sendMagicLink, idle);

  return (
    <form action={action} className="grid gap-3" aria-label={t('auth.magic.title')}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor={`${id}-email`} className="text-body font-medium">
        {t('auth.field.email')}
      </label>
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="text-body">
        {t('auth.magic.hint')}
      </p>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('auth.magic.cta')}
      </Button>
      <Status state={state} />
    </form>
  );
}
