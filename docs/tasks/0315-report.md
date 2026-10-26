# 0315 report

Status: review

## Files changed
- packages/extraction/src/categorize/schema.ts (new)
- packages/extraction/src/categorize/run.ts (new)
- packages/extraction/src/index.ts (2 export lines)
- packages/extraction/test/categorize-llm.test.ts (new, brief verbatim, then biome formatting only)

## Commands
- `pnpm --filter @shoebox/extraction test -- categorize-llm`: 15 files, 123 tests passed (filter ran the whole package)
- `pnpm --filter @shoebox/extraction typecheck`: 0 errors
- `pnpm eval --quick`: PASS, 2 pass, 0 fail, 20 skip (no adapter registered for M01–M05), no baseline to compare
- `pnpm exec biome check`: 1 error left, see Deviations

## Section 7
- [x] Tests pass, typecheck 0 errors, eval quick PASS (no prior baseline)
- [x] Prompt has the nine M04 §4.3 rules in English
- [x] Prompt version `m04-categorize-v1`

## Deviations
- Biome `--write` (formatting) reordered the two export lines in index.ts, so they sit before `./exact/apply` rather than after `./llm/provider`.
- Biome lint error left, not fixed (test file is brief-owned): `packages/extraction/test/categorize-llm.test.ts:159` `noUnsafeOptionalChaining` on `(built.request.messages[0]?.content[0] as {text: string}).text`.
- Context read: M04 §4.3 section only (to write the prompt).

## Questions
- Should the biome lint error at test line 159 be fixed in the brief?

## Owner steps left
- None. Not pushed, no PR.
