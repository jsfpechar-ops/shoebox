# 0040a report

Status: review

## Files changed
- `packages/extraction/test/anthropic.test.ts` (step 1 of the fix: the `output: undefined` line replaced by destructuring `output` out of `request`; the brief's test is otherwise unchanged)
- `packages/extraction/src/llm/anthropic.ts` (replaced stub, 0040a step 2)
- `packages/extraction/src/llm/provider.ts` (0040a step 3)
- `packages/extraction/test/provider.test.ts` (0040a step 4)
- `docs/tasks/0040a-anthropic-adapter.md` (Status line only)
- `docs/tasks/0040a-report.md` (this report)

## Commands
- `pnpm --filter @shoebox/extraction test -- anthropic provider`: `Test Files  5 passed (5)`, `Tests  30 passed (30)`, exit 0.
- `pnpm --filter @shoebox/extraction typecheck`: exit 0 (`tsc -p tsconfig.json`, no errors).
- `pnpm exec biome check packages/extraction` (not in the brief; run to see whether `_unused` is flagged): `_unused` is not flagged. It reports 6 errors outside the fix: format in `src/llm/anthropic.ts` and `test/anthropic.test.ts`, and `noExplicitAny` at `test/anthropic.test.ts` lines 70, 73, 79, 104. Not changed (brief says touch nothing else).
- `grep -n "anthropic-ai" packages/extraction/package.json`: no output (ok).
- `pnpm eval --quick`: `Result: PASS · 2 pass · 0 fail · 20 skip · 0 report · 18 ms` (M01 to M05 SKIP, no adapter registered; same as before the adapter), exit 0.

## Section 7
- [x] anthropic and provider tests pass
- [x] typecheck clean
- [x] `pnpm eval --quick` unchanged
- [x] no `anthropic-ai` in extraction package.json

## Deviations
- Step 1 of the fix was committed as `45f0e84`. `node_modules` was missing, so I ran `pnpm install --frozen-lockfile` (no lockfile change).
- Done: fix steps 1 and 2, 0040a steps 1 to 4 and the report. Biome errors above are left for the owner or a later brief.

## Questions
1. Brief context says Anthropic rejects `minimum`/`maximum`/`minLength`/`maxLength` in schemas. I did not check `proto/schema.ts` (not in the brief's file list). If it uses them, live calls will return 400.

## Owner steps
None for this brief.

## fix-2: biome clean

- `pnpm exec biome check packages/extraction`: no errors (14 files checked).
- `pnpm --filter @shoebox/extraction typecheck`: clean.
- `pnpm --filter @shoebox/extraction test -- anthropic provider`: 5 files, 30 tests passed.
- Changes: `Json` alias with biome-ignore in `anthropic.test.ts`; `Record<string, any>` replaced by `Record<string, Json>`; format only in `anthropic.ts`.
