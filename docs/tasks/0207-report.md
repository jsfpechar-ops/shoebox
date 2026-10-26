# 0207 report

Status: review

Done: steps 1 to 4 (apply.ts, test file, wiring, two handler tests). Biome formatting applied to apply.ts and the new test file.

Files changed: `packages/extraction/src/exact/apply.ts` (new), `packages/extraction/test/exact-apply.test.ts` (new), `packages/extraction/src/index.ts`, `packages/db/src/document-reading.ts`, `apps/worker/src/doc-extract/rows.ts`, `apps/worker/src/doc-extract/handler.ts`, `apps/worker/test/doc-extract-handler.test.ts`.

Deviations: none in behaviour. The brief's `handler.ts` excerpts (`const checks = ...`, `fields: fieldsOf(...)`) were replaced in place. Worker `doc-extract` run shows 2 skipped files (DB-backed `*.db.test.ts`, no database in this session); not in scope of §6.

Questions: none.

Owner steps left: none for this brief.
