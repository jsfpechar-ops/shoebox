import { t } from '@shoebox/i18n';
import type { ReactNode } from 'react';

/** Onboarding: no app nav (the firm does not exist yet); the same landmarks as the shell (07 §8). */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header
        data-slot="onboarding-header"
        className="flex min-h-14 items-center border-b border-border bg-card px-4 md:px-6"
      >
        <p className="text-card-title">{t('shell.app.name')}</p>
      </header>
      <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-xl px-4 py-10 outline-none">
        {children}
      </main>
    </>
  );
}
