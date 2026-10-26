# 0522 report

Status: review

## Files changed (git diff --stat, plus new files)

- `packages/domain/src/llm-pricing.ts` (new): price table in nano-USD, `llmCostUsd`, `LLM_PRICING_VERIFIED_AT`
- `packages/domain/test/llm-pricing.test.ts` (new): 4 unit tests
- `packages/domain/src/index.ts`: +1 export line
- `packages/db/src/document-reading.ts`, `doc-split.ts`, `document-categorize.ts`: +import, +`costUsd: llmCostUsd(run.model, run),`
- `packages/testkit/src/factories/document-details.ts`: `pipelineEventFactory` and its list entry (0520 follow-up)
- `docs/tasks/0522-llm-cost.md`: status set to review (its 18 other uncommitted lines were already in the working tree)
- `docs/tasks/0522-report.md` (new)

## Commands

- `pnpm --filter @shoebox/domain exec vitest run llm-pricing`: 1 file, 4/4 passed
- `pnpm --filter @shoebox/domain typecheck`: clean
- `pnpm --filter @shoebox/db typecheck`: clean
- `pnpm --filter @shoebox/db exec vitest run test/rls` (fresh DB): 5 files, 28/28 passed
- `pnpm --filter @shoebox/db exec vitest run document-reading` (fresh DB): 5/5 passed
- `pnpm exec biome ci packages/domain packages/db packages/testkit`: clean (after `biome check --write` on the 3 db files to fix import order)
- `python3 scripts/context_lint.py`: OK (warnings only: open-brief overlaps on tax-xml and filings, 8 commits since last status update)

## Deviations

- The brief's `pnpm --filter ... test -- <file>` form ignores the file filter here and ran the whole suite (45 domain files, 703 passed). The `exec vitest run <file>` form was used for the real check.
- The shared local DB `shoebox_test` has the `analytics` schema from migration 0064 but no journal entry for it, so `runMigrations` fails with 42P06 in every db suite (34 files). Not changed. The tests were run on a fresh DB `shoebox_0522` loaded with `packages/db/scripts/supabase-shim.sql`, which was dropped afterwards.
- Price table taken from the M02 §4 text in the brief; not checked against the provider's price page.
- `.gitignore` had a pre-existing uncommitted change; not committed.
- No PR opened and nothing pushed.

## Questions

None.

## Owner steps left

1. Reset the local `shoebox_test` DB (or drop `analytics` and the 0064 leftovers) so the db suites run on the shared sandbox.
2. Review and push the branch, then open the PR to `phase/0`.
