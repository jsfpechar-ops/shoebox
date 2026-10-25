import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { parseTheme, THEME_COOKIE, themeAttribute } from '../src/shell/theme';
import './globals.css';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = themeAttribute(parseTheme((await cookies()).get(THEME_COOKIE)?.value));
  return (
    <html lang="en" data-theme={theme}>
      <body className="min-h-dvh bg-background font-sans text-body text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
