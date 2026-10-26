# 0206 report

Status: review

## Files changed
- packages/extraction/package.json: added dependency `@shoebox/validation: workspace:*`
- pnpm-lock.yaml: lockfile updated for the workspace link
- packages/extraction/src/text/identifiers.ts: new, `foldText` and `findIdentifiers`
- packages/extraction/src/index.ts: export line added
- packages/extraction/test/text-identifiers.test.ts: new, brief test verbatim (not edited)

## Commands
- `pnpm --filter @shoebox/extraction test`: 8 files, 70 tests passed. The `-- text-identifiers` filter did not narrow the run, so the whole small package ran.
- `pnpm --filter @shoebox/extraction typecheck`: clean
- `pnpm exec biome check --write packages/extraction`: fixed formatting in identifiers.ts (line wraps only)

## Acceptance
- [x] test command passes

## Deviations
- IBAN regex: the brief's `\s?` separator let the match run across a newline (`CZ65 ... 5399\nVARIABILN`), so the test failed. Changed the separator to a plain space (` ?`). Checksum logic unchanged.

## Questions
- The IČO, DIČ and account regexes still use `\s?`, which can also cross line breaks. The tests pass, but the owner may want the same fix there.

## Owner steps left
- Review the party assignment in identifiers.ts (risk list).
