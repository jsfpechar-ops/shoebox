# 0005 report: canonical enums, legal dates and the clock

Status: review | Branch: task/0005-enums-dates-clock | Base: origin/phase/0 (7874307)

## 1. Files changed

Created: `packages/domain/src/clock/index.ts`, `packages/domain/src/dates/index.ts`, `packages/domain/src/enums/index.ts`, `packages/domain/test/enums.test.ts`, `packages/domain/test/dates.test.ts`.
Edited: `packages/domain/src/index.ts` (three `export *` lines after the `packageName` anchor).
Nothing else touched. No `package.json`, lockfile, config or `docs/v3/**` change.

## 2. §6 commands (last lines)

1. `pnpm --filter @shoebox/domain test`: `Test Files 3 passed (3)`, `Tests 59 passed (59)`.
2. `pnpm --filter @shoebox/domain typecheck`: `tsc -p tsconfig.json` with no `error TS` lines.
3. `pnpm lint`: `Checked 106 files in 1405ms. No fixes applied.` / `Found 1 info.` The info is the pre-existing deprecated `recommended` field in `biome.json` (not touched). No errors. The exit code was not captured because the output went through `tail`.
4. Coverage, run as `pnpm --filter @shoebox/domain exec vitest run --coverage`: `Lines : 100% (78/78)`, `Statements : 100%`, `Functions : 100%`, `Branches : 87.03%`.

## 3. §7 acceptance

- [x] `enums/index.ts` has all 25 enums; `enums.test.ts` passes (29 tests).
- [x] `dates.test.ts` passes: Prague today at 2026-10-18T22:30Z is 2026-10-19; DST days 2026-03-29 and 2026-10-25; LegalDate parse, compare, addDays.
- [x] `Clock` injected; `grep` finds no `Date.now()` or `new Date()` in `packages/domain/src`.
- [x] Domain line coverage 100%.

## 4. Deviations

- `node_modules` was missing, so I ran `pnpm install --frozen-lockfile` (no lockfile change). My first two typecheck runs ran before this, so they proved nothing. Both were re-run after the install and are clean.
- Steps 3 and 4 went into one commit (`0005 step 3-4`). Step 7 had no file change.
- The §6 coverage command was refused by the worktree guard because of the glob in `--coverage.include`. I ran the equivalent package-scoped command above.
- Commits carry the Opus co-author trailer, as the owner's instruction asked.
- No PR opened (owner instruction; executor.md says to open one).

## 5. Questions

None.

## 6. Owner steps left

Open and merge the PR `task/0005-enums-dates-clock` into `phase/0` (orchestrator, per §9 of the brief).
