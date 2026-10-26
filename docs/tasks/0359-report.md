# 0359 report: buildPodkladySummary + podklady copy

Status: review

## Files changed

- `packages/domain/src/income-tax/summary.ts` (new): `PodkladyInput`, `PodkladySummary`, `CHECKLIST_KEYS`, `buildPodkladySummary`, plus helper types.
- `packages/domain/test/podklady-summary.test.ts` (new): brief test, 8 cases.
- `packages/domain/src/index.ts`: one export line added.
- `packages/i18n/messages/en.json`: 80 keys appended from brief step 3. `cs.json` untouched.

## Checks

- `pnpm --filter @shoebox/domain exec vitest run test/podklady-summary.test.ts 2>&1 | tail -30`: 8 passed.
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`: clean.
- `pnpm --filter @shoebox/i18n exec vitest run 2>&1 | tail -5`: 3 files, 24 tests passed.
- `pnpm exec biome check --write <changed paths>`: clean.
- `pnpm depcruise 2>&1 | tail -3`: no violations.
- Acceptance: S2 headline 1400000.00 / 520000.00 / 880000.00; S3 flat 1200000.00 / 2300000.00; S1 paid 109944.00 with `pd.no_return`. All brief keys present in en.json.

## Deviations

1. Test helper `e()`: biome rejects `(n += 1)` inside a template literal (`noAssignInExpressions`). Rewrote the helper body as a block that increments `n` first. Values and ids are unchanged.
2. i18n keys `podklady.readiness.P_*` lowercased to `podklady.readiness.p_*`. The catalog test requires lowercase key segments. Whoever maps a readiness code to a key must lowercase the code.
3. Brief §4 step 3 says "alphabetical block", but the keys are appended in the brief's listed order.
4. Logic the brief does not specify, chosen as follows:
   - Year with no profile segment: regime falls back to `danova_evidence`.
   - `ucetnictvi`: `flatRate` null, headline uses the actual basis.
   - `advancesPaid` adds `tax_pausal_advance` only for `pausalni_dan`.
   - `depreciation` and `car` checklist keys only for `danova_evidence`.

## Questions

- Confirm deviation 4 (the fallback, the `ucetnictvi` headline, and the `advancesPaid` scope).
- The `TODO(i18n-cs)` for the M06 Czech copy contradiction (brief §1) was not added because no step names a file for it. Say where it should go.

## Owner steps left

- Decisions line from brief "Owner steps": "2026-10-26 podklady copy in English (rule 6), Czech in `later/` when cs.json wakes; checklist wording per M06 §4.9".
- Open the PR from `wt-0359` into `phase/0` (not pushed by the executor).
