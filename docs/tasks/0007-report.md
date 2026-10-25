# 0007 report: design tokens, Tailwind 4 theme, Inter config

Status: review. Branch `task/0007-ui-tokens`, last commit `0007 report` (sha in `git log -1`).

## 1. Files changed (`git diff --stat bfdc512 HEAD`)

Branch base is `bfdc512` (the phase/0 head at fetch time). `origin/phase/0` has since moved 9 commits ahead, so `git diff --stat origin/phase/0` shows those 9 commits as deletions. They are not part of this branch's changes.

```
 biome.json                             |  5 ++
 packages/ui/package.json               |  9 +++-
 packages/ui/src/fonts.ts               | 10 ++++
 packages/ui/src/theme.css              | 86 ++++
 packages/ui/src/tokens.css             | 58 +++
 packages/ui/test/no-raw-colors.test.ts | 60 +++
 packages/ui/test/theme.test.ts         | 72 +++
 packages/ui/test/tokens.test.ts        | 71 +++
 pnpm-lock.yaml                         |  8 ++++
 9 files changed, 378 insertions(+), 1 deletion(-)
```

## 2. Commands (last 5 lines each)

- `pnpm --filter @shoebox/ui test 2>&1 | tail -6`: `Test Files  4 passed (4)`, `Tests  13 passed (13)`.
- `pnpm --filter @shoebox/ui typecheck 2>&1 | tail -3`: no `error` lines.
- `pnpm lint 2>&1 | tail -4`: `Found 1 info.`, no errors (the existing `recommended` note).
- `pnpm exec vitest run --project ui 2>&1 | tail -5`: `Tests  13 passed (13)`.
- `pnpm depcruise 2>&1 | tail -3`: `no dependency violations found (66 modules, 53 dependencies cruised)`.

Not run: `pnpm --filter @shoebox/ui test:a11y` (does not exist until P0-UI-02).

## 3. Section 7 acceptance

- [x] tokens.css equals 07 §3 (light, dark, system); tokens.test.ts passes.
- [x] no-raw-colors.test.ts passes, scan finds 0 offenders in `apps/web` and `packages/ui`.
- [x] Type scale, 4 px spacing, `num` utility, radii exported (theme.test.ts passes).
- [x] Inter constants in fonts.ts and `--font-sans: var(--font-inter)`. `Inter()` call and the Google-host check are deferred to P0-UI-03, as the brief says.
- [x] §6 commands 1 to 5 as expected.

## 4. Deviations

- Commit labels: `0007 step 4` also contains `packages/ui/src/fonts.ts` (step 5). I wrote fonts.ts before running step 4, so `git add -A` picked it up. Step 5's commit was empty and was skipped. Content is unchanged.
- Step 9 has no commit of its own; the verification output is above.
- AGENTS.md was not modified.

## 5. Questions

- Should the branch be rebased onto the current `origin/phase/0` (9 commits ahead) before the PR? I did not rebase, since the brief says to follow it exactly. The files touched do not overlap with those commits as far as the diff shows.

## 6. Owner steps left

None for this brief.
