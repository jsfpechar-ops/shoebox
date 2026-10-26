# 0320 report: doc.categorize worker job

Status: review

## Files changed (git diff --stat, vs. lane head)

- apps/worker/src/categorize/handler.ts (new, 145 lines)
- apps/worker/src/categorize/register.ts (new, 30 lines)
- apps/worker/src/main.ts (+2: import and registerDocCategorize call)
- apps/worker/test/categorize-job.test.ts (new, verbatim from brief §4 step 4)

Commits: `0320 step 1` to `0320 step 4` on wt-0320, plus this report commit.

## Commands (last lines)

- `pnpm --filter @shoebox/worker exec vitest run categorize-job`: `Tests 6 passed (6)`, 1 file passed.
- `pnpm --filter @shoebox/worker exec vitest run registry`: `Tests 21 passed | 4 skipped (25)`, `Test Files 2 passed | 1 skipped`. Not compared with a pre-change baseline; the skipped file is the DB-backed registry test.
- `pnpm --filter @shoebox/worker typecheck`: no errors (tsc exit 0).
- `pnpm exec biome check` on handler.ts, register.ts, main.ts: clean after `--write` (handler.ts and main.ts were auto-formatted and their imports sorted).
- `pnpm exec biome check` on apps/worker/test/categorize-job.test.ts: 1 lint error (`noNonNullAssertion` at line 82, `document().lines[0]!`) and a format diff. The test file is verbatim from the brief and was not edited.

## Acceptance (§7)

- [x] Tests pass (6/6); typecheck clean.
- [x] main.ts registers the job after doc.extract (placed directly after `registerDocExtract`, see deviation 2).
- [x] No log line carries a description, subject or payload (the test's `not.toContain('backpack')` passes).

## Deviations

1. Failed LLM runs keep their attempt records. Brief §4 step 1 says `runs = []` when `runCategorize` returns ok:false. That contradicts §2 ("the two failed attempts are recorded") and the test (`runs` expects `[1,false,'parse']`, `[2,false,'parse']`). I followed §2 and the test.
2. main.ts: the new import sits before `./doc-extract/register` (not below it) because Biome's organizeImports requires sorted imports. The call sits below `registerDocExtract` as the brief says.
3. The brief's guard "deletedAt set" is not coded. `DocumentForCategorize` has no `deletedAt`; `loadDocumentForCategorize` already filters `isNull(documents.deletedAt)`.
4. Enqueue is a `type Enqueue` alias, not an interface with a call signature (Biome useShorthandFunctionType).

## Questions

- The test file fails Biome (`!` on line 82, plus format). The brief forbids editing the test, so I left it. Choose: (a) owner/orchestrator allows changing `document().lines[0]!` to a guard in the test, or (b) CI lint on test files is accepted as failing. I did not push.

## Owner steps left

None.
