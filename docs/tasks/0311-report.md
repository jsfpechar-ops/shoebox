# 0311 report

Status: review
Branch: wt-0311 (not pushed, no PR, per owner instruction)

## Files changed (`git diff --stat 1cf6ce6..HEAD`)

- `packages/domain/src/vat/ledger.ts`: new, 356 lines (`buildVatLedgerEntries` and types)
- `packages/domain/test/vat-ledger.test.ts`: new, brief verbatim, then biome formatting only
- `packages/domain/src/index.ts`: +1 export line

## Commands (last lines)

- `pnpm --filter @shoebox/domain test -- vat-ledger`: `Test Files 23 passed (23)`, `Tests 528 passed (528)`. The filter ran the whole domain suite; the vat-ledger file is among the 23 files. Before step 2 it failed with `Cannot find module '../src/vat/ledger'`, as the brief expects.
- `pnpm --filter @shoebox/domain typecheck`: clean (no errors).
- `pnpm exec biome check packages/domain`: `Checked 60 files in 6s. No fixes applied.`

## Commits

`a832459 0311 step 1`, `d42e6fe 0311 step 2`, `700f233 0311 step 3`, `426a9d6 0311 step 3 (biome format and sort)`, then `0311 report`.

## §7 acceptance

- [x] Test file green. It is unchanged apart from biome formatting.
- [x] Commits `0311 step 1..3` made; no push.

## Deviations

1. Step 4a: a group where `deriveVatPointDate` returns null is now skipped silently. `S_DATE_MISSING` fires only when the document has no duzp and no issue date. Reason: the mixed-treatment test expects no issue for `rcv_foreign_vat_charged`, which has no VAT point class in `point-date.ts`.
2. `vatSum` skips zero VAT amounts. The test fixtures default `vat` to CZK 0 on USD/EUR documents, and `Money.sum` rejects the currency mismatch.
3. `SELF_ASSESSED_TREATMENTS` is module-private in `ledger.ts`. Exporting it clashes with `vat/treatment.ts` through `index.ts` (TS2308).
4. Biome moved the new export line above `./vat/point-date` in `index.ts` (sort only).
5. Biome reformatted the test file (formatting only, no assertion changed).

## Questions for the reviewer

- Is deviation 1 the intended reading? The brief's step 4a says `null` gives `S_DATE_MISSING`, but the test contradicts that for treatments with no VAT point class.
- The §8 stop check passed: the manager invoice resolves to `max_duzp_received`.

## Assumed, not checked

- M05 §4.2 step 9: IO § 9(1) supplies get no DPHDP3 row. Assumed, not checked.

## Owner steps left

None.
