# 0041b report (prototype checks v3)

Status: blocked (brief §8: a test the brief wrote fails to typecheck and is not Biome-clean; not edited, per executor.md)

## Files changed (vs base 7718531)

- `packages/validation/test/proto-checks-v3.test.ts` (new, brief §4 step 1, unchanged)
- `packages/validation/src/proto-checks/checks.ts` (ids, input, options, 4 checks, `parseProtoOrg`, Biome format of one signature)
- `packages/i18n/messages/cs.json`, `packages/i18n/messages/en.json` (12 keys each)
- `docs/tasks/0041b-proto-checks-v3.md` (Status line only)
- `docs/tasks/0041b-report.md` (this file)

## Commands

- `pnpm --filter @shoebox/validation test -- proto-checks-v3` before step 2: FAIL as expected (12 failed, 17 passed).
- `pnpm --filter @shoebox/validation test`: PASS, 29/29 (3 files, incl. unchanged `proto-checks.test.ts`).
- `pnpm --filter @shoebox/validation typecheck`: FAIL. `test/proto-checks-v3.test.ts(199,66): error TS2345: Argument of type '{ ico: string; dic: null; }' is not assignable to parameter of type '{ ico: string; dic: string; }'.`
- `pnpm --filter @shoebox/i18n test`: PASS, 24/24.
- `pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit`: PASS (no output, so `ProtoExtraction` still assignable).
- `pnpm eval --quick`: PASS (2 pass, 0 fail, 20 skip: M01 to M05 have no adapter registered, so the new checks are not exercised here).
- `pnpm exec biome check packages/validation packages/i18n`: FAIL, 2 formatting errors, both in the brief's test file (lines 85-91 and 153-157). `checks.ts` and the catalogs are clean after `biome format --write` on `checks.ts`.
- `python3 scripts/context_lint.py`: OK (warnings only: pre-existing "code path not created" for `packages/domain/rules`; "6 commits touched apps/packages after last status update").

## Brief §7

- [x] v3 test and unchanged `proto-checks.test.ts` pass; i18n tests pass.
- [ ] Validation typecheck clean: FAILS (see above).
- [ ] `grep -c "proto.check.buyer\." packages/i18n/messages/cs.json` = 4: see final run in the commit step.

## Deviations

- Status set to `blocked`, not `review`, because of the §8 stop condition (typecheck fails on the brief's test).
- Biome `format --write` applied to `checks.ts` (brief §4 step 2 allows Biome line reformatting).
- Commit messages use the orchestrator's `feat(validation): 0041b step k ...` prefix. Nothing pushed, no PR.

## Questions

- Typecheck: in the brief's test, `ORG` is inferred as `{ ico: string; dic: string }`, so `run({...}, icoOnly)` with `dic: null` does not typecheck (runtime is fine, 29/29 pass). Needs a test-side fix, e.g. typing `ORG` as `{ ico: string | null; dic: string | null }`. Owner or orchestrator decides; not edited here.
- Biome: the two formatting errors in the brief's test file need the same decision.

## Owner steps left

None. The orchestrator must rewrite the test-file typing and formatting, then rerun the typecheck.

## Fix 1

Brief: `docs/tasks/0041b-fix-1.md`. Test typing and Biome format only; `src/` unchanged.

- `ORG` typed as `{ readonly ico: string | null; readonly dic: string | null }` in `packages/validation/test/proto-checks-v3.test.ts`.
- `biome format --write` applied to the same test file (two long `expect` lines re-wrapped; no assertion changed).
- `pnpm --filter @shoebox/validation typecheck`: pass
- `pnpm --filter @shoebox/validation test`: pass (3 files, 29 tests)
- `pnpm exec biome check packages/validation`: pass (8 files, no fixes)
- `python3 scripts/context_lint.py`: OK (warnings only: pre-existing "code path not created yet" and "7 commits after last status.md update")
