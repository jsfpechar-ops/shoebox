# 0020 report

Status: review
Branch: task/0020-golden-labels (based on origin/phase/0 at 8ceb637)

## Files changed
- packages/testkit/package.json (zod 4.6.5 added as last dependency)
- pnpm-lock.yaml (zod entry only)
- packages/testkit/src/golden/schema.ts, load.ts, index.ts, labels-adapters/v1.ts (new)
- packages/testkit/src/index.ts (one export line; biome reordered the block)
- packages/testkit/test/golden-labels.test.ts (new, brief's test file, unchanged)
- docs/tasks/0020-golden-labels.md (Status: review)
- docs/tasks/0020-report.md (new)

## Commands
- pnpm --filter @shoebox/testkit test golden: Test Files 1 passed (1), Tests 14 passed (14)
- pnpm --filter @shoebox/testkit test: Test Files 5 passed (5), Tests 55 passed (55)
- pnpm --filter @shoebox/testkit typecheck: exit 0
- pnpm lint: no errors; Biome reports 1 info (config migration hint), no fixes applied
- python3 scripts/context_lint.py: OK (warnings only: domain/rules path not created yet; status.md not updated)

## Section 7 (acceptance)
- [x] golden set loads on committed testdata/golden-v1 (20 docs, 12 bookable, 2 duplicates)
- [x] 19 documents rejected
- [x] comma-decimal and JS-number money rejected, value not echoed
- [x] v1 adapter applied in order
- [x] expected/*.json merge and unknown-document failure
- [x] amounts are Money in document currency; domain enums used
- [x] files per section 3
- [x] section 6 commands pass

## Deviations
- Step 1 anchor absent: package.json already had @shoebox/extraction and @shoebox/registries; zod added last.
- index.ts line added after './registries/index' (last export line); biome reordered the block.
- Commits grouped: steps 1-5 in one commit (message says step 1), steps 6-7 in one commit. Tool-call budget forced the grouping.
- Source and test files were copied byte-for-byte from the brief's code blocks by script, not typed with Write.
- Branch created with checkout -B on the fetched origin branch (setup line).

## Questions
- None.

## Owner steps left
- None. Orchestrator opens and merges the PR into phase/0.
