/**
 * Theme choice (07 §3): `system` follows prefers-color-scheme; `light` and `dark` set
 * <html data-theme>, which tokens.css and the Tailwind `dark` variant read. Pure: server, client, tests.
 */
export const themeChoices = ['system', 'light', 'dark'] as const;

export type ThemeChoice = (typeof themeChoices)[number];

/** Cookie that remembers a manual choice; no cookie means `system`. */
export const THEME_COOKIE = 'theme';

/** One year, in seconds. */
export const THEME_COOKIE_MAX_AGE = 31_536_000;

export function parseTheme(value: string | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** The value for <html data-theme>; undefined for `system`, so the media query in tokens.css applies. */
export function themeAttribute(choice: ThemeChoice): 'light' | 'dark' | undefined {
  return choice === 'system' ? undefined : choice;
}
