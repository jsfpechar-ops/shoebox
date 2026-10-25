// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { fontWeights, systemFontStack } from '../src/fonts';

const themePath = fileURLToPath(new URL('../src/theme.css', import.meta.url));
const tailwindCss = fileURLToPath(
  new URL('../node_modules/tailwindcss/index.css', import.meta.url),
);

async function build(candidates: string[]): Promise<string> {
  const compiler = await compile(readFileSync(themePath, 'utf8'), {
    base: dirname(themePath),
    loadStylesheet: async (id, base) => {
      const path = id === 'tailwindcss' ? tailwindCss : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  return compiler.build(candidates);
}

describe('theme.css (Tailwind 4)', () => {
  it('maps every color token and nothing from the default palette', async () => {
    const out = await build(['bg-primary', 'text-muted-foreground', 'border-input', 'bg-red-500']);
    expect(out).toContain('background-color: var(--primary)');
    expect(out).toContain('color: var(--muted-foreground)');
    expect(out).toContain('border-color: var(--input)');
    expect(out).not.toContain('.bg-red-500');
  });

  it('exports the 07 §4 type scale', async () => {
    const out = await build(['text-title', 'text-body', 'text-meta', 'text-kpi']);
    expect(out).toMatch(/\.text-title \{[^}]*font-size: var\(--text-title\)/);
    expect(out).toContain('--text-title: 1.875rem');
    expect(out).toContain('--text-title--line-height: 2.25rem');
    expect(out).toContain('--text-meta: 0.875rem');
    expect(out).toContain('--text-kpi: 2.25rem');
  });

  it('uses a 4 px spacing step and the 07 §5 radii', async () => {
    const out = await build(['p-4', 'gap-6', 'rounded-control', 'rounded-card']);
    expect(out).toContain('--spacing: 0.25rem');
    expect(out).toContain('padding: calc(var(--spacing) * 4)');
    expect(out).toContain('border-radius: var(--radius-control, 6px)');
    expect(out).toContain('border-radius: var(--radius-card, 8px)');
    // Declared once (tokens.css): `@theme reference` must not re-declare it in the theme layer.
    expect(out.split('--radius-control: 6px').length - 1).toBe(1);
  });

  it('has the tabular numerals utility `num`', async () => {
    const out = await build(['num']);
    expect(out).toMatch(/\.num \{[^}]*font-variant-numeric: tabular-nums;[^}]*text-align: right;/);
  });

  it('uses the device system font stack, no web font', async () => {
    const out = await build(['font-sans']);
    expect(out).toMatch(/\.font-sans \{[^}]*font-family: [^;]+;/);
    expect(out).toContain(`font-family: ${systemFontStack}`);
    expect(out).not.toContain('font-inter');
    expect(fontWeights).toEqual([400, 500, 600]);
  });

  it('dark: variant follows data-theme', async () => {
    const out = await build(['dark:bg-card']);
    expect(out).toContain('[data-theme="dark"]');
    expect(out).toContain('@media (prefers-color-scheme: dark)');
    expect(out).toContain(':root:not([data-theme="light"])');
    expect(out).toContain('background-color: var(--card)');
  });
});
