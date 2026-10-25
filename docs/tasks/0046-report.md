# 0046 report: upload API

Status: review
Branch: task/0046-upload-api

## Files changed

- packages/pipeline/src/jobs.ts, packages/pipeline/test/jobs.test.ts (steps 1, 2)
- apps/worker/src/registry.ts (step 2)
- apps/web/package.json, pnpm-lock.yaml (step 3)
- apps/web/test/upload.test.ts (step 4, brief verbatim)
- apps/web/src/documents/upload.ts (step 4)
- apps/web/src/documents/enqueue.ts (step 5, new)
- apps/web/src/documents/supabase-deps.ts (step 6, new)
- apps/web/app/api/documents/route.ts (step 7, new)
- docs/tasks/0046-report.md, docs/tasks/0046-upload-api.md (status)

## Commands (last lines)

- `pnpm --filter @shoebox/web exec vitest run test/upload.test.ts`: Test Files 1 passed (1), Tests 5 passed (5)
- `pnpm --filter @shoebox/pipeline test -- jobs`: Test Files 2 passed (2), Tests 16 passed (16)
- `pnpm --filter @shoebox/worker test -- registry.test`: Test Files 3 passed | 2 skipped (5), Tests 20 passed | 7 skipped (27). The skipped files are registry.db.test.ts (DB-backed, needs a live database).
- `pnpm --filter @shoebox/web typecheck`: FAILS with one error, `../../packages/platform/src/blob-store/supabase-blob-store.ts(86,9): TS2322 Uint8Array not assignable to BodyInit`. That file is from 0037 and 0046 does not touch it. No error in the new files.
- `pnpm exec biome ci apps/web packages/pipeline apps/worker`: 7 errors, all format or organizeImports. Files: apps/web/app/api/documents/route.ts, apps/web/src/documents/enqueue.ts, apps/web/src/documents/upload.ts, apps/web/test/upload.test.ts, packages/pipeline/test/jobs.test.ts.
- `grep -rn 'console\.' apps/web/src/documents apps/web/app/api/documents`: no match.

## Section 7 checklist

- [x] Upload test unchanged and passing; pipeline and worker unit tests pass.
- [x] No console calls in the new paths.
- [ ] Typecheck and biome clean: NOT met (see Questions).

## Deviations

- Steps 5 to 7 are exactly as the brief gives them. I did not reformat them, because biome would change given content.
- Step 6 `today`: the domain package has no system clock export, so I used the brief's Intl fallback (Europe/Prague).
- Step 6: the DB helpers throw on errors the brief did not name (`storage`, `source_files`, `documents`).

Done: steps 1 to 7.

## Questions

1. The typecheck failure in packages/platform (0037 code) blocks the web typecheck. Fix it in a separate ticket, or allow a change here?
2. Biome formatting in upload.ts and in both brief-written test files. Allow `biome --write` on those (it changes brief content, and a test file is not to be changed by the executor), or accept the failure?

## Owner steps left

None now. When the web is deployed, it needs DATABASE_URL, as the health check already does.
