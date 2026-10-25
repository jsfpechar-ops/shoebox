# 0043a: UI tokens and font to the 2026-10-25 design (Notion-like, system font)

Status: review
Ticket: owner design decision 2026-10-25 (decisions [design]) | Depends on: PR #90 merged | Base commit: head of phase/0 | Branch: claude/project-thread-bpqq3g (commit locally, no push) | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Change the light color tokens, radii and font in code to match the updated 07 §3–§5: a Notion-like light palette, a GOV.UK yellow focus token, and the device's own font instead of Inter. Users get the agreed look, and no font is downloaded.

## 2. Context

- Hard rule 6: raw colors only in `packages/ui/src/tokens.css`. Tests hold hex without `#`.
- Biome writes hex in lower case in CSS.
- New 07 §3 values (light / dark). Only these rows change; all other rows stay as they are now:

| Token | Light | Dark |
|---|---|---|
| `--background` | FFFFFF | 0B1220 (unchanged) |
| `--foreground` | 37352F | E2E8F0 (unchanged) |
| `--muted` | F7F7F5 | 172036 (unchanged) |
| `--muted-foreground` | 5F5E5B | 94A3B8 (unchanged) |
| `--border` | E9E9E7 | 1F2A40 (unchanged) |
| `--input` | 8F8E8A | 64748B (unchanged) |
| `--primary` | 0B6BCB | 93C5FD (unchanged) |
| `--link` | 0B6BCB | 93C5FD (unchanged) |
| `--ring` | 0B0C0C | FFDD00 |
| `--focus` (new) | FFDD00 | FFDD00 |
| `--info` | 5F5E5B | 94A3B8 (unchanged) |

- Radii: `--radius-control: 6px`, `--radius-card: 8px` (were 8 and 12).
- Font (07 §4): `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`. Inter and `next/font` are removed.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/ui/src/tokens.css` | edit | values above, `--focus` in all three blocks |
| `packages/ui/src/theme.css` | edit | `--font-sans` line; radius fallbacks; `--color-focus` |
| `packages/ui/src/fonts.ts` | replace | system stack constant |
| `packages/ui/test/tokens.test.ts` | replace table and radii lines | per step 4 |
| `packages/ui/test/theme.test.ts` | edit | two tests, per step 5 |
| `apps/web/app/layout.tsx` | edit | drop Inter |
| `apps/web/test/fonts.test.ts` | replace | per step 7 |
| `docs/tasks/0043a-report.md` | new | report |

No other file may change.

## 4. Steps

1. `packages/ui/src/tokens.css`: in `:root` set the light values from §2 and add `--focus: #ffdd00;` after `--ring`; set `--radius-control: 6px;` and `--radius-card: 8px;`. In `:root[data-theme="dark"]` AND in the `@media (prefers-color-scheme: dark)` block set `--ring: #ffdd00;` and add `--focus: #ffdd00;` after it. Nothing else.
2. `packages/ui/src/theme.css`: after `  --color-ring: var(--ring);` add `  --color-focus: var(--focus);`. Replace the line `  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;` with `  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;`. In `@theme reference` set `--radius-control: 6px;` and `--radius-card: 8px;`.
3. Replace all of `packages/ui/src/fonts.ts` with:

```ts
/**
 * The device's own font, as Notion uses (07 §4, owner 2026-10-25): San Francisco on Apple,
 * Segoe UI on Windows, Roboto/Arial elsewhere. Nothing is downloaded. theme.css repeats this
 * stack in `--font-sans`; test/theme.test.ts checks they match.
 */
export const systemFontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' as const;

export const fontWeights = [400, 500, 600] as const;
```

4. `packages/ui/test/tokens.test.ts`: replace the whole `const table … = [ … ];` with:

```ts
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
```

   and in the last test change `toBe('8px')` to `toBe('6px')` and `toBe('12px')` to `toBe('8px')`. Change nothing else.
5. `packages/ui/test/theme.test.ts`:
   - Import line: replace `import { fontWeights, interCssVariable, interSubsets } from '../src/fonts';` with `import { fontWeights, systemFontStack } from '../src/fonts';`.
   - In the radii test: `'border-radius: var(--radius-control, 8px)'` → `'border-radius: var(--radius-control, 6px)'`; `'border-radius: var(--radius-card, 12px)'` → `'border-radius: var(--radius-card, 8px)'`; `'--radius-control: 8px'` → `'--radius-control: 6px'`.
   - Replace the whole test `it('sets Inter as the sans font via the next/font variable', …);` with:

```ts
  it('uses the device system font stack, no web font', async () => {
    const out = await build(['font-sans']);
    expect(out).toContain(`--font-sans: ${systemFontStack}`);
    expect(out).not.toContain('font-inter');
    expect(fontWeights).toEqual([400, 500, 600]);
  });
```

6. `apps/web/app/layout.tsx`: delete the line `import { Inter } from 'next/font/google';`, the two comment lines starting `// 07 §4: Inter` and `// next/font needs literal options`, and the line `const inter = Inter(…);` (plus the blank line after it). Change `<html lang="cs" className={inter.variable} data-theme={theme}>` to `<html lang="cs" data-theme={theme}>`.
7. Replace all of `apps/web/test/fonts.test.ts` with:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(fileURLToPath(new URL('../app/layout.tsx', import.meta.url)), 'utf8');

describe('system font, no web font (07 §4)', () => {
  it('loads no font through next/font', () => {
    expect(layout).not.toContain('next/font');
    expect(layout).not.toContain('Inter');
  });

  it('sets lang="cs" on <html>', () => {
    expect(layout).toContain('<html lang="cs" data-theme={theme}>');
  });
});
```

8. Run §6. Fix only the files in §3 (never a test assertion) until all pass. Commit each step with the session trailers; write the report; set Status `review`.

## 5. Do not touch

`packages/ui/src/components/**`, `primitives/**`, every other test. Hard rules 6 and 7 (no new dependency).

## 6. Commands

```
pnpm --filter @shoebox/ui test 2>&1 | tail -30
pnpm --filter @shoebox/ui typecheck 2>&1 | tail -30
pnpm --filter @shoebox/web test fonts 2>&1 | tail -30
pnpm --filter @shoebox/web typecheck 2>&1 | tail -30
pnpm exec biome check packages/ui apps/web 2>&1 | tail -30
python3 scripts/context_lint.py 2>&1 | tail -30
```

## 7. Acceptance

- [ ] All §6 commands pass.
- [ ] `grep -rn "next/font\|font-inter\|interSubsets" apps packages --include=*.ts --include=*.tsx --include=*.css | grep -v node_modules` prints nothing.

## 8. Stop and ask

As TEMPLATE §8. Also stop if a component test (a11y, primitives) fails because of a new color: report the failing assertion, do not change it.

## 9. Report

`docs/tasks/0043a-report.md`, as TEMPLATE §9.
