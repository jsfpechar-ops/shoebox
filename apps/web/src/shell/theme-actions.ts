'use server';

import { cookies } from 'next/headers';
import { parseTheme, THEME_COOKIE, THEME_COOKIE_MAX_AGE } from './theme';

/** Server action: remembers the theme in a cookie (`system` deletes it). Input is parsed, never trusted. */
export async function saveTheme(value: string): Promise<void> {
  const choice = parseTheme(value);
  const store = await cookies();
  if (choice === 'system') {
    store.delete(THEME_COOKIE);
    return;
  }
  // A display preference, not a secret: httpOnly and lax; `secure` is left to the CSP/headers ticket.
  store.set(THEME_COOKIE, choice, {
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
  });
}
