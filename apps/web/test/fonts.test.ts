import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(fileURLToPath(new URL('../app/layout.tsx', import.meta.url)), 'utf8');

describe('system font, no web font (07 §4)', () => {
  it('loads no font through next/font', () => {
    expect(layout).not.toContain('next/font');
    expect(layout).not.toContain('Inter');
  });

  it('sets lang="en" on <html>', () => {
    expect(layout).toContain('<html lang="en" data-theme={theme}>');
  });
});
