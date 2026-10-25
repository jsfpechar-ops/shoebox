import { type MessageKey, t } from '@shoebox/i18n';
import type { Metadata } from 'next';
import { LoginForm } from '../../../src/auth/login-form';
import { PasskeySignIn } from '../../../src/auth/passkey-sign-in';
import { type LoginReason, parseLoginReason, safeNextPath } from '../../../src/auth/session';

export const metadata: Metadata = { title: t('auth.login.title') };

/** Notice above the form (M11 §7 "Session expired" copy for `idle`). */
const noticeKeys: Readonly<Record<LoginReason, MessageKey>> = {
  idle: 'auth.notice.idle',
  link: 'auth.error.link',
  signed_out: 'auth.notice.signed_out',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const reason = parseLoginReason(params.reason);
  return (
    <div className="grid gap-6">
      <h1 className="text-title">{t('auth.login.title')}</h1>
      {reason && (
        <p role="status" className="rounded-card border border-border bg-card p-4 text-body">
          {t(noticeKeys[reason])}
        </p>
      )}
      <PasskeySignIn next={next} />
      <LoginForm next={next} />
    </div>
  );
}
