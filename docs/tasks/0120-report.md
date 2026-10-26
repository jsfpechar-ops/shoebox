# 0120 report

Status: review

## Files changed
New: `packages/bank/src/radar.ts`, `packages/bank/test/radar.test.ts`, `packages/db/src/radar-store.ts`, `apps/worker/src/bank-radar/{handler,register}.ts`, `apps/worker/test/bank-radar.test.ts`.
Edited: bank/db `index.ts`, `packages/pipeline/src/jobs.ts` (+ `test/jobs.test.ts`), `apps/worker/src/main.ts`, web `enqueue.ts`, `review-actions.ts`, `review-card.tsx`, `packages/i18n/messages/en.json`.

## Commands
- bank radar.test: 7 passed. worker bank-radar.test: 9 passed. pipeline jobs.test: 25 passed.
- web vitest: 53 files, 340 tests passed. i18n test: 24 passed. web build: succeeds.
- Typecheck bank, db, pipeline, worker, web: clean. Biome: 0 errors (1 pre-existing warning in an untouched file).

## Acceptance
- [x] All commands pass. [x] Second run is a no-op (tested). [x] App sends nothing; `mailto:` only.

## Deviations
- Extra system job `bank.radar.nightly` (cron 03:20) fans out `bank.radar.refresh` per org (the repo's nightly pattern is system-scope).
- Match handlers have no enqueue dep, so no run after `bank.match.*`; daily run + web trigger only.
- `private` answer sets category `private_expense` (the seeded code; `private` is not a category code). Null if missing.
- An auto-resolved question does not block a new one if the transaction becomes a candidate again.
- Refresh job entityId is constant (`refresh`), as `podklady.reserve.refresh` does; a completed job row with the same id could suppress a later enqueue until pg-boss cleans it. Owner may want to verify.
- Copy button decodes the request text from the `mailto` body (payload params stay as the brief says).
- DB store SQL is not run locally (no Postgres); only the fake-store tests ran.

## Questions
None. Owner steps: none.
