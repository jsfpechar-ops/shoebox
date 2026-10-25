# 0008 report: structured logger with allowlist serializer

Status: review. Branch task/0008-logger, base origin/phase/0 (61fba2d). Steps 1 to 9 done; commits `0008 step 2` to `0008 step 7`, then step 9.

## 1. Files changed (`git diff --stat origin/phase/0`)

```
packages/platform/package.json            |   3 +
packages/platform/src/index.ts            |   1 +
packages/platform/src/logger/allowlist.ts|  42 ++++++++
packages/platform/src/logger/index.ts    |  17 ++++
packages/platform/src/logger/logger.ts  |  87 ++++++++++++++++
packages/platform/test/logger.test.ts   | 158 ++++++++++++++++++++++++++
pnpm-lock.yaml                           |  93 ++++++++++++++++++
7 files changed, 401 insertions(+)
```

## 2. Commands (last lines of output)

- `pnpm --filter @shoebox/platform add pino@10.4.0 --save-exact`: `Done in 2.3s using pnpm v10.28.0`. Then `node -e ...dependencies.pino` printed `10.4.0`.
- `pnpm --filter @shoebox/platform typecheck` (after steps 3, 4, 5, 7, 8): `tsc -p tsconfig.json`, no errors, exit 0.
- `pnpm --filter @shoebox/platform test -- smoke`: `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- `pnpm --filter @shoebox/platform test -- logger`: `Test Files 2 passed (2)`, `Tests 11 passed (11)`, `Duration 247ms`. All 10 logger tests pass; see Deviations.
- `pnpm lint`: `Checked 91 files in 32ms. No fixes applied.`, `Found 4 warnings.`, `Found 1 info.`, exit 0. The warnings concern `biome.json` ignore patterns and are not in the changed files.

## 3. §7 acceptance

- [x] logger test: partnerName, text, iban, amount are dropped; mandatory fields present. 10 logger tests pass.
- [x] `@shoebox/platform` exports `logger`, `createLogger`, `withContext`, `pickAllowed`, `LOG_FIELD_ALLOWLIST` (via `src/index.ts` line `export * from './logger/index';`).
- [x] Folder deviation (`src/logger/`) as the brief states.
- [x] Not in this ticket: Sentry `beforeSend` (P0-PLAT-02) and `APP_ENV`/`RELEASE` wiring (deploy ticket).

## 4. Deviations

- The test count is 11, not 10. The `-- logger` filter also ran `test/smoke.test.ts` (verified with `vitest --reporter verbose`). The 10 logger tests all pass.
- No other deviations. Step 1 `git status` was clean. The `pnpm add` step was not refused.

## 5. Questions

None.

## 6. Owner steps left

- Later deploy ticket: set `APP_ENV` and `RELEASE` on the Cloud Run services (the brief says this is out of scope here).
- Open the PR from `task/0008-logger` into `phase/0`. The executor did not open it.
