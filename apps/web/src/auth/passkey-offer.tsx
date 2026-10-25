'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { Button } from '@shoebox/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { mapPasskeyError, type PasskeyErrorCode, passkeySupported } from './passkey';
import {
  finishPasskeyRegistration,
  skipPasskey,
  startPasskeyRegistration,
} from './passkey-actions';

const errorKeys: Readonly<Record<PasskeyErrorCode, MessageKey>> = {
  cancelled: 'auth.passkey.error.cancelled',
  expired: 'auth.passkey.error.expired',
  unsupported: 'auth.passkey.error.unsupported',
  unknown: 'auth.error.unknown',
};

/** Two buttons: add a passkey, or go on (ADR-012). A browser without passkeys goes on at once. */
export function PasskeyOffer({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<PasskeyErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!passkeySupported(window)) router.replace(next);
  }, [next, router]);

  function add() {
    setError(null);
    startTransition(async () => {
      const start = await startPasskeyRegistration();
      if (start.status === 'error') {
        setError(start.code);
        return;
      }
      let credential: unknown;
      try {
        // Supabase's options type is its own copy of the DOM JSON type.
        const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
          start.options as unknown as PublicKeyCredentialCreationOptionsJSON,
        );
        const created = await navigator.credentials.create({ publicKey });
        if (!(created instanceof PublicKeyCredential)) {
          setError('cancelled');
          return;
        }
        credential = created.toJSON();
      } catch (caught) {
        setError(mapPasskeyError(caught as { name?: string }));
        return;
      }
      const result = await finishPasskeyRegistration(start.challengeId, credential, next);
      if (result?.status === 'error') setError(result.code);
    });
  }

  return (
    <div className="grid gap-3">
      <Button type="button" onClick={add} disabled={pending} aria-busy={pending}>
        {t('auth.passkey.offer.cta')}
      </Button>
      <form action={skipPasskey} className="grid">
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="secondary">
          {t('auth.passkey.offer.later')}
        </Button>
      </form>
      <p role="status" aria-live="polite" className="min-h-6 text-body">
        {error && <span className="text-destructive">{t(errorKeys[error])}</span>}
      </p>
    </div>
  );
}
