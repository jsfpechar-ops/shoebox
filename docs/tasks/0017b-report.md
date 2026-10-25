# 0017b report: rule schemas for the 36 law keys

Branch: task/0017b-rules-law (base: phase/0 at af3d76e, which contains 0017a).

## 1. Files changed (git diff --stat origin/phase/0...HEAD)

```
packages/domain/src/rules/atoms.ts     |  49 ++++
packages/domain/src/rules/index.ts     |  18 +++
packages/domain/src/rules/law.ts       | 117 ++++
packages/domain/test/rules-law.test.ts | 120 ++++
4 files changed, 304 insertions(+)
```

Commits: 0017b step 1 (atoms), step 2 (law), step 3 (index exports, Edit in two anchored places, same final content as the brief), step 4 (test file, byte-as-given). Report and status commit follow.

## 2. §6 commands (last 5 lines)

1. `pnpm --filter @shoebox/domain test rules`
```
 Test Files  2 passed (2)
      Tests  75 passed (75)
```
2. `pnpm --filter @shoebox/domain typecheck`: exit 0, no `error TS`.
3. `pnpm lint`: Biome checked 138 files, "Found 1 info." (pre-existing info, a Biome config migration notice). 0 errors.
4. `pnpm depcruise`
```
✔ no dependency violations found (100 modules, 123 dependencies cruised)
```
5. `pnpm test:unit`
```
 Test Files  32 passed (32)
      Tests  305 passed (305)
Lines        : 99.05% ( 523/528 )
```
Domain coverage gate (≥ 90 %) met by the global figure above.

Also: `pnpm exec biome check packages/domain/src/rules` passed with "No fixes applied".

## 3. §7 acceptance

- [x] LAW_RULE_SCHEMAS has exactly 36 keys (test asserts count).
- [x] Each key accepts one fake valid and rejects one invalid value; strict objects reject extras; percentages allow at most two decimals.
- [x] No float carries an amount (whole CZK are integers, fractional amounts are decimal strings).
- [x] test rules green (75), typecheck, lint, depcruise green.

## 4. Deviations

- `index.ts` edited with two anchored Edits instead of one whole-file replace (the Write tool needs a prior Read). Final file content matches the brief's step 3 block.
- The Bash call that committed step 4 was refused by the worktree guard once (compound git command); split into separate commands, no effect on content.
- No `[verify]` items in this brief.

## 5. Questions

None.

## 6. Owner steps left

None. Orchestrator opens and merges the PR into phase/0 and adds the known-issues line for the module-owned loose schemas.
