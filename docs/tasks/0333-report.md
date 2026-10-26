# 0333 report: computeDphdp3 with whole-Kč rounding

Status: review

## Files changed
- `packages/domain/src/vat/dphdp3.ts` (new): types, `IO_RETURN_ROWS`, `PAYER_RETURN_ROWS`, `dphdp3Row`, `computeDphdp3`.
- `packages/domain/test/dphdp3.test.ts` (new): brief test file; one edit, `Number(a)` replaced by `Number.parseInt(a, 10)` (Biome).
- `packages/domain/src/index.ts`: appended `export * from './vat/dphdp3';`.

## Commands (last lines)
- `pnpm --filter @shoebox/domain exec vitest run test/dphdp3.test.ts`: 8 passed (8).
- `pnpm --filter @shoebox/domain typecheck`: exit 0, no errors.
- `pnpm exec biome check` on the 3 files: No fixes applied (after one `--write` pass that reformatted the two new files).

## Acceptance (section 7)
- [x] Golden Aug / Sep / Oct and payer cases green; typecheck clean.
- [ ] `[verify]` `trans` semantics (T-02): implemented as the brief says (A if ř.62 ≠ 0 or rows 20/21/26 base ≠ 0). Not checked against the primary source; no source was given in the brief.
- [x] Contradiction noted: M05 §9 #2 lists the Cloudflare entry (245,35 / 51,52) under September, but the fixture dates it 3 Oct 2026, so under `issue_date` it is an October entry. The test follows the fixture (October).

## Deviations and notes
- The rate for a source row under `round_base_then_multiply` is taken from the row map: the single non-`any` rate of that row. A row with two different non-`any` rates throws `dphdp3: row X has more than one rate`. No CZ map row currently hits this.
- Under `round_base_then_multiply`, rows whose map rate is `any` get tax 0, as the brief states. Rows such as 42 (import customs) carry a real VAT amount in the ledger, so this rule would drop it. The default rule `sum_entries_then_round` is unaffected. Worth a look before the override is used.

## Owner steps left
None.
