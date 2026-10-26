# 0412 report

Status: blocked

Files changed: `packages/db/migrations/0052_purge_trash.sql` (new), `packages/db/migrations/meta/_journal.json`, `packages/db/src/trash-purge.ts` (new), `packages/db/src/index.ts`, `packages/db/test/trash-purge.db.test.ts` (new), `packages/pipeline/src/jobs.ts`, `apps/worker/src/retention/trash-purge.ts` (new), `apps/worker/test/trash-purge.test.ts` (new), `apps/worker/src/worker.ts`, `apps/worker/src/main.ts`, `packages/i18n/messages/en.json`, `docs/context/known-issues.md` (K-D01 row removed).

Steps 1 to 7 committed (`0412 step 1` to `0412 step 7`).

Passing: `drizzle-kit check`; db trash-purge test (the `-- trash-purge` filter ran the whole db suite: 21 files, 140 tests); worker trash-purge test (3); pipeline (16); i18n (24); web typecheck; biome clean on the touched packages; context lint OK.

Failing, not caused by this brief: worker and db typecheck, and 6 worker test files (doc-extract and doc-split), fail with "Cannot find module 'pdf-lib'" from `packages/extraction/src/pdf/pages.ts`. The package is not installed in this container.

Deviations: biome's organizeImports moved the `purgeTrash` export in `packages/db/src/index.ts` to the end of the file, not after the rate-limit line. Biome `--write` also reformatted my new files.

Owner steps left: run `pnpm install` so `pdf-lib` resolves. Then rerun `pnpm --filter @shoebox/worker typecheck`, `pnpm --filter @shoebox/db typecheck` and `pnpm --filter @shoebox/worker test`. Set `Status: review` once green.
