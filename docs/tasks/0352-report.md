# 0352 report

Status: review

## Files changed
- packages/domain/src/rules/cz/2025.ts (+12): income_tax.rates, income_tax.credits, insurance.rates
- packages/domain/src/rules/cz/2026.ts (+12): same keys, 2026 values
- packages/domain/test/rules-values.test.ts: keys added to SEEDED_KEYS, new describe block, entry counts bumped (see Deviations)

## Checks
- `pnpm --filter @shoebox/domain test -- rules`: 35 files, 633 tests passed
- `pnpm --filter @shoebox/domain exec vitest run test/rules-values.test.ts`: 32 passed
- `pnpm --filter @shoebox/domain typecheck`: clean
- `pnpm exec biome check` on the 3 files: clean (one auto-format pass applied)
- `pnpm depcruise`: no dependency violations

## Verify results (primary source = zakonyprolidi.cz, current consolidated text)
- ZDP § 16 odst. 1 (15 % / 23 %, 36 x average wage): wording confirmed. Threshold amounts: 2025 1 676 052 NOT checked against the nařízení vlády (no source fetched). 2026 1 762 812 [verify-failed]: business/finance sites cite 48 967 Kč (matches), rulecalc.com cites 47 544 Kč under nař. vl. č. 365/2025 Sb. (limit 1 711 584). Seeded the brief's number; owner must check the Sbírka zákonů.
- ZDP § 35ba odst. 1 písm. a): 30 840 Kč confirmed on the current version. 2025 value not checked separately.
- Social 29,2 %: confirmed, but in § 7 odst. 1 písm. e) bod 1, not písm. c) as the brief says. Base 55 % from 2024: confirmed in § 5b odst. 1 (text version of page dated 2026; 2025 not separately checked).
- Health 13,5 % (§ 2 odst. 1) and base 50 % (§ 3a odst. 1, not odst. 2): confirmed on the 2026 text version. 2025 not separately confirmed.

## Deviations
- Entry counts in rules-values.test.ts bumped: RULES_CZ_2025 28 -> 31, RULES_CZ_2026 29 -> 32, entries starting 2026-01-01 28 -> 31 (3 new keys per year).
- Only one source URL fits in `base()`. insurance.rates uses the social act (`…1992-589#p5b`); the health act is cited in the comment.
- Citation fixes vs brief: § 7 odst. 1 písm. e) bod 1 (not c)); § 3a odst. 1 (not odst. 2).
- 2026 threshold seeded as [verify-failed] (see above). Not stopped, per brief §8.

## Questions
- None.

## Owner steps left
1. Open the 2025 and 2026 nařízení vlády on the average wage in Sbírka zákonů; confirm 46 557 (2025) and 48 967 (2026), and that 1 762 812 is correct.
2. Confirm the 2025 values for insurance base 55 % / 50 % and ZDP § 35ba 30 840 Kč in the 2025 text.
