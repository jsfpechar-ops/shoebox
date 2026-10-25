# 0006 report (P0-I18N-01): status review

Continuation brief 0006-cont-1 (steps 5 check, 6 to 8) run in this session on `task/0006-i18n`. Steps 1 to 5 were already committed at f6ae9b2.

## 1. Files changed

Against the cont-1 base (`git diff --stat f6ae9b2 HEAD`):

```
 docs/tasks/0006-i18n-catalog.md   |  2 +-   (Status: review)
 docs/tasks/0006-report.md         (overwritten)
 package.json                      |  4 +--
 packages/i18n/test/catalog.test.ts | 61 +++++++
```

The literal `git diff --stat origin/phase/0` shows many unrelated files, because `phase/0` has moved on since the brief was written. See Deviations.

## 2. Commands

- Setup `pnpm install --frozen-lockfile` → `Done in 1.4s using pnpm v10.28.0`; no lockfile change.
- Step 5 `pnpm --filter @shoebox/i18n test -- test/icu.test.ts` → `Tests  18 passed (18)` (17 icu cases plus the smoke test; the filter was not applied).
- Step 6 `pnpm --filter @shoebox/i18n test` → `Test Files  3 passed (3)`, `Tests  24 passed (24)`. Commit `0006 step 6` (bd476fc).
- Step 7 `pnpm check:i18n` → `Tests  24 passed (24)`, exit 0. Commit `0006 step 7` (97b8830).
- Step 8 `pnpm lint` → exit 0. Last lines: `Checked 106 files in 1340ms. No fixes applied.` / `Found 1 info.` (Biome asks for `biome migrate`; info only, no change made). The i18n tests run after Biome and pass (24).

## 3. §7 ticked

- [x] `cs.json`, `en.json` exist; `t` works server and client (tests pass).
- [x] `pnpm --filter @shoebox/i18n test`: 24 passed; en has every cs key; invalid ICU fails; Czech plurals 1 doklad / 2 doklady / 5 dokladů.
- [x] `check:i18n` wired into `lint`; `pnpm lint` exits 0.

## 4. Deviations

Done: steps 5 (check), 6, 7, 8, the report, Status set to `review`. Left: none.

- The §9 command `git diff --stat origin/phase/0` includes unrelated files because `origin/phase/0` moved; the stat above uses the cont-1 base f6ae9b2.
- The step 5 command ran all test files, because pnpm passed the filter through. The count is 18, not 17.
- The earlier `0006 report` (blocked, from the first session) is overwritten by this report.
- The cont-1 brief lives on `phase/0`, so its Status line was not changed here.

## 5. Questions

None.

## 6. Owner steps left

None to run this brief. Open the PR from `task/0006-i18n` into `phase/0` (the orchestrator does this per §9).
