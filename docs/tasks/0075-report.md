# 0075 report: ISDOC reader

Status: done
Base: 1e90c0d (phase/0). Commits: `0075 step 2` (c885bc5), `0075 report`.

## Files changed

Patch from the brief applied with no error. `git diff --stat HEAD~2` also lists `0076` and `0077` briefs, which were already in the base commit 834def4 and are not part of this change.

- packages/extraction/src/index.ts (+3)
- packages/extraction/src/isdoc/find.ts (new, 174)
- packages/extraction/src/isdoc/map.ts (new, 176)
- packages/extraction/src/isdoc/xml.ts (new, 216)
- packages/extraction/test/isdoc.test.ts (new, 312)
- docs/tasks/0075-isdoc-reader.md (Status line only, plus the patch-step status change)

## §6 commands

1. `pnpm --filter @shoebox/extraction test -- test/isdoc.test.ts`: FAIL to narrow. The filter was not applied and all 6 files ran. Last lines: `Test Files  6 passed (6)`, `Tests  49 passed (49)`. Brief expected 18. Deviation (see below).
2. `pnpm --filter @shoebox/extraction test`: PASS. `Tests  49 passed (49)`.
3. `pnpm --filter @shoebox/extraction typecheck`: PASS, no errors.
4. `pnpm exec biome check packages/extraction`: PASS. `Checked 18 files in 3s. No fixes applied.`
5. `pnpm eval --quick`: PASS, exit 0. `Result: PASS · 2 pass · 0 fail · 20 skip · 0 report · 23 ms`. M01 to M05 have no adapter registered (skip). Wrote gitignored eval-report.json and eval-report.md.

Extra check: `npx vitest run test/isdoc.test.ts` in packages/extraction: `Tests  18 passed (18)`.

## §7 acceptance

- Only §3 files plus brief and report changed: yes.
- §6 commands pass: yes, with the filter note above.
- `grep -cE 'fast-xml-parser|fflate|pdfjs' packages/extraction/package.json` → `0`: pass.

## Deviations

- The `pnpm ... test -- <file>` form ran the whole package. Results are the same as the brief's full-package expectation (49). The isolated 18-test run was done with `npx vitest run` in the package.
- No other deviation. No file outside §3 was edited.

## Questions

None.

## Owner steps left

- Push branch and open PR against phase/0 (orchestrator does this per brief §4).
