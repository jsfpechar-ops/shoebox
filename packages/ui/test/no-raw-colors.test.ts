// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scanned = ['apps/web', 'packages/ui'];
const allowed = new Set(['packages/ui/src/tokens.css']);
const skipDirs = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);
const extensions = /\.(ts|tsx|js|jsx|mjs|cjs|css|html|svg|mdx)$/;

// A hex color (a hash plus 3, 4, 6 or 8 hex digits) or a CSS color function.
const rawColor =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/;

export function findRawColors(text: string): string[] {
  const hits: string[] = [];
  text.split('\n').forEach((line, i) => {
    const m = rawColor.exec(line);
    if (m) hits.push(`${i + 1}: ${m[0]}`);
  });
  return hits;
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (extensions.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe('no raw colors outside tokens.css', () => {
  it('detects hex colors and color functions', () => {
    const hash = '#';
    const fn = 'rgb';
    expect(findRawColors(`color: ${hash}1E3A5F;`)).toEqual([`1: ${hash}1E3A5F`]);
    expect(findRawColors(`fill="${hash}fff"`)).toHaveLength(1);
    expect(findRawColors(`background: ${fn}(0 0 0);`)).toHaveLength(1);
    expect(findRawColors('color: var(--primary);')).toEqual([]);
    expect(findRawColors(`href="${hash}main"`)).toEqual([]);
  });

  it('apps/web and packages/ui contain no raw color outside tokens.css', () => {
    const offenders: string[] = [];
    for (const dir of scanned) {
      for (const file of walk(join(repoRoot, dir), [])) {
        const rel = relative(repoRoot, file).split('\\').join('/');
        if (allowed.has(rel)) continue;
        for (const hit of findRawColors(readFileSync(file, 'utf8')))
          offenders.push(`${rel}:${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
