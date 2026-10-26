# 0309 report

Status: review
Branch: worktree-agent-a5daab134f11d2da3 (brief names claude/project-thread-uzgfn4; see Deviations)

## Files changed (git diff --stat vs 1e90c0d)

- packages/domain/src/rules/law.ts: 4 lines (attrs optional on Dphdp3Row)
- packages/domain/src/rules/cz/epo.ts: new, 328 lines (row map, KH routing, resolvers)
- packages/domain/test/epo-rows.test.ts: new, 183 lines (verbatim from brief, formatted by biome)
- packages/domain/test/kh-routing.test.ts: new, 97 lines (verbatim from brief, formatted by biome)

## Commands (last lines)

- `pnpm --filter @shoebox/domain test -- rules-law` : Test Files 12 passed (12), Tests 292 passed (292). Filter did not narrow the run; whole domain package ran.
- `pnpm --filter @shoebox/domain test -- epo-rows kh-routing` : Test Files 14 passed (14), Tests 328 passed (328).
- `pnpm --filter @shoebox/domain typecheck` : clean (tsc, no output).
- `pnpm exec biome check packages/domain` : Checked 42 files, No fixes applied, after formatting the new files (see Deviations).

## Acceptance (§7)

- [x] Both new test files green, unchanged in logic; rules-law still green.
- [x] No row number or 10000 in epo.ts outside CZ_DPHDP3_ROW_MAP (grep for 10000 / 10 000 returns 0).
- [x] Commits `0309 step 1..4` (plus `0309 step 4 lint (format only)`); no push.

## Deviations

- Base mismatch: the brief names base 496b1e9 and branch claude/project-thread-uzgfn4. This worktree is at 1e90c0d, which does not contain 496b1e9. The brief file itself exists only on bed0e1c (claude/project-thread-uzgfn4), so it was read with `git show bed0e1c:docs/tasks/0309-epo-rows-kh.md`. The step 1 anchor matched exactly, so work continued on the current branch. The orchestrator should confirm the base before merging.
- Biome: the two new test files failed `biome check` (import order, formatting). Applied `biome check --write` to them. Test content and assertions are unchanged.
- Biome `--write` also formatted epo.ts (step 4 commit).
- Dependencies: ran `pnpm install --frozen-lockfile` once.
- Test filter `-- <name>` does not narrow vitest in this package; the full domain package ran (14 files, 328 tests).

## Questions

- None blocking. Brief notes 1 to 4 (IO rows 3/4 gate, derived rows absent, row 50 [I], no A3 rule) are implemented as written.

## Owner steps left

- None. Orchestrator: push the branch and open the PR; merge is the owner's.

## [verify against XSD] (Phase 3)

Rows with confirmed: false (attrs inferred, not official): 40 (`pln23/odp_tuz23_nar`), 41 (`pln5/odp_tuz5_nar`), 42 (`dov_cu/odp_cu_nar`), 50 (`plnosv_nkf`).
