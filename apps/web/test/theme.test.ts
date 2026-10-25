import { describe, expect, it } from 'vitest';
import { parseTheme, THEME_COOKIE, themeAttribute, themeChoices } from '../src/shell/theme';

describe('theme choice (07 §3)', () => {
  it('offers system, light and dark, in that order', () => {
    expect(themeChoices).toEqual(['system', 'light', 'dark']);
    expect(THEME_COOKIE).toBe('theme');
  });

  it('parses only light and dark; anything else is system', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme(undefined)).toBe('system');
    expect(parseTheme('')).toBe('system');
    expect(parseTheme('DARK')).toBe('system');
    expect(parseTheme('<script>')).toBe('system');
  });

  it('maps system to no data-theme attribute', () => {
    expect(themeAttribute('system')).toBeUndefined();
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });
});
