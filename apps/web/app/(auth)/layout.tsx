import { t } from '@shoebox/i18n';
import type { ReactNode } from 'react';

/** Login pages: no app nav (the user has no session yet); the same landmarks as the shell (07 §8). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header
        data-slot="auth-header"
        className="flex min-h-14 items-center border-b border-border bg-card px-4 md:px-6"
      >
        <p className="text-card-title">{t('shell.app.name')}</p>
      </header>
      <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-md px-4 py-10 outline-none">
        {children}
      </main>
    </>
  );
}
