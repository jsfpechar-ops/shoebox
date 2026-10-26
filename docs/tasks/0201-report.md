# 0201 report: QR payment and invoice payload parser

Status: review

## Files changed

- `packages/extraction/src/qr/payload.ts` (new): `parseQrPayload` with the exported types from §4 step 1.
- `packages/extraction/test/qr-payload.test.ts` (new): brief §4 step 2 test, extracted verbatim, then reformatted by `biome format --write` (line wrapping only).
- `packages/extraction/src/index.ts`: one line, `export * from './qr/payload';`, placed after `proto/schema` so biome's import/export sort passes.
- `docs/tasks/0201-qr-payload-parser.md` (brief copied into this worktree, Status set to review).
- `docs/tasks/0201-report.md` (this file).

## Commands (last lines)

- `pnpm install --frozen-lockfile`: `Done in 2.8s using pnpm v10.28.0`
- `pnpm --filter @shoebox/extraction test -- qr-payload`: `Tests 43 passed (43)` (vitest ran all six extraction test files; the qr file is among them)
- `pnpm --filter @shoebox/extraction exec vitest run test/qr-payload.test.ts`: `Tests 12 passed (12)`
- `pnpm --filter @shoebox/extraction typecheck`: `tsc -p tsconfig.json` with no errors
- `pnpm exec biome check packages/extraction`: `Checked 16 files in 1034ms. No fixes applied.` (clean)

## Checks

- CRC32 rule verified against the brief's test vector `DF2F8539`: header first, then attributes sorted, joined with `*`.

## Deviations

- The brief was not in this worktree. It exists only in commit `8d32ab4` on branch `claude/project-thread-90sd7q`. I copied it from that commit into `docs/tasks/`. The worktree branch base is `1e90c0d`, not the brief's `496b1e9`.
- The brief's `Branch` and `PR base` (`task/0201-qr-parser`, `phase/0`) were not used. Per the instruction, the commit is on the current branch, and nothing was pushed and no PR was opened.
- `biome format --write` reformatted the test file's line wrapping, as the brief allows when only formatting fails. No assertions changed.

## Questions

- None blocking. Empty text values (e.g. `MSG:`) become `null`, and DIČ/IBAN are only normalized (uppercase, no spaces), not validated. The brief does not specify either.

## Owner steps left

- Review the branch and open the PR into `phase/0` (or the target the owner names). Nothing was pushed.
