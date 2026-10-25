# 0007: design tokens, Tailwind 4 theme and Inter config

Status: done
Ticket: P0-UI-01 | Depends on: none (P0-REPO-01 merged) | Base commit: head of phase/0 | Branch: task/0007-ui-tokens | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Create `packages/ui/src/tokens.css` (the only file in the UI allowed to hold raw colors), map it into a Tailwind 4 theme (`theme.css`) with the 07 type scale, 4 px spacing, radii and a tabular-numerals utility, and record the Inter font settings (`fonts.ts`). Tests pin the tokens to the 07 table and fail on any raw color elsewhere in `apps/web` and `packages/ui`, so every later screen looks consistent and passes contrast in light and dark.

## 2. Context

**Test filter:** run one file as `pnpm --filter @shoebox/ui test <name>` (no `--`: with `--` pnpm forwards it and vitest runs every file).

**How to work (strict):** every file below is given in full and was verified by the brief writer in a scratch copy (13 tests pass, `pnpm lint` and typecheck clean, `pnpm depcruise` clean). Write each file with ONE Write call, exactly as given (including the lower-case hex: Biome's CSS formatter lower-cases hex, the test compares case-insensitively). Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call.

**Spec 07 §3 Color tokens (pasted):** one action color (navy `--primary`); green/amber/red mean status only. Token table (light / dark): `--background` F8FAFC / 0B1220, `--foreground` 0F172A / E2E8F0, `--card` FFFFFF / 111A2E, `--muted` F1F5F9 / 172036, `--muted-foreground` 475569 / 94A3B8, `--border` E2E8F0 / 1F2A40, `--input` 64748B / 64748B, `--primary` 1E3A5F / 93C5FD, `--primary-foreground` FFFFFF / 0B1220, `--link` 1D4ED8 / 93C5FD, `--ring` 1E3A5F / 93C5FD, `--success` 047857 / 34D399, `--warning` 92400E / FBBF24, `--destructive` B91C1C / F87171, `--info` 475569 / 94A3B8. Plus `--radius-control:8px; --radius-card:12px`. Selectors: `:root` (light), `:root[data-theme="dark"]`, and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { same as dark } }`. Theme follows the system by default; a switch (Světlý / Tmavý / Podle systému) sets `data-theme` (switch itself is P0-UI-03).

**Spec 07 §4 Typography (pasted):** Inter for everything, loaded with `next/font` and the `latin` + `latin-ext` subsets (Czech diacritics), self-hosted, no requests to Google at runtime. Numbers: `font-variant-numeric: tabular-nums` on every amount, date and table column, right-aligned. Scale (rem, base 16 px): page title 30/36 600; section 20/28 600; card title 18/26 500; body 16/24 400; meta 14/20 500; KPI 36/40 600 tabular. Nothing below 14 px. Weights only 400, 500, 600.

**Spec 07 §5 (pasted):** 4 px grid (4, 8, 12, 16, 24, 32, 48, 64). Breakpoints 375 / 768 / 1024 / 1440; content max-width 1200 px. Radius 8 px controls, 12 px cards.

**Decisions:** Tailwind 4 approved; Inter via `next/font` approved (docs/context/decisions.md). `apps/web` is not a Next.js app yet, so `next/font` cannot be called here. Also `next/font` only accepts literal options, so a shared options object cannot be passed to `Inter()`. This brief therefore only exports the Inter constants (`fonts.ts`) and points `--font-sans` at `var(--font-inter)`; the `Inter({...})` call in `apps/web` and the "no request to Google font hosts" check are **deferred to P0-UI-03**.

**Verified technical facts (from the scratch run):**
- Biome 2.5 refuses Tailwind at-rules (`@theme`, `@utility`, `@custom-variant`) with "Tailwind-specific syntax is disabled" unless `css.parser.tailwindDirectives` is `true` in `biome.json` (step 2). Biome does not parse two `@theme` modifiers (`inline reference`), so colors use `@theme inline` and radii `@theme reference`.
- Under the package's happy-dom environment, `new URL(..., import.meta.url)` is not a `file:` URL. The three new tests start with `// @vitest-environment node`.
- `tailwindcss` exports `compile(css, { base, loadStylesheet })`; the test feeds it `node_modules/tailwindcss/index.css`. Version 4.3.3 (released 2026-07-16, older than 14 days), exact pin, devDependency of `@shoebox/ui` only.
- The default Tailwind palette is removed (`--color-*: initial`), so `bg-red-500` does not exist; only token colors do.

