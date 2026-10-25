import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';
import { PasskeyOffer } from '../../../src/auth/passkey-offer';
import { safeNextPath } from '../../../src/auth/session';

export const metadata: Metadata = { title: t('auth.passkey.offer.title') };

/** Shown once after an e-mail-link sign-in (ADR-012). The middleware already requires a session here. */
export default async function PasskeyOfferPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  return (
    <div className="grid gap-6">
      <h1 className="text-title">{t('auth.passkey.offer.title')}</h1>
      <p className="text-body">{t('auth.passkey.offer.body')}</p>
      <PasskeyOffer next={next} />
    </div>
  );
}
