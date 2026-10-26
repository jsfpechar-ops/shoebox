# 0211 report

Status: review

## Files
- packages/pipeline/package.json (+3 deps), pnpm-lock.yaml
- packages/pipeline/src/import/{sheet,mapping,row,index}.ts (new)
- packages/pipeline/test/import.test.ts (new, brief verbatim; BOM as ﻿ escape)
- packages/pipeline/src/index.ts (+1 export)

## Command results
- pipeline test: 3 files, 32 tests passed.
- pipeline typecheck: clean.
- pnpm depcruise: no violations (after moving parseDateText to sheet.ts).
- biome check --write packages/pipeline: formatting only.

## 7. Acceptance
- [x] 6 passes.

## Deviations
- parseDateText lives in sheet.ts (leaf module) to avoid a mapping.ts <-> row.ts cycle.
- exceljs load needs a Buffer cast to the parameter type (typecheck).
- Amounts with more than 2 decimals -> bad_amount (no silent rounding).
- Invalid due_date -> bad_date (row skipped). Unknown paid text -> paid null.
- Value sniff uses no Excel serials.

## Questions
- Confirm the three choices above (amount decimals, due_date, paid unknown).

## Owner steps left
- None for this brief.
