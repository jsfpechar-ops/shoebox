# 0017c report: rule keys, RuleSet, getRuleKeySchema, createRules

Status: review. Branch `task/0017c-rules-keys` (base phase/0 at 0c0befe, which contains 0017a and 0017b).

## 1. Files changed (`git diff --stat origin/phase/0...HEAD`)

```
packages/domain/src/rules/index.ts      | 12 ++
packages/domain/src/rules/keys.ts      | 48 ++++++++
packages/domain/src/rules/product.ts   | 69 +++++++++++
packages/domain/test/rules-keys.test.ts | 197 ++++++++++++++++++++++++++++++++
4 files changed, 326 insertions(+)
```

Plus the brief's own Status line set to `review`.

## 2. Commands (last lines of output)

- `pnpm --filter @shoebox/domain test rules`: `Test Files 3 passed (3)`, `Tests 127 passed (127)`.
- `pnpm --filter @shoebox/domain typecheck`: `tsc -p tsconfig.json`, no errors, exit 0.
- `pnpm lint` (exit 0): the lint run ended with `Test Files 3 passed (3)`, `Tests 24 passed (24)`. The lint output tail did not show the `Found 0 errors` line; exit code is 0.
- `pnpm depcruise`: `✔ no dependency violations found (103 modules, 136 dependencies cruised)`.
- `pnpm test:unit`: `Test Files 33 passed (33)`, `Tests 357 passed (357)`. Coverage: Lines 99.08 %, Statements 98.46 %, Branches 93.25 %, Functions 99.29 %.
- `pnpm exec biome check packages/domain/src/rules`: `Checked 8 files. No fixes applied.`

## 3. Acceptance (§7)

- [x] `RULE_SCHEMAS` has 75 keys (36 law + 39 product), typed `RuleSet`, each product key accepts a sample and rejects a bad one.
- [x] `RuleEntrySchema` and `RuleSetSchema` behave as specified (tests green).
- [x] `rules-engine.test.ts` (0017a) still green (in the 127 rules tests).
- [x] `getRuleKeySchema` exported, throws `UnknownRuleKeyError`, including for `toString`.
- [x] `createRules(...).at(date).get('vat.rates')` typed as `RuleSet['vat.rates']`.

## 4. Deviations

None in content. Steps 1 to 4 committed as `0017c step 1` to `0017c step 4`, each pushed.

## 5. Questions

None.

## 6. Owner steps left

Open and merge the PR `task/0017c-rules-keys` into `phase/0` (the orchestrator opens it per the brief).
