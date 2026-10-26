# 0330 report: VAT due dates and vatObligationsFor

Status: review

## Files changed

- packages/domain/src/vat/period.ts (new): CzRules, monthAfter, periodEndOf, vatDueDate
- packages/domain/src/vat/obligations.ts (new): VAT types, VAT_OBLIGATION_SOURCE, vatObligationsFor
- packages/domain/test/vat-obligations.test.ts (new): brief test file, verbatim (Biome format only)
- packages/domain/src/index.ts (edit): two export lines appended

## Commands (last lines)

- `pnpm --filter @shoebox/domain exec vitest run test/vat-obligations.test.ts`: 1 file passed, 8 tests passed
- `pnpm --filter @shoebox/domain typecheck`: clean, no errors
- `pnpm exec biome check --write <changed paths>`: clean after fixing 3 useOptionalChain warnings

## Acceptance (§7)

- [x] All four date cases and four obligation cases green; typecheck clean.
- [ ] `[verify]` SH always monthly for payers (M05 §4.1): NOT checked. M05 was not in the brief's named files, so I did not open it. Owner or orchestrator to verify.
- [x] Late-filing penalty text left out (TODO(TA-10)): nothing written for it.

## Deviations

- PAYMENT_WINDOW_DAYS = 30 is a code constant in obligations.ts, not a rules key. The brief gives "due_date + 30 d" as a literal. Move it to packages/domain/rules if the owner wants it treated as a rule.
- vat_payment is generated for both IO and payers when a DPHDP3 is generated, downloaded or marked_filed and ř.64 > 0. The brief's text does not say whether IO is excluded. The test file has no IO payment case, so it does not decide this.
- sh drafts follow the input shMonths for any status. The brief's "payer or IO with SH entries" is covered because shMonths is empty when there are no SH entries.
- The optional-chain lint fix changed `x !== null && x.isPositive()` to `x?.isPositive()`. Same result.

## Questions

- Is the 30-day payment window a rule (see Deviations)?
- Should vat_payment apply to IO periods (see Deviations)?

## Owner steps left

None. Wiring into M09 obligations.generate is P1-DASH-02 (another lane).
