# 0100 report: semantic dedupe

Status: review

## Files changed (git diff --stat origin/phase/0)

- packages/db/src/semantic-dedupe.ts (new, 58 lines): `markIfSemanticDuplicate`
- packages/db/src/document-reading.ts (+5): calls it at the end of `saveDocumentReading` when status is not `supporting`
- packages/db/src/index.ts (+1): export
- packages/db/test/semantic-dedupe.db.test.ts (new, 184 lines): 5 cases, as given in the brief
- docs/tasks/0100-semantic-dedupe.md (Status todo -> review), this report

## Commands (last 5 lines)

- `pnpm --filter @shoebox/db typecheck`: no errors (exit clean, after each step and at the end).
- `pnpm --filter @shoebox/db test -- semantic-dedupe document-reading`: 3 files passed, 15 skipped; 29 tests passed, 102 skipped. The new test file is skipped: no DATABASE_URL in this session. CI `db` job must run it.
- `pnpm exec biome check packages/db`: clean after the fixes below.

## Brief section 7

- [ ] Test file passes in CI (`db` job): NOT verified locally (no DATABASE_URL). Pending CI.
- [x] Diff lists only the 4 files in section 3, plus the brief and this report.

## Deviations

- Biome reformatted the new test file (line wrapping only, no logic change) and reordered the export in index.ts, per section 6 (`biome format --write` / `biome check --write`). Test content otherwise unchanged.
- Step 1 schema check: `documentLinks` column names matched (orgId, fromDocumentId, toDocumentId), no change needed.
- Commits: "0100 step 1", "0100 step 2", "0100 step 3", "0100 step 4", "0100 step 4 biome format".

## Questions

None.

## Owner steps left

- Review the PR when the orchestrator opens it, and confirm the CI `db` job passes the new semantic-dedupe test.
