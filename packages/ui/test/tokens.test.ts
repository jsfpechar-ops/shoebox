// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 07 §3 color table: token, light, dark. Values without '#' so this file holds no raw color.
// Biome's CSS formatter writes hex in lower case, so tokens.css is compared in lower case.
const table: ReadonlyArray<readonly [string, string, string]> = [
  ['--background', 'FFFFFF', '0B1220'],
  ['--foreground', '37352F', 'E2E8F0'],
  ['--card', 'FFFFFF', '111A2E'],
  ['--muted', 'F7F7F5', '172036'],
  ['--muted-foreground', '5F5E5B', '94A3B8'],
  ['--border', 'E9E9E7', '1F2A40'],
  ['--input', '8F8E8A', '64748B'],
  ['--primary', '0B6BCB', '93C5FD'],
  ['--primary-foreground', 'FFFFFF', '0B1220'],
  ['--link', '0B6BCB', '93C5FD'],
  ['--ring', '0B0C0C', 'FFDD00'],
  ['--focus', 'FFDD00', 'FFDD00'],
  ['--success', '047857', '34D399'],
  ['--warning', '92400E', 'FBBF24'],
  ['--destructive', 'B91C1C', 'F87171'],
  ['--info', '5F5E5B', '94A3B8'],
];

const css = readFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), 'utf8');

/** Returns the declarations of the first block whose selector line ends with `selector {`. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const decls = new Map<string, string>();
  for (const m of css.slice(open + 1, close).matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) {
    decls.set(m[1] ?? '', (m[2] ?? '').trim());
  }
  return decls;
}

describe('tokens.css equals 07 §3', () => {
  const light = block(':root');
  const dark = block(':root[data-theme="dark"]');
  const system = block(':root:not([data-theme="light"])');

  it('light values match the table', () => {
    for (const [token, value] of table)
      expect(light.get(token), token).toBe(`#${value.toLowerCase()}`);
  });

  it('dark values match the table', () => {
    for (const [token, , value] of table)
      expect(dark.get(token), token).toBe(`#${value.toLowerCase()}`);
  });

  it('the prefers-color-scheme block repeats the dark values', () => {
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/,
    );
    expect(system).toEqual(dark);
  });

  it('defines only the table tokens plus the two radii', () => {
    expect([...light.keys()].sort()).toEqual(
      [...table.map(([t]) => t), '--radius-control', '--radius-card'].sort(),
    );
    expect(light.get('--radius-control')).toBe('6px');
    expect(light.get('--radius-card')).toBe('8px');
    expect(dark.size).toBe(table.length);
  });
});
