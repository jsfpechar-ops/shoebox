# 0360 report: Podklady XLSX workbook

Status: review

## Files changed
- `packages/exports/src/podklady-xlsx.ts` (new): `PODKLADY_SHEETS`, `PodkladyXlsxOptions`, `podkladySheets`, `buildPodkladyXlsx`
- `packages/exports/test/podklady-xlsx.test.ts` (new, verbatim from brief §4.2)
- `packages/exports/src/index.ts` (export line added)

## Commands
- `pnpm --filter @shoebox/exports exec vitest run test/podklady-xlsx.test.ts`: 7 passed, 0 failed, 0 skipped
- `pnpm --filter @shoebox/exports typecheck`: clean
- `pnpm exec biome check` on the two src files: clean after `--write` (import order, index.ts export line moved by organizeImports)
- `pnpm exec biome check` on the test file: 2 findings in the verbatim test (`noAssignInExpressions` at line 10, formatter diff). Not changed, per the test-file rule.

## Acceptance (brief §7)
- Totals: Income 240 000,00; Expenses 98 459,81; Tourist fee 7 650,00; private 249,00. Pass.
- 11 sheets for a non-flat-rate regime, ZIP sanity. Pass.

## Deviations
1. `Sheet` is `XlsxSheet` in `xlsx.ts`; imported as `XlsxSheet as Sheet`. `xlsx.ts` not touched.
2. Summary "Expenses" (actual regime) = `totals.deductibleTotal` (98 459,81), not `headline.expenses`, which the domain rounds to whole CZK (98 460,00). The test pins 98 459,81. `Base before adjustments` stays `headline.base` (141 540,00), which the test also pins. Flat regime still uses `headline.expenses`. Note: the Summary rows therefore do not subtract to the base exactly (240 000 - 98 459,81 = 141 540,19). Owner to confirm the rounding rule.
3. "Personal documents" count is a numeric cell (`{num: '1'}`) to match the test.
4. Missing sheet, asset warnings: text is `label(w.code)`. The brief gives no key for these.
5. Flat-rate tax "Band" comes from the last segment's `pausalDanBand`. The brief gives no source.
6. Car column in Assets shows `yes`/`no`.

## Questions
- Decision on deviation 2 (rounding of Expenses vs base).

## Owner steps left
- Decisions line from brief Owner steps (XLSX sheet names in English until cs.json wakes).
- Merge is the owner's; no push or PR made from this session.
