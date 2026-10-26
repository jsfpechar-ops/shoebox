# 0416 report

Status: review

Files: `apps/web/src/documents/export-formats.ts`, `apps/web/test/export-formats.test.ts`, `apps/web/app/api/export/route.ts`, `docs/context/known-issues.md`.

- Tests: web suite 43 files / 269 tests pass (the filter ran everything). Typecheck 0. Biome clean. Context lint OK.
- No `Number`/`parseFloat` on money; a JSON-number numeric column is formatted with `toFixed(2)`.
- Columns: all used columns exist in 05 §4. `received_date`, `vat_point_date`, `summary_cs` are read. Partner address is read from `partner_snapshot.address.{street,city,zip}` (shape not specified in 05; missing gives null).
- Pohoda file is skipped when the org has no IČO.

Deviations: none. Questions: none.
