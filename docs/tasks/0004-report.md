# 0004 report: Money value object

Status: review. Branch `task/0004-money`, base `eac8bb2` (phase/0 at fetch time). Last step commit: `055616f 0004 step 7`.

## 1. Files changed (vs merge-base eac8bb2)

`git diff --stat origin/phase/0...HEAD` (note: origin/phase/0 has since moved to `2abc0ab`, which is not in this branch):

```
packages/domain/package.json          |  6 +-
packages/domain/src/index.ts          |  1 +
packages/domain/src/money/currency.ts | 24 ++
packages/domain/src/money/errors.ts   | 42 +++
packages/domain/src/money/index.ts    |  4 +
packages/domain/src/money/money.ts    | 173 +++
packages/domain/test/money.test.ts    | 392 +++
pnpm-lock.yaml                        | 25 +
docs/tasks/0004-money.md              |  2 +-  (Status only)
```

## 2. Commands (last lines)

- `pnpm --filter @shoebox/domain test -- money`: `Test Files 4 passed (4)`, `Tests 90 passed (90)` (runs all four domain files). `vitest run test/money.test.ts` alone: `Tests 31 passed (31)`.
- `pnpm --filter @shoebox/domain typecheck`: 0 `error TS` lines, exit 0 (the `@ts-expect-error` cases compile).
- `pnpm lint`: `Checked 122 files. No fixes applied.` / `Found 1 info.` (the pre-existing info line, allowed).
- `pnpm depcruise`: `✔ no dependency violations found (83 modules, 79 dependencies cruised)`.
- `pnpm test:unit`: `Test Files 28 passed (28)`, `Tests 190 passed (190)`, coverage `Lines 99.71% (347/348)`, `Statements 99.46%`, `Branches 94.37%`.

## 3. Acceptance (§7)

- [x] money.test.ts present and unchanged from the brief, including the `@ts-expect-error` type cases (typecheck clean).
- [x] Money tests green; domain line coverage 99.71% (gate 90%).
- [x] lint and depcruise pass.
- [x] `Money` exported from `packages/domain/src/index.ts` (via `export * from './money/index'`, Biome sorted it).

## 4. Deviations

- Brief says 32 money tests; the file as given contains 31 `it` blocks (counted by hand). Test file used verbatim, not edited.
- Brief step 7 Biome run reported `Fixed 1 file` (export ordering), as expected.
- `origin/phase/0` advanced to `2abc0ab` (Infra: Fable review) after this branch was cut. This branch is based on `eac8bb2`; the orchestrator should rebase or merge at review.
- Tool-call count went past the 25-call checkpoint at the very end; all steps 1 to 8 were completed, so nothing was left undone.

## 5. Questions

None.

## 6. Owner steps left

None. PR not opened (per instructions).
