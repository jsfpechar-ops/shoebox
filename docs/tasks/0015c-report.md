# 0015c report

Status: review (0015c-fix-1 applied: Radix focus guards excluded from the axe context)

Branch: task/0015c-ui-a11y. Commits: step 1 3acc2c7 (axe exclude), step 2 (this report and status lines).

## Files changed (branch vs phase/0 merge base)

```
 docs/tasks/0015c-fix-1.md      |  46 +++++++++++
 docs/tasks/0015c-report.md     |  41 ++++++++++
 docs/tasks/0015c-ui-a11y.md    |   2 +-
 packages/ui/package.json       |   4 +-
 packages/ui/test/a11y.test.tsx | 180 +++++++++++++++++++++++++++++++++++++++++
 pnpm-lock.yaml                 |   9 +++
 6 files changed, 280 insertions(+), 2 deletions(-)
```

Note: a plain `git diff --stat origin/phase/0` also lists phase/0 commits the branch does not contain yet (the branch is behind phase/0), so it is not the branch's own change set.

## Commands (last lines)

- `pnpm --filter @shoebox/ui test:a11y`: Test Files 1 passed (1), Tests 6 passed (6).
- `pnpm --filter @shoebox/ui test`: Test Files 9 passed (9), Tests 67 passed (67).
- `pnpm --filter @shoebox/ui typecheck`: no `error TS` lines (clean).
- `pnpm exec biome check --write packages/ui`: Checked 22 files, No fixes applied.
- `pnpm lint`: exit 0. Biome reports one info (config migration hint), no errors. i18n tests: 3 files, 24 tests passed.

## Acceptance (0015c section 7)

- [x] test:a11y reports 0 axe violations in light and dark (WCAG 2.0 to 2.2 A/AA; color contrast left to P0-UI-03).
- [x] Showcase, Dialog and Sheet are inside the axe run.
- [x] Test-map row packages/ui works as written (test:a11y exists).

## Deviations

- 0015c-fix-1 step 1: axe context is `{ include: [document], exclude: [['[data-radix-focus-guard]']] }`. Biome reformatted the call over several lines. No src/ change was needed.
- Vitest does not typecheck the test file; the tsc typecheck of packages/ui passed with the change.

## Questions

- None blocking. The decisions.md line for axe-core and for the focus-guard exclusion is for the orchestrator to add (the brief says the orchestrator owns it).

## Owner steps left

1. Review the PR from task/0015c-ui-a11y against phase/0 and merge it (the orchestrator opens the PR).
