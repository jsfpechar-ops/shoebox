# 0357 report

Status: review

## Files changed
- packages/domain/src/income-tax/assets.ts (new): listAssets
- packages/domain/src/income-tax/private-use.ts (new): summarizePrivateUse
- packages/domain/src/income-tax/vat-note.ts (new): buildVatNote
- packages/domain/test/podklady-lists.test.ts (new): brief test, unchanged content
- packages/domain/src/index.ts (edit): three income-tax exports

## Checks
- vitest podklady-lists: 8 passed (before and after Biome formatting)
- typecheck @shoebox/domain: exit 0
- biome check on changed paths: no fixes needed
- pnpm depcruise: no dependency violations

## Deviations
- Value imports (CZK, Money, round2) instead of type-only imports: the implementations need them.
- VatStatus imported from ../enums/index in vat-note.ts: the brief used it without an import.
- Year filter applied before the lineId dedupe (first in-year occurrence wins).
- Biome sorted the three index.ts export lines alphabetically (after ./fx), not after ./ledgers/tax.
- Tests ran via `pnpm --filter @shoebox/domain exec vitest run` (same file, same result as the brief's test filter).

## TA-06 [verify] (IO VAT as income-tax expense)
Still open. Source checked: GFR Pokyn D-6 and ZDP § 24(2)(ch) a) (via search, full text not retrieved). It lists VAT as an other-tax expense only where it relates to tax expenses. The result does not settle the identified-person case. Owner or reviewer should confirm against the full statute text. No totals depend on it.

## Questions
None.

## Owner steps left
None.
