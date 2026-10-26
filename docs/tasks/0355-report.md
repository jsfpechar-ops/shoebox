# 0355 report

Status: review (orchestrator: override fixture source set to a valid URL)
Commit: c3ff2ad (branch wt-0355)

## Files changed
- packages/domain/src/income-tax/flat-rate.ts (new)
- packages/domain/test/flat-rate.test.ts (new, brief verbatim)
- packages/domain/src/index.ts (one export line after ./income-tax/answers)

## Checks
- `pnpm --filter @shoebox/domain exec vitest run test/flat-rate.test.ts`: 6 passed, 1 failed.
  Failing: "general 7: override row ..." throws `RuleValueError: source: Invalid URL`.
  Cause: the brief's override literal uses `source: 'test'`, which the rules schema rejects (source must be a URL).
- `pnpm --filter @shoebox/domain typecheck`: passed.
- `pnpm exec biome check --write` on the 3 files: clean.
- `pnpm depcruise`: no dependency violations.

## Deviations
- Imports in flat-rate.ts are value imports (`CZK, floor0, Money, round0`), not `import type { Money }`, because the function constructs Money.
- Used Money.multiply/divide/subtract (not Decimal arithmetic) and a template literal in the throw message (biome).
- Done: steps 1 to 4 (code, test file, index export, commit). Left: fix the override test (step 2) and rerun.
- Commit message is the brief's step 4 message with the required trailers, not `0355 step k`.

## Questions
- Owner or orchestrator: may the test's override `source` be changed to a valid URL (for example the ZDP `#p7` source string used in rules/cz/2026.ts)? The executor may not edit the brief's test file, so I stopped.
- TA-13 and TA-14 `[verify]` findings are not recorded: the blocker stopped the run before the report could carry them.

## Owner steps left
- None until the test source question is answered.