Hard rules: 6 (UI uses the design tokens only, no raw colors), 7 (no new dependency beyond the approved Tailwind 4).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/ui/package.json` | edit | `tailwindcss` 4.3.3 devDependency; exports `./fonts`, `./tokens.css`, `./theme.css` |
| `pnpm-lock.yaml` | generated | by `pnpm install` |
| `biome.json` | edit | `css.parser.tailwindDirectives: true` |
| `packages/ui/src/tokens.css` | new | 07 §3 tokens, light, dark, system |
| `packages/ui/src/fonts.ts` | new | Inter constants |
| `packages/ui/src/theme.css` | new | Tailwind 4 theme |
| `packages/ui/test/tokens.test.ts` | new | tokens.css vs the 07 table |
| `packages/ui/test/theme.test.ts` | new | compiles theme.css with Tailwind |
| `packages/ui/test/no-raw-colors.test.ts` | new | no raw colors outside tokens.css |

No other file may change.

## 4. Steps

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0007-ui-tokens origin/phase/0 2>&1 | tail -3`. Expected: `Switched to a new branch 'task/0007-ui-tokens'`.

**Step 1: `packages/ui/package.json` (edit).** Anchor (verbatim):

```json
      "default": "./src/index.ts"
    }
  },
```

Replace with:

```json
      "default": "./src/index.ts"
    },
    "./fonts": {
      "types": "./src/fonts.ts",
      "default": "./src/fonts.ts"
    },
    "./tokens.css": "./src/tokens.css",
    "./theme.css": "./src/theme.css"
  },
```

Second anchor `    "happy-dom": "catalog:",` → add one line after it: `    "tailwindcss": "4.3.3",`.
Command: `pnpm install 2>&1 | tail -5 && git add -A && git commit -qm "0007 step 1" && git diff HEAD~1 --stat | tail -3`. Expected: `Done in`, then 2 files changed (`package.json`, `pnpm-lock.yaml`).

**Step 2: `biome.json` (edit).** Anchor (verbatim, appears once):

```json
  "javascript": {
```

Replace with:

```json
  "css": {
    "parser": {
      "tailwindDirectives": true
    }
  },
  "javascript": {
```

Command: `pnpm lint 2>&1 | tail -4 && git commit -qam "0007 step 2"`. Expected: `Found 1 info.` (the existing `recommended` deprecation note) and no errors.

**Step 3: `packages/ui/src/tokens.css` (new), exactly:**

```css
/* packages/ui/src/tokens.css: the only place raw colors may appear (07 §3). */
:root {
  --background: #f8fafc;
  --foreground: #0f172a;
  --card: #ffffff;
  --muted: #f1f5f9;
  --muted-foreground: #475569;
  --border: #e2e8f0;
  --input: #64748b;
  --primary: #1e3a5f;
  --primary-foreground: #ffffff;
  --link: #1d4ed8;
  --ring: #1e3a5f;
  --success: #047857;
  --warning: #92400e;
  --destructive: #b91c1c;
  --info: #475569;
  --radius-control: 8px;
  --radius-card: 12px;
}

:root[data-theme="dark"] {
  --background: #0b1220;
  --foreground: #e2e8f0;
  --card: #111a2e;
  --muted: #172036;
  --muted-foreground: #94a3b8;
  --border: #1f2a40;
  --input: #64748b;
  --primary: #93c5fd;
  --primary-foreground: #0b1220;
  --link: #93c5fd;
  --ring: #93c5fd;
  --success: #34d399;
  --warning: #fbbf24;
  --destructive: #f87171;
  --info: #94a3b8;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --background: #0b1220;
    --foreground: #e2e8f0;
    --card: #111a2e;
    --muted: #172036;
    --muted-foreground: #94a3b8;
    --border: #1f2a40;
    --input: #64748b;
    --primary: #93c5fd;
    --primary-foreground: #0b1220;
    --link: #93c5fd;
    --ring: #93c5fd;
    --success: #34d399;
    --warning: #fbbf24;
    --destructive: #f87171;
    --info: #94a3b8;
  }
}
```

Command: `git add -A && git commit -qm "0007 step 3" && echo ok`. Expected: `ok`.

