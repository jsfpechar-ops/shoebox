# 0210 report: ISDOC 6.0.2 export

Status: review

## Files changed
- packages/exports/package.json: added `dependencies` with `@shoebox/domain` (workspace:*)
- pnpm-lock.yaml: lockfile update for the workspace dependency
- packages/exports/src/index.ts: `export * from './isdoc/build';`
- packages/exports/src/isdoc/build.ts (new): `buildIsdoc`, `isdocUuid`, `IsdocParty`, `IsdocExportInput`
- packages/exports/test/isdoc-build.test.ts (new): test from the brief (biome formatting only)
- docs/tasks/0210-isdoc-export.md: Status set to review
- docs/tasks/0210-report.md (new): this report

## Commands
- `pnpm --filter @shoebox/exports test 2>&1 | tail -30`: 2 files, 7 tests passed (rerun after formatting: still 7 passed)
- `pnpm --filter @shoebox/exports typecheck 2>&1 | tail -30`: clean (tsc exit 0)
- `pnpm exec biome check --write packages/exports 2>&1 | tail -30`: checked 7 files, fixed 2 (formatting only)

## Deviations
- Done: steps 1 and 2 (all). Left: none.
- One commit, as the orchestrator asked, instead of per-step commits.
- No PR opened; push not done (per instruction).

## Questions
- Null IČO: `PartyIdentification` is omitted when `ico` is null. The brief does not say what to do here. Please confirm.

## Owner steps left
- None.
