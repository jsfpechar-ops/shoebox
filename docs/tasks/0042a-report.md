# 0042a report: prototype retries

Status: blocked
Branch: claude/project-thread-bpqq3g (brief branch and base commit ignored, per owner)

## Done
- Step 1 (test first): `scripts/test/proto-retry.test.ts` created exactly as the brief gives it. Committed as `0042a step 1`.
- Anchors in `scripts/proto/pipeline.ts` all found verbatim (`runProtoDocument` signature, `client.complete(request)`, refusal line, `response.json === null` line, `ProtoRunResult`).
- Exports used by the test exist (`PROTO_RESPONSE_SCHEMA`, `LlmClient`, `LlmRequest`, `LlmResponse` via `packages/extraction/src/index.ts`; `parseLegalDate` in domain).

## Not done
- Step 2 (edit `scripts/proto/pipeline.ts`) not started.
- Step 3 (commands in §6) not run beyond the step 1 test run.

## Command results
- `pnpm exec vitest run --project unit scripts/test/proto-retry.test.ts 2>&1 | tail -30`: FAIL at suite load, 0 of 7 tests run. Error: `Cannot find package '@shoebox/domain' imported from scripts/test/proto-retry.test.ts`. Expected failure was a red assertion on `attempts`, not a load error.
- `pnpm exec biome ci scripts`: not run.
- `pnpm --filter @shoebox/extraction typecheck`: not run.
- `pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit`: not run.

## Blocker
`scripts/` has no package.json and `@shoebox/*` workspace packages are not linked: no `node_modules/@shoebox` at the repo root or in `scripts/`. `scripts/proto/pipeline.ts` imports `@shoebox/domain`, `@shoebox/extraction`, `@shoebox/validation`, `@shoebox/i18n`, `@shoebox/testkit`, so no proto script or test can load in this checkout. The existing `scripts/test/proto-auth.test.ts` does not import `@shoebox/*`, so it is not affected. Fixing this (workspace linking or an install) is outside the brief's file list and needs owner or orchestrator direction.

## Fix 1 (0042a-fix-1)
- Blocker above is resolved: the `@shoebox` alias is in `vitest.workspace.ts` (commit `d8168fb`). Import order for Biome in `c704561`.
- Step 2 (retries in `scripts/proto/pipeline.ts`): commit `f92678c` (`0042a step 2`). `proto-retry.test.ts`: 7 of 7 pass.
- `pnpm exec biome ci scripts`: clean. `pnpm --filter @shoebox/extraction typecheck`: clean. `pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit`: clean.
- `pnpm exec biome check vitest.workspace.ts`: clean after `c704561`.
- `python3 scripts/context_lint.py`: OK.
- `pnpm exec vitest run --project unit`: 697 of 698 pass. The one failure is `scripts/lint/test/tenant-sql.test.ts` (ENOENT on a `__lint-fixture-*.ts` file that another lint test writes in parallel; the path changes each run). It passes when run alone. Not in the brief; not fixed. Done-when is not met, so Status stays `blocked`.
- Owner or orchestrator: decide the fixture race in the lint tests (for example, run `scripts/lint` tests with `fileParallelism: false`, or give each fixture a unique temp path).

## Deviations
- Stopped at step 2 under brief §8 (command failure the brief does not cover); resumed under fix-1.
- Fix 1: import of `node:url` moved above the `vitest/config` import so Biome passes (the brief's placement fails `biome check`).
- No PR opened; no push (per owner).

## Owner steps left
- Decide how `scripts/` should resolve `@shoebox/*` (for example, a scripts package.json in pnpm-workspace, or a root install that links workspaces), then re-run this brief from step 2.
