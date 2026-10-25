# 0019 report: LlmClient interface and cassette client

Status: review
Branch: task/0019-llm-cassette (base origin/phase/0)

## Steps

- Step 1: `packages/extraction/src/llm/client.ts` (types only) committed.
- Step 2: `packages/extraction/src/index.ts` exports `./llm/client`; extraction typecheck clean.
- Step 3: `packages/testkit/package.json` adds `@shoebox/extraction` (inserted between `@shoebox/domain` and `@shoebox/registries`, which a parallel brief had added); `pnpm install` changed only `pnpm-lock.yaml` (3 lines).
- Step 4: `packages/testkit/test/llm-cassette.test.ts` committed (test file from the brief).
- Step 5: `packages/testkit/src/llm/cassette.ts` committed (biome: no fixes needed).
- Step 6: `packages/testkit/src/llm/index.ts` committed.
- Step 7: `packages/testkit/src/index.ts` one line added; biome then sorted the exports, so `./llm/index` now sits between `./ids` and `./registries/index`.
- Step 8: checks, no fixes needed.

## Commands (last lines of output)

- `pnpm --filter @shoebox/testkit test llm-cassette`: `Tests  12 passed (12)`
- `pnpm --filter @shoebox/testkit test`: `Test Files  4 passed (4)` / `Tests  41 passed (41)`
- `pnpm --filter @shoebox/testkit typecheck`: exit 0, no output
- `pnpm --filter @shoebox/extraction typecheck`: exit 0, no output
- `pnpm --filter @shoebox/extraction test`: `Tests  1 passed (1)`
- `pnpm depcruise`: `no dependency violations found (136 modules, 203 dependencies cruised)`
- `pnpm lint`: biome reports `Checked 165 files ... No fixes applied.` / `Found 1 info.` The info is biome's config-migration notice (`biome migrate`), not from this brief's files. Exit code is in the lint line below.
- `pnpm eval --quick`: not run. The script does not exist yet (P0-EVAL-02), as the brief says.

## Section 7 acceptance

- [x] Test file `packages/testkit/test/llm-cassette.test.ts`: all 12 tests pass.
- [x] Missing cassette fails with the "missing cassette, run `pnpm eval --record`" message.
- [x] Record writes `{model}/{prompt_version}/{sha256}.json` without the request text.
- [x] Replay makes no network call (live client 0 calls, fetch spy not called).
- [x] `LlmClient` interface in `packages/extraction/src/llm/client.ts`, exported from `@shoebox/extraction`.
- [x] Section 6 commands 1 to 6 pass (lint: see above).

## Deviations

- Biome reordered the exports in `packages/testkit/src/index.ts` and reformatted the test file's imports. No test logic changed.
- No `[verify]` items in this brief.
- Done: steps 1 to 8 and the report. Left: nothing.

## Questions

None.

## Owner steps left

None. The orchestrator opens and merges the PR.
