'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { Button } from '@shoebox/ui';
import { useEffect, useState, useTransition } from 'react';
import { mapPasskeyError, type PasskeyErrorCode, passkeySupported } from './passkey';
import { finishPasskeySignIn, startPasskeySignIn } from './passkey-actions';

const errorKeys: Readonly<Record<PasskeyErrorCode, MessageKey>> = {
  cancelled: 'auth.passkey.error.cancelled',
  expired: 'auth.passkey.error.expired',
  unsupported: 'auth.passkey.error.unsupported',
  unknown: 'auth.passkey.error.signin',
};

/** One button above the e-mail form (ADR-012). Rendered only where the browser can use passkeys. */
export function PasskeySignIn({ next }: { next: string }) {
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<PasskeyErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setSupported(passkeySupported(window));
  }, []);

  if (!supported) return null;

  function signIn() {
    setError(null);
    startTransition(async () => {
      const start = await startPasskeySignIn();
      if (start.status === 'error') {
        setError(start.code);
        return;
      }
      let credential: unknown;
      try {
        // Supabase's options type is its own copy of the DOM JSON type.
        const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(
          start.options as unknown as PublicKeyCredentialRequestOptionsJSON,
        );
        const found = await navigator.credentials.get({ publicKey });
        if (!(found instanceof PublicKeyCredential)) {
          setError('cancelled');
          return;
        }
        credential = found.toJSON();
      } catch (caught) {
        setError(mapPasskeyError(caught as { name?: string }));
        return;
      }
      const result = await finishPasskeySignIn(start.challengeId, credential, next);
      if (result?.status === 'error') setError(result.code);
    });
  }

  return (
    <div className="grid gap-3">
      <Button type="button" onClick={signIn} disabled={pending} aria-busy={pending}>
        {t('auth.passkey.signin.cta')}
      </Button>
      <p role="status" aria-live="polite" className="min-h-6 text-body">
        {error && <span className="text-destructive">{t(errorKeys[error])}</span>}
      </p>
      <p className="text-body">{t('auth.passkey.signin.or')}</p>
    </div>
  );
}
