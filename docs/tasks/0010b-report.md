# 0010b report: custom lint rules as Biome GritQL plugins

Status: review. Branch: task/0010b-biome-plugins (base c7e2996, PR base phase/0).

## 1. Files changed (`git diff --stat c7e2996 HEAD`)

```
 biome.json                                     |  21 ++-
 scripts/lint/test/custom-rules.test.ts         | 185 +++++++++++++++++++++++++
 tools/biome-plugins/no-date-now-in-domain.grit |   9 ++
 tools/biome-plugins/no-jsx-literal-text.grit   |  18 +++
 tools/biome-plugins/no-number-money.grit       |   9 ++
 tools/biome-plugins/no-raw-sql-outside-db.grit |   7 +
 6 files changed, 248 insertions(+), 1 deletion(-)
```

Note: `origin/phase/0` moved to b2d5e75 (research commit) after my fetch. `git diff origin/phase/0` therefore also shows that research file as deleted; this is not a change of this branch. The PR diff against phase/0 is the six files above.

## 2. Commands (last 5 lines of output)

- `pnpm lint` (after step 4, plugins not yet wired): `Checked 97 files`, `No fixes applied.`, `Found 4 warnings.`, `Found 1 info.` (exit 0).
- `pnpm lint` (after step 5, biome.json replaced): `Checked 97 files in 544ms. No fixes applied.`, `Found 1 info.`, no warnings. Exit 0.
- `pnpm vitest run --project unit scripts/lint/test/custom-rules.test.ts`: `Test Files 1 passed (1)`, `Tests 12 passed (12)`.
- `pnpm vitest run --project unit scripts/lint`: `Test Files 2 passed (2)`, `Tests 22 passed (22)`.
- `pnpm lint` (final): `Checked 98 files`, `No fixes applied.`, `Found 1 info.`
- `pnpm typecheck`: `Tasks: 16 successful, 16 total`.
- `git status --porcelain | grep fixture`: no output (no fixture left).

## 3. Acceptance (§7)

- [x] Five rules exist as plugins and `pnpm lint` enforces them. T-17 result: "GritQL plugins (Biome 2.5.15) cover all five rules, ts-morph not used". Confirmed by the 12 passing tests, which show each plugin emitting its diagnostic.
- [x] `custom-rules.test.ts`: "Uložit" fails, `t('doc.confirm')` passes (AC-5), one failing and one passing fixture per rule, 12 tests green, no fixture left.
- [x] No `ci.yml` change; `pnpm lint` is `biome ci .`, which loads the plugins.
- [x] `pnpm lint` shows 0 warnings; the four `useBiomeIgnoreFolder` warnings are gone.

## 4. Deviations and findings

- Deviation: none in the code. The four `.grit` files and `biome.json` were written byte-exact to the brief.
- Setup: `pnpm install --frozen-lockfile` was needed (no `node_modules` in the worktree). No lockfile change.
- Hook note: a security-guidance hook flagged `dangerouslySetInnerHTML` when the test file was written. It is a string inside a lint fixture, not rendered code.
- T-17 verified by build and test run, Biome 2.5.15.

## 5. Questions

None.

## 6. Owner steps left

None for this brief. At the Phase 0 gate the orchestrator closes T-17 with the finding above.
