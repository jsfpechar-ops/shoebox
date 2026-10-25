# 0071 report: Přehled limit meters (pure)

Status: review. Branch `task/0071-limit-meters`, cut from `69ff582` (the base given in the executor setup; the brief header names `37d843b`, which exists in history).

## 1. Files changed

- `packages/domain/src/overview/meters.ts` (new): `computeLimitMeters`, `meterLevel`, `METER_RATIOS`, `PAUSAL_BAND_WARN_CZK`, types exactly as §4 step 2. Limits come from `rules`; no limit number is typed in.
- `packages/domain/test/overview-meters.test.ts` (new): content as §4 step 1, unchanged.
- `docs/tasks/0071-limit-meters.md`: Status line only (`todo` to `review`).
- `docs/tasks/0071-report.md` (new): this report.

## 2. Commands

- `pnpm --filter @shoebox/domain test -- overview-meters 2>&1 | tail -30`: passes. Last lines: `Test Files  10 passed (10)`, `Tests  271 passed (271)`. The filter did not narrow the run, so all 10 domain test files ran.
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`: 0 errors (tsc printed no diagnostics).
- `pnpm exec biome check packages/domain 2>&1 | tail -30`: `Checked 34 files in 2s. No fixes applied.`
- `python3 scripts/context_lint.py 2>&1 | tail -30`: `context lint: OK`. Warnings (pre-existing, not from this change): `packages/domain/rules` path not created yet (AGENTS.md, rules.md, test-map.md, workflow.md) and "12 commit(s) touched apps/ or packages/ after the last status.md update".

## 3. §7 acceptance

- [x] Test file byte-identical to §4 step 1, passes.
- [x] Limits read from `rules`; only `METER_RATIOS` and `PAUSAL_BAND_WARN_CZK` are constants.
- [x] Typecheck and biome clean.

## 4. Deviations

None to the brief's content. The domain test command ran all 10 files because the `-- overview-meters` filter did not apply.

## 5. Questions

- The brief header says base `37d843b`, but the setup named `69ff582`. I used `69ff582` as instructed.
- `pausalni_vydaje` uses `String(pausalRate / 100)` as the divisor (`'0.8'`, `'0.6'`, ...). The brief's tests cover only rate 60 (2 000 000.00); rates 80, 40 and 30 are not exercised by any test.

## 6. Owner steps left

None. No PR opened, no merge, no push to `main` or `phase/0`.
