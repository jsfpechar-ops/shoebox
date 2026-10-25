# 0079 report

Status: review

## Files changed
- packages/platform/src/logger/allowlist.ts: added `'httpStatus'` after `'errorCode'`
- packages/platform/test/logger.test.ts: added `'httpStatus'` to the exact-list test
- docs/v3/modules/M12-platform-ops-security.md: line 293 `errorCode?` → `errorCode?, httpStatus?`
- docs/tasks/0079-allow-http-status-log.md: Status todo → review
- docs/tasks/0079-report.md: this report

## Commands (last lines)
- `pnpm --filter @shoebox/platform test -- test/logger.test.ts`: Test Files 4 passed (4), Tests 38 passed (38)
- `pnpm --filter @shoebox/platform typecheck`: clean (tsc, no errors)
- `pnpm --filter @shoebox/worker test -- test/registry.test.ts`: Test Files 6 passed | 2 skipped (8), Tests 43 passed | 7 skipped (50). Skips are not from this change; not investigated.
- `python3 scripts/context_lint.py`: context lint: OK

## Acceptance (§7)
- [x] Tests pass, typecheck clean, lint OK; only §3 files, the brief and its report changed.

## Deviations
- No commit, no push (owner instruction for this run; executor.md step 6 would commit).
- No PR opened.

## Notes
- Lint warning: apps/worker/src/registry.ts is named by open briefs 0035 and 0078; order not decided.