**Step 4: `packages/ui/test/tokens.test.ts` (new).** Full test file; do not edit it:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 07 §3 color table: token, light, dark. Values without '#' so this file holds no raw color.
// Biome's CSS formatter writes hex in lower case, so tokens.css is compared in lower case.
const table: ReadonlyArray<readonly [string, string, string]> = [
  ['--background', 'F8FAFC', '0B1220'],
  ['--foreground', '0F172A', 'E2E8F0'],
  ['--card', 'FFFFFF', '111A2E'],
  ['--muted', 'F1F5F9', '172036'],
  ['--muted-foreground', '475569', '94A3B8'],
  ['--border', 'E2E8F0', '1F2A40'],
  ['--input', '64748B', '64748B'],
  ['--primary', '1E3A5F', '93C5FD'],
  ['--primary-foreground', 'FFFFFF', '0B1220'],
  ['--link', '1D4ED8', '93C5FD'],
  ['--ring', '1E3A5F', '93C5FD'],
  ['--success', '047857', '34D399'],
  ['--warning', '92400E', 'FBBF24'],
  ['--destructive', 'B91C1C', 'F87171'],
  ['--info', '475569', '94A3B8'],
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
    expect(light.get('--radius-control')).toBe('8px');
    expect(light.get('--radius-card')).toBe('12px');
    expect(dark.size).toBe(table.length);
  });
});
```

Command: `pnpm --filter @shoebox/ui test tokens 2>&1 | tail -6 && git add -A && git commit -qm "0007 step 4"`. Expected: `Tests  4 passed (4)`.

**Step 5: `packages/ui/src/fonts.ts` (new), exactly:**

```ts
/**
 * Inter, self-hosted through next/font (07 §4). next/font only accepts literal options, so
 * apps/web (P0-UI-03) writes `Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter',
 * display: 'swap' })` itself and tests it against these constants. latin-ext carries Czech diacritics.
 */
export const interSubsets = ['latin', 'latin-ext'] as const;

export const interCssVariable = '--font-inter' as const;

export const fontWeights = [400, 500, 600] as const;
```

Command: `pnpm --filter @shoebox/ui typecheck 2>&1 | tail -3 && git add -A && git commit -qm "0007 step 5"`. Expected: no `error` lines.

**Step 6: `packages/ui/src/theme.css` (new), exactly:**

```css
/* packages/ui/src/theme.css: maps tokens.css into the Tailwind 4 theme (07 §3–§5). No raw colors here. */
@import "tailwindcss";
@import "./tokens.css";

/* dark: matches the manual switch, or the system setting unless the user chose light (07 §3). */
@custom-variant dark {
  &:where([data-theme="dark"], [data-theme="dark"] *) {
    @slot;
  }
  @media (prefers-color-scheme: dark) {
    &:where(:root:not([data-theme="light"]) *) {
      @slot;
    }
  }
}

@theme inline {
  --color-*: initial;
  --color-transparent: transparent;
  --color-current: currentColor;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-link: var(--link);
  --color-ring: var(--ring);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-destructive: var(--destructive);
  --color-info: var(--info);

  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
}

/* reference: rounded-control/-card read var(--radius-*) from tokens.css (these values are only the fallback). */
@theme reference {
  --radius-*: initial;
  --radius-control: 8px;
  --radius-card: 12px;
}

@theme {
  --spacing: 0.25rem;

  --text-*: initial;
  --text-title: 1.875rem;
  --text-title--line-height: 2.25rem;
  --text-title--font-weight: 600;
  --text-section: 1.25rem;
  --text-section--line-height: 1.75rem;
  --text-section--font-weight: 600;
  --text-card-title: 1.125rem;
  --text-card-title--line-height: 1.625rem;
  --text-card-title--font-weight: 500;
  --text-body: 1rem;
  --text-body--line-height: 1.5rem;
  --text-body--font-weight: 400;
  --text-meta: 0.875rem;
  --text-meta--line-height: 1.25rem;
  --text-meta--font-weight: 500;
  --text-kpi: 2.25rem;
  --text-kpi--line-height: 2.5rem;
  --text-kpi--font-weight: 600;

  --font-weight-*: initial;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  --breakpoint-*: initial;
  --breakpoint-md: 48rem;
  --breakpoint-lg: 64rem;
  --breakpoint-xl: 90rem;

  --container-content: 75rem;
}

