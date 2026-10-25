# 0021 report: seed rule tables 2025–2026

Status: review
Branch: task/0021-seed-rules (base phase/0)

## 1. Files changed

New: `packages/domain/src/rules/cz/2025.ts`, `cz/2026.ts`, `cz/index.ts`, `packages/domain/test/rules-values.test.ts`.
Replaced: `packages/domain/src/rules/index.ts` (adds the `./cz/index` export line).
Edited: `packages/domain/test/rules-engine.test.ts` (purity test reads `src/rules/` recursively, 2 lines changed plus 1 added).
Brief status line set to `review`.

## 2. Commands (last 5 lines of output)

- `pnpm --filter @shoebox/domain test rules-values`: `Test Files  1 passed (1)`, `Tests  20 passed (20)`
- `pnpm --filter @shoebox/domain test rules`: `Test Files  4 passed (4)`, `Tests  147 passed (147)`
- `pnpm --filter @shoebox/domain typecheck`: `tsc -p tsconfig.json`, exit 0, no `error TS`
- `pnpm exec biome ci packages/domain`: `Checked 32 files in 5ms. No fixes applied.`
- `pnpm lint`: `Checked 165 files … No fixes applied.`, `Found 1 info.` (pre-existing), exit 0
- `pnpm depcruise`: `✔ no dependency violations found (134 modules, 202 dependencies cruised)`
- `pnpm test:unit`: `Tests  466 passed (466)`, Lines 98.37 %

## 3. §7 acceptance

- [x] cz/2025.ts and cz/2026.ts hold every listed key, with valid_from, valid_to, source, verified_at (test "every entry names a primary source")
- [x] rules-values.test.ts: known-date and day-before checks; `rules.at('2026-05-01').get('pausalni_dan.bands')[0].monthly === 9162`
- [x] [verify] table copied below; the TODO(verify) and TODO(decision-T-19) markers are in the data files
- [x] CZ_RULE_ENTRIES and createCzRules exported; purity test covers src/rules/ recursively

## 4. Deviations and [verify] table

Deviations:
- Test counts differ from the brief's expected numbers (`test:unit` 466 not 404; depcruise 134 modules / 202 dependencies not 112 / 154). The phase/0 base moved after the brief was written; the failing counts are not from this change. No test failed.
- Commits were made per file with explicit `git add <path>`, not `git add -A`.
- Brief setup used `git checkout -B` (branch existed in the worktree).

[verify] table (recorded 2026-10-18, copied from brief §2):

| Key | Value | Primary source (`source` field) | Finding |
|---|---|---|---|
| `vat.rates` | 21 / 12 | ZDPH § 47, zakonyprolidi.cz/cs/2004-235#p47 | [O] research §1, §5 ("21 % and 12 % since 1. 1. 2024") |
| `vat.registration_thresholds` | 2 000 000 / 2 536 500 | ZDPH § 6, #p6 | [O] research §3.1 (dauc.cz/predpisy/5839, since 2025-01-01) |
| `vat.kh_document_limit` | 10 000 | GFŘ KH methodology PDF (financnisprava.gov.cz) | [O] research §1.3 (per document incl. VAT) |
| `vat.simplified_document_limit` | 10 000 | ZDPH § 30, #p30 | research §5 (≤ 10 000 Kč incl. VAT) |
| `vat.io_eu_goods_threshold` | 326 000 | ZDPH § 2a, #p2a | [O] research §3.2 (Competitor C almanach) |
| `vat.deduction_deferral_years` | 2 | ZDPH § 73, #p73 | [O] research §3.1 (dauc 5839: end of the 2nd calendar year, since 2025) |
| `vat.ruceni_cash_threshold` | 270 000 | ZDPH § 109, #p109 | consolidated text as of 2026-01-01 (podnikatel.cz/zakony): bod 4 = cash part above the 254/2004 limit; bod 2 (unpublished account) has no amount. 06 [verify] resolved: 270 000 is right for the cash case |
| `vat.cnb_rate_rule` | enum constant | ZDPH § 4 odst. 8, #p4 | `TODO(verify)` left in the data: the § number was not re-read; the enum admits only this value, so no numeric risk |
| `vat.deadline_day` | 25 | ZDPH § 101, #p101 | [O] research §1 table (DPHDP3 by the 25th) |
| `pausalni_vydaje.rates_caps` | 1.6 M / 1.2 M / 0.8 M / 0.6 M | ZDP § 7 odst. 7, zakonyprolidi.cz/cs/1992-586#p7 | [O] research §1.5, §4.1 (unchanged 2025 and 2026) |
| `pausalni_dan.bands` 2025 | 8 716 / 16 745 / 27 139 | financnisprava.gov.cz paušální daň 2025 page | fetched 2026-10-18: 8 716 = 100 + 5 473 + 3 143; ceilings 1 M / 1.5 M (≥ 75 % at 80 or 60 %) / 2 M (≥ 75 % at 80 %) |
| `pausalni_dan.bands` 2026 | 9 162 / 16 745 / 27 139 | ZDP § 38lk, #p38lk | [O] research §1 and §4.2 (money.cz, podnikatel.cz: 9 162 retroactive to 1. 1. 2026, was 9 984). Act 90/2026 itself was not reachable on e-sbirka; 02 Phase 0 exit fixes 9 162 |
| `pausalni_dan.eligibility` | 2 000 000 / 50 000 | ZDP § 2a, #p2a | [O] research §4.2 (podnikatel.cz entry conditions) |
| `pausalni_dan.deadlines` | 01-10 / 01-10 / 20 | ZDP § 38lc, #p38lc | [O] research §3.3 (entry/exit notice by 10 January; advance by the 20th) |
| `insurance.min_advances` 2025 | 4 759 / 3 143 | ČSSZ "Přehled nejdůležitějších údajů 2025"; VZP minimum-advance page in the comment | fetched 2026-10-18: ČSSZ 16 295 × 29.2 % = 4 759; VZP 1. 1. – 31. 12. 2025: 3 143 |
| `insurance.min_advances` 2026 | 5 005 / 3 306 | ČSSZ "Změna výše minimálních záloh OSVČ 2026"; VZP in the comment | fetched 2026-10-18: ČSSZ "do června 5 720, od července 5 005"; VZP from 1. 1. 2026: 3 306. Retroactivity to 1. 1. 2026 per research §4.3/§5 [O money.cz, podnikatel.cz] |
| `asset.capitalization_threshold` | 80 000 | ZDP § 26 odst. 2 písm. a), #p26 | consolidated text (podnikatel.cz zneni-20260801) and zákon č. 609/2020 Sb. (since 2021) |
| `cash.payment_limit` CZK | 270 000 until 2027-07-09 | zákon č. 254/2004 Sb. § 4 odst. 1, zakonyprolidi.cz/cs/2004-254#p4 | fetched 2026-10-18: "překračuje částku 270000 Kč" (version 8, since 2017-07-01) |
| `cash.payment_limit` EUR | 10 000 from 2027-07-10 | Regulation (EU) 2024/1624 Art. 80, eur-lex.europa.eu/eli/reg/2024/1624/oj | [O] research §5 (applies from 10. 7. 2027); T-19 default |

## 5. Questions

1. ZDPH § 109 unpublished-account trigger has no amount limit since 2025 (default in place; M07 to warn at any amount).
2. T-19: only EUR 10 000 is seeded from 2027-07-10 (`TODO(decision-T-19)`).

## 6. Owner steps left

None to run.
