import { t } from '@shoebox/i18n';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LogoutButtons } from '../../src/auth/logout-buttons';
import { needsOnboarding, supabaseMembershipCounter } from '../../src/onboarding/gate';
import { AppNav } from '../../src/shell/app-nav';
import { parseTheme, THEME_COOKIE } from '../../src/shell/theme';
import { ThemeSwitch } from '../../src/shell/theme-switch';
import { createSupabaseServerClient } from '../../src/supabase/server';

/** App shell (07 §5, §8): skip link, header, nav, main. Server component; AppNav and ThemeSwitch are the client islands. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  if (await needsOnboarding(supabaseMembershipCounter(await createSupabaseServerClient())))
    redirect('/vitejte');
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <a
        href="#obsah"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-card focus:px-4 focus:py-3 focus:text-foreground focus:outline-none focus:ring-[3px] focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        {t('shell.skip_link')}
      </a>
      <header
        data-slot="app-header"
        className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-2 md:px-6"
      >
        <p className="text-card-title">{t('shell.app.name')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <ThemeSwitch initial={theme} />
          <LogoutButtons />
        </div>
      </header>
      <div className="md:flex">
        <AppNav />
        <main
          id="obsah"
          tabIndex={-1}
          className="mx-auto w-full min-w-0 max-w-content flex-1 px-4 pt-6 pb-32 outline-none md:px-6 md:pb-12"
        >
          {children}
        </main>
      </div>
    </>
  );
}
