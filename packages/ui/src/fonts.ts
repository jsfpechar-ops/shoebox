/**
 * The device's own font, as Notion uses (07 §4, owner 2026-10-25): San Francisco on Apple,
 * Segoe UI on Windows, Roboto/Arial elsewhere. Nothing is downloaded. theme.css repeats this
 * stack in `--font-sans`; test/theme.test.ts checks they match.
 */
export const systemFontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' as const;

export const fontWeights = [400, 500, 600] as const;
