# 0009 report: signed webhooks

Status: review | Branch: task/0009-signed-webhooks | Executor: Haiku 5.5

## 1. Files changed (`git diff --stat origin/phase/0`)

- `packages/platform/src/webhooks/webhook.ts` (new, verbatim from §4 step 1)
- `packages/platform/src/webhooks/index.ts` (new)
- `packages/platform/src/index.ts` (edit: one `export * from './webhooks/index';` line)
- `packages/platform/test/webhooks.test.ts` (new, §4 step 4, then Biome format/sort fix in step 5)
- `docs/tasks/0009-signed-webhooks.md` (Status line only), `docs/tasks/0009-report.md` (this file)

## 2. Commands (last lines of output)

- `pnpm --filter @shoebox/platform exec vitest run test/webhooks.test.ts` (file alone): `Test Files 1 passed (1)`, `Tests 18 passed (18)`.
- `pnpm --filter @shoebox/platform test -- webhooks` (brief literal): runs all 3 platform files because `--` passes the filter through to vitest, so it reports `Test Files 3 passed (3)`, `Tests 29 passed (29)`. Passed.
- `pnpm --filter @shoebox/platform test -- smoke`: same 3 files, `29 passed`. Passed.
- `pnpm --filter @shoebox/platform typecheck`: exit 0, no errors.
- `pnpm lint`: `Checked 101 files ... No fixes applied.`, `Found 1 info.`, exit 0. The info is outside §3 and was not touched.

## 3. §7 acceptance

- [x] Webhook tests pass (18 tests in `webhooks.test.ts`, including the 500-case seeded property test).
- [x] `signWebhook` and `verifyWebhook` are exported from `src/index.ts`, and typecheck passes.
- [x] Typecheck and lint exit 0. `git diff --stat origin/phase/0` lists only §3 paths plus the brief's Status line and this report.
- [x] Not in this brief: the 1 MB route check and the replay guard stay with later tickets.

## 4. Deviations

- Path relocation as the brief says: `src/webhooks/` and `test/webhooks.test.ts`.
- Step 3: brief 0008's `export * from './logger/index';` was already on the line below `packageName`. Biome `organizeImports` requires sorted exports, so my line sits after the logger line instead of directly below `packageName`. No other line moved.
- Step 5: Biome safe fixes were applied to the §3 files only. In `webhooks.test.ts` this means import order and line wrapping (no assertion changed). The test file is therefore not byte-identical to step 4, as the reviewer check expects. Reviewer should diff against the step-4 commit `51addc8` and ignore whitespace and ordering.
- The brief's `test -- webhooks` command runs all platform test files (see §2).
- Base: `origin/phase/0` moved one commit (`f2310fb`) after this branch was cut from `b790c10`. Branch is 5 ahead, 1 behind. Not rebased; the orchestrator should rebase or merge before the PR.

## 5. Questions

- Should the brief's test command be changed to `pnpm --filter @shoebox/platform exec vitest run test/webhooks.test.ts`, since the `--` form runs every file?

## 6. Owner steps left

- None for this brief. Open the PR from `task/0009-signed-webhooks` into `phase/0`, as the orchestrator does.
