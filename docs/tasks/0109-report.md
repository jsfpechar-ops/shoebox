# 0109 report: CAMT.053 and MT940 parsers, parseStatement

Status: review

## Files changed (`git diff --stat 9493b36^ HEAD -- packages/bank`)

8 files, 839 insertions: `src/index.ts` (+3), `src/parse.ts`, `src/parsers/camt053.ts`, `src/parsers/mt940.ts`, `src/xml.ts`, `test/camt053.test.ts`, `test/mt940.test.ts`, `test/parse.test.ts`.

Commits: `0109 step 1` (9493b36), `step 2` (41f8839), `step 4` (c4987c9), `step 6` (184afff), `step 7` (38ccc41). Not pushed.

## Commands (last lines)

- `pnpm --filter @shoebox/bank exec vitest run` (same as the package `test` script): `Test Files 7 passed (7)`, `Tests 81 passed (81)`.
- `pnpm --filter @shoebox/bank typecheck`: exit 0, no errors.
- `pnpm biome check packages/bank`: after one `--write` (formatting only), `Checked 19 files`, 0 errors, `Found 2 infos`.
- `diff <(tail -n +3 packages/extraction/src/isdoc/xml.ts) <(tail -n +3 packages/bank/src/xml.ts)`: empty.

## Checklist (§7)

- [x] Test files match §4 (formatter re-wrapping only) and pass.
- [x] XML copy diff from line 3 is empty.
- [x] Typecheck and biome clean (no errors).

## Deviations

- Test files were extracted in one pass with a script (before step 2) and then committed per step, not written one step at a time. Content is verbatim.
- Step 1: the "first comment line" is line 2 (the text line). Line 1 is `/**`.
- Typecheck fix in `camt053.ts`: `[...details]` (readonly array to mutable type).
- Biome `--write` also re-wrapped the test files and implementation (formatter only).

## Questions and choices the brief did not settle

- CAMT: an entry with no `Sts` is skipped (literal reading: only `BOOK` is kept).
- CAMT: a `Document` without `Stmt` returns an empty statement with no warning.
- CAMT: bad XML returns an empty statement with `camt.bad_xml` and no `account`.
- CAMT: an entry with no valid `BookgDt` is skipped.
- MT940: a `:61:` whose value date is unparseable is reported as `mt940.bad_line`.
- MT940: `?32` and `?33` are joined with a space; `?20`–`?29` are joined with no separator.
- MT940: the `-` end-of-message line is not handled (the `:62F:` regex would not match it if present).
- MT940: the `:28C:` value is stored as written.

## Odd

- `packages/bank/src/parsers/mt940.ts` changed on disk during the session. I took the current file as it is; the MT940 test passes.
- `scripts/pii_guard.py`, `testdata/pii-allowlist.txt` and `scripts/__pycache__` show as modified or untracked. I did not touch them and did not commit them.

## Owner steps left

- Review, then push and open the PR when ready (not pushed, as instructed).
