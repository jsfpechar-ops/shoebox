# 0073 report: Přehled data loader and view model

## 1. Files changed (`git diff --stat`)

```
 apps/web/src/overview/load.ts       |  88 +++++++++++++++++++++++
 apps/web/src/overview/rows.ts       | 132 ++++++++++++++++++++++++++++++++++
 apps/web/src/overview/view.ts       |  50 +++++++++++++
 apps/web/test/overview-view.test.ts | 137 ++++++++++++++++++++++++++++++++++++
 packages/domain/src/index.ts        |   3 +
 5 files changed, 410 insertions(+)
```

The brief file `docs/tasks/0073-overview-data.md` only had its Status line changed (todo to review).

## 2. Commands (last 5 lines each)

- `pnpm --filter @shoebox/domain typecheck` : tsc, no errors (no output after the header).
- `pnpm --filter @shoebox/web test -- overview-view` : did not narrow; ran all 12 files, 104 passed.
- `pnpm --filter @shoebox/web exec vitest run test/overview-view.test.ts` : `Test Files 1 passed (1)`, `Tests 8 passed (8)`.
- `pnpm --filter @shoebox/web typecheck` : tsc, no errors.
- `pnpm exec biome check apps/web/src/overview apps/web/test/overview-view.test.ts packages/domain/src/index.ts` : first run had import-order and format findings in `rows.ts` and `load.ts`; `biome check --write` on those paths fixed them; rerun: `Checked 5 files in 264ms. No fixes applied.`
- `python3 scripts/context_lint.py` : `context lint: OK` (warnings are about other open briefs and existing paths, not this change).

## 3. Acceptance (§7)

- [x] The test file is the brief's §4 step 2 content and passes (8 tests). Biome did not touch it.
- [x] Every query in `load.ts` uses `.eq('org_id', orgId)` (`taxpayer_profiles`, `documents`) or `.eq('id', orgId)` (`organizations`). Documents numeric columns are `::text` in `DOCUMENTS_SELECT`.
- [x] Typecheck (web, domain) and biome clean.

## 4. Deviations

- `load.ts` runs the three queries in one `try`; if any throw, the whole result is reset to no data (profile null, no documents). A failed `error` on one query only drops that part.
- Biome's safe fix reordered imports in `rows.ts` and `load.ts` and rewrapped one line. No logic change.

## 5. Unsure

- `PROFILE_SELECT` does not cast `pausal_rate` or `pausal_dan_band`. The brief says they are plain integers (80/60/40/30 and 1/2/3). I did not check the column type in 05 (not in the brief's file list). If either column is `numeric`, PostgREST returns it as JSON and the `z.literal` check will fail closed for every row, so the pausal profile would be dropped. Worth one look at 05 before 0074.
- `insurance_reminders` is read from `organizations.settings` through a cast to an object type, not a schema. Missing or failed settings default to `true`, as the brief says.

## 6. Owner steps left

None for this brief. Brief 0074 consumes `loadOverview(orgId, asOf)` and `OverviewView`.
