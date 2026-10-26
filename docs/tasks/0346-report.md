# 0346 report

Status: blocked

Reason: the worker step (brief §3 `apps/worker/src/vat/imported.ts`, §4 step 3) needs DB reads and writes. The brief puts the DB implementation in that file, but `apps/worker` does not depend on `drizzle-orm`, and `and/eq/sql` are needed for `document_fields` and `document_links` queries. Options for the owner or orchestrator:
(a) allow a new helper in `packages/db` (not named in §3) that the worker imports, or
(b) approve `drizzle-orm` as a worker dependency (rule 7).
Nothing for the worker step was written.

## Done (domain steps 1–2)

- `packages/domain/src/vat/imported.ts` (new): `parseImportedFilingFields`, `compareWithImported`, `importedTotals`, types. Filed whole-Kč values are compared as exact strings (`toFixed2`), not floats. Rows 62–65 compare as tax with base 0.
- `packages/domain/test/imported-filing.test.ts` (new, brief text; the one `!` replaced with a `must()` guard).
- `packages/domain/src/index.ts`: one `export * from './vat/imported';` line.

Commit: see git log on wt-0346 (`0346 step 1-2`).

## Checks

- `pnpm --filter @shoebox/domain exec vitest run test/imported-filing.test.ts`: 2 passed. Last line: `Tests  2 passed (2)`.
- `pnpm --filter @shoebox/domain typecheck`: clean.
- `pnpm exec biome check --write <3 files>`: no fixes left.
- `pnpm depcruise`: no dependency violations found.

## Deviations

- `document_fields` columns are `field_key`, `value_text`, `value_json`, `is_current` (brief said `key`). The `documents` class column is `class`. Used the real names when the worker step is written.
- `apps/worker` has no `drizzle-orm` dependency (see Reason).
- §7 acceptance not ticked: the worker tests (second run, foreign DIČ) do not exist yet.

## Questions

- Pick option (a) or (b) above.
- Confirm link direction for `reported_in`: from = ledger document, to = `government_filing` document (matches 04 §5 wording "document → government filing").

## Owner steps left

None.
