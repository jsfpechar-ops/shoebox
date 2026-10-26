# 0329 report: EPO filing header

Status: review

## Files changed (git diff --stat)
- `packages/domain/src/vat/header.ts` (new): EpoHeader types, dicDigits, normalizeNace6, missingVetaP, buildEpoHeader, formaCode.
- `packages/domain/test/epo-header.test.ts` (new): brief test, only Biome formatting applied.
- `packages/domain/src/index.ts`: added `export * from './vat/header';` after the treatment line.

## Commands (last lines)
- `pnpm --filter @shoebox/domain test -- epo-header`: ran all 26 domain test files, 550 passed. The `-- epo-header` filter does not narrow the run in this vitest setup.
- `pnpm exec vitest run test/epo-header.test.ts`: 8 passed (8).
- `pnpm --filter @shoebox/domain typecheck`: tsc, no errors.
- `pnpm exec biome check --write` on the 3 files: no fixes left, clean.

## Section 7
- [x] Test green, typecheck clean, only §3 files changed.
- [ ] `[verify]` items, not checked against a primary source in this run (no research lookup was in the brief's steps):
  - `c_ufo`/`c_pracufo` vs `fu_code`/`ufo_code` (T-02): implemented as fuCode (3 digits) and ufoCode (4 digits), per the brief.
  - NACE padding: implemented as right-pad with `0` to 6 digits, per the brief and its TODO(T-02).
  - Whether `c_okec` is required for an IO: not checked. The header always sets `naceCode6` when the profile has a NACE code, and omits it otherwise.

## Deviations
- `Number(...)` replaced with `Number.parseInt(..., 10)` for the year and month, because the repo's `no-number-money` Biome rule forbids `Number()`.
- Biome `--write` reformatted `header.ts` and the test file. No change to logic or to the test assertions.
- No PR opened and nothing pushed, per the executor rules.

## Questions
- None.

## Owner steps left
1. Lane D follow-up ticket: "VetaP sheet before first filing" (per the brief's Owner steps). `apps/web/e2e/profile-vetap.spec.ts` belongs to it.