@utility num {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
```

Command: `pnpm lint 2>&1 | tail -4 && git add -A && git commit -qm "0007 step 6"`. Expected: `Found 1 info.`, no errors.

**Step 7: `packages/ui/test/theme.test.ts` (new).** Full test file; do not edit it:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { fontWeights, interCssVariable, interSubsets } from '../src/fonts';

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
    expect(out).toContain('border-radius: var(--radius-control, 8px)');
    expect(out).toContain('border-radius: var(--radius-card, 12px)');
    // Declared once (tokens.css): `@theme reference` must not re-declare it in the theme layer.
    expect(out.split('--radius-control: 8px').length - 1).toBe(1);
  });

  it('has the tabular numerals utility `num`', async () => {
    const out = await build(['num']);
    expect(out).toMatch(/\.num \{[^}]*font-variant-numeric: tabular-nums;[^}]*text-align: right;/);
  });

  it('sets Inter as the sans font via the next/font variable', async () => {
    const out = await build(['font-sans']);
    expect(out).toContain(`var(${interCssVariable})`);
    expect(interSubsets).toEqual(['latin', 'latin-ext']);
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
```

Command: `pnpm --filter @shoebox/ui test theme 2>&1 | tail -6 && git add -A && git commit -qm "0007 step 7"`. Expected: `Tests  6 passed (6)`.

**Step 8: `packages/ui/test/no-raw-colors.test.ts` (new).** Full test file; do not edit it. It holds no literal hex itself (fixtures are built with `${hash}`), so it does not flag itself:

```ts
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
```

Command: `pnpm --filter @shoebox/ui test no-raw-colors 2>&1 | tail -6 && git add -A && git commit -qm "0007 step 8"`. Expected: `Tests  2 passed (2)`.

**Step 9: final checks (no file).** Run the §6 commands, write the report (§9), push.

## 5. Do not touch

- Everything outside §3: `packages/ui/src/index.ts`, `packages/ui/vitest.config.ts`, `apps/web/**`, `packages/i18n/**`, the root `package.json` and `pnpm-workspace.yaml` catalog.
- Do not install `@tailwindcss/postcss`, `next` or any font package (P0-UI-03).
- Hard rules 6 and 7 (§2). No raw color in any file except `tokens.css`.

## 6. Commands

From the repo root:

1. `pnpm --filter @shoebox/ui test 2>&1 | tail -6`: `Test Files  4 passed (4)`, `Tests  13 passed (13)` (includes the existing smoke test).
2. `pnpm --filter @shoebox/ui typecheck 2>&1 | tail -3`: no `error` lines.
3. `pnpm lint 2>&1 | tail -4`: `Found 1 info.`, no errors.
4. `pnpm exec vitest run --project ui 2>&1 | tail -5`: `Tests  13 passed (13)` (the CI `test:unit` project).
5. `pnpm depcruise 2>&1 | tail -3`: `no dependency violations found`.

`pnpm --filter @shoebox/ui test:a11y` (test-map row) does not exist yet; it arrives with P0-UI-02. Skip it and say so in the report.

## 7. Acceptance

- [ ] `packages/ui/src/tokens.css` equals 07 §3 for light and dark, including the `prefers-color-scheme` block; `packages/ui/test/tokens.test.ts` parses it against the 07 table (step 4 passes).
- [ ] `packages/ui/test/no-raw-colors.test.ts` fails on any hex outside `tokens.css` in `apps/web` and `packages/ui` (its detector test passes; the scan finds 0 offenders).
- [ ] Type scale and 4 px spacing exported as theme values; tabular numerals utility (`num`) (theme.test.ts passes).
- [ ] Self-hosted Inter (latin + latin-ext): only the constants in `fonts.ts` and `--font-sans: var(--font-inter)`. **Deferred to P0-UI-03:** the `next/font` `Inter()` call in `apps/web` and the "no request to Google font hosts" check (apps/web is not Next.js yet).
- [ ] §6 commands 1–5 as expected.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0007-report.md` (600 tokens at most) and set `Status: review` in this brief. Commit both as `0007 report`, then `git push -u origin task/0007-ui-tokens 2>&1 | tail -3`. The orchestrator opens and merges the PR. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -12`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations (none expected).
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

- `biome.json`: the `css.parser.tailwindDirectives` switch applies repo-wide (intended; only Tailwind CSS files are affected).
- `packages/ui/src/tokens.css`: every value against the 07 §3 table (the test does this; spot-check one row).
- `packages/ui/test/no-raw-colors.test.ts`: the guard every later UI brief relies on; check the scanned paths and the allow-list (only `tokens.css`).
- `pnpm-lock.yaml`: only `tailwindcss@4.3.3` added.

## Owner steps

None for this brief. (Inter is downloaded at build time by `next/font` once P0-UI-03 adds Next.js; nothing to set up now.)
