# 0070 report: Přehled totals (pure)

Status: review
Branch: task/0070-overview-totals (base 69ff582)

## 1. Files changed

```
packages/domain/src/overview/totals.ts          (new, 257 lines)
packages/domain/test/overview-totals.test.ts    (new, 212 lines)
docs/tasks/0070-overview-totals.md              (Status: todo -> review)
docs/tasks/0070-report.md                       (new)
```

Untracked before commit: `git diff --stat` shows nothing for tracked files except the brief status line; the two domain files are new.

## 2. Commands and last lines

1. `pnpm --filter @shoebox/domain test -- overview-totals 2>&1 | tail -30`
   ```
    Test Files  10 passed (10)
         Tests  276 passed (276)
      Duration  1.02s
   ```
   Note: the `-- overview-totals` filter did not narrow the run here; all 10 domain test files ran. Run alone, `pnpm exec vitest run test/overview-totals.test.ts` gives 13 passed (1 file).

2. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
   ```
   > tsc -p tsconfig.json
   ```
   Exit 0, no errors.

3. `pnpm exec biome check packages/domain 2>&1 | tail -30`
   First run: 2 formatting errors (both new files). Then `biome check --write` on the two files (allowed by §4 step 3). Re-check:
   ```
   Checked 34 files in 2s. No fixes applied.
   ```

4. `python3 scripts/context_lint.py 2>&1 | tail -30`: see the result line below.

## 3. Section 7 acceptance

- [x] Test file passes (13 of 13 in the file). Formatter reflowed it under step 3's `--write` authority; no assertion changed. Deviation from "byte-identical".
- [x] No `number` arithmetic on money; only `Money` methods.
- [x] Typecheck and biome clean.

## 4. Deviations

- `biome --write` reformatted the test file (line wrapping only). Brief §7 says byte-identical; brief §4 step 3 explicitly allows the write. Owner may want to confirm.
- Sets of statuses and classes are typed `ReadonlySet<string>`, not the enum types, so a typo in those lists would not fail typecheck. Values match §2.

## 5. Questions

- `TURNOVER_EXCLUDED_TREATMENTS` carries the `TODO(verify)` comment as specified; the rule-key move is not done.
- Pending documents whose FX rate is missing count toward `pending.count` but add 0 to `grossCzk` (matches the test).

## 6. Owner steps left

None. No merge, no PR, no push to `main` or `phase/0`.
