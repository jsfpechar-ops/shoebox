# 0079: The logger keeps `httpStatus`

Status: review
Ticket: Phase 1 test environment (owner request 2026-10-25) | Depends on: 0078 | Base commit: see branch | Branch: claude/project-thread-2s0mp2 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

0078 adds `httpStatus` to the `job failed` log line, but the logger's allowlist (M12 §4.7) drops every key not on its list, so the status never reaches the log. Add `httpStatus` (a number, no document content) to the allowlist, its test and the M12 field list.

## 2. Context

- `packages/platform/src/logger/allowlist.ts`: `LOG_FIELD_ALLOWLIST` ends with `  'durationMs',\n  'errorCode',\n] as const;`
- `packages/platform/test/logger.test.ts`, test `'keeps exactly the M12 §4.7 field list'` ends its array with `      'durationMs',\n      'errorCode',\n    ]);`
- `docs/v3/modules/M12-platform-ops-security.md` line 293 contains `durationMs?, errorCode?\``.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/platform/src/logger/allowlist.ts` | edit | add `'httpStatus'` after `'errorCode'` |
| `packages/platform/test/logger.test.ts` | edit | add `'httpStatus'` after `'errorCode'` in the exact-list test |
| `docs/v3/modules/M12-platform-ops-security.md` | edit | `durationMs?, errorCode?` → `durationMs?, errorCode?, httpStatus?` (only on line 293) |

No other file may change.

## 4. Steps

1. Make the three edits in §3.
2. `pnpm --filter @shoebox/platform test -- test/logger.test.ts 2>&1 | tail -30` (all pass), `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30` (clean), `pnpm --filter @shoebox/worker test -- test/registry.test.ts 2>&1 | tail -30` (all pass), `python3 scripts/context_lint.py 2>&1 | tail -30` (OK).

## 5. Do not touch

Everything else. Hard rules 4, 8.

## 6. Commands

As in §4.

## 7. Acceptance

- [ ] Tests pass, typecheck clean, lint OK; only §3 files plus this brief and its report changed.

## 8. Stop and ask

An excerpt not found, a test failing twice, 20 tool calls.

## 9. Report

Write `docs/tasks/0079-report.md` (300 tokens at most), set `Status: review`.
