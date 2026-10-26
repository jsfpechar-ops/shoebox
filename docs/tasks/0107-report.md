# 0107 report: Bank normalisers

Status: review

## 1. Files changed (`git diff --stat 7c2f2f5 HEAD`)

```
packages/bank/package.json           |   4 +
packages/bank/src/index.ts           |   2 +
packages/bank/src/normalize.ts       |  96 +++++++++++++++++++++++
packages/bank/src/types.ts           |  77 ++++++++++++++++++
packages/bank/test/normalize.test.ts | 148 +++++++++++++++++++++++++++++++++++
pnpm-lock.yaml                       |   7 ++
6 files changed, 334 insertions(+)
```

Commits: `0107 step 1` to `0107 step 5`, plus `0107 format test file with biome`. Not pushed.

## 2. Commands

- `pnpm install 2>&1 | tail -5`: `Done in 7.3s`. Lockfile changed only in the `packages/bank` importer (two workspace links).
- `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -30`: clean (no errors).
- `pnpm --filter @shoebox/bank test 2>&1 | tail -30`:
  ```
  Test Files  2 passed (2)
  Tests  50 passed (50)
  ```
- `pnpm biome check packages/bank 2>&1 | tail -30`: one formatting error in the brief's test file (a `symbolsFromText` line). Fixed once with `pnpm biome check --write packages/bank` (per §6). Recheck: `No fixes applied`, clean.
- `grep -nE "Number\(|parseFloat|parseInt" packages/bank/src/normalize.ts`: no matches.

## 3. Not done / deviations

- Nothing from §4 was skipped. No PR opened (the owner asked for no push).
- Step 4 test file: the brief lists `'1 234,56'` twice. The rendering does not show whether the second one holds a NBSP. Both are written with a regular space, so NBSP handling is not covered by a test. Owner may want the second line changed to a NBSP.
- `parseSymbol` length rule: applied to the digits after leading zeros are stripped (so `000000000001` gives `1`). The brief said "> 10 digits" without saying before or after stripping.
- The format fix (biome) is a separate commit, not part of a step commit.

## 4. Owner steps left

None for this brief. Next: push the branch and open the PR when the owner wants it.
