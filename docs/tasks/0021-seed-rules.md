# 0021: Seed rule tables 2025–2026 (Czech law values with source, date and tests)

Status: review
Ticket: P0-DOM-05 | Depends on: 0017c (merged into phase/0, PR #27) | Base commit: head of phase/0 | Branch: task/0021-seed-rules | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Seed the law values every Phase 1 module reads (VAT rates and thresholds, paušální daň bands, flat-rate caps, minimum insurance advances, asset and cash limits) for 2025 and 2026 as effective-dated data under `packages/domain/src/rules/cz/`, each value with its primary source and verification date, and prove them with a value test on a known date and on the day before each change. This closes the Phase 0 exit criterion "`rules.at('2026-05-01')` returns 2026 values (paušální daň band I = 9 162 Kč)".

## 2. Context

Work mechanically: write each new file with **one Write call** using the exact content below, do not re-read a file you just wrote, do not explore the repo, do not open any file this brief does not name, do not open `docs/v3/` or `research/`. Setup: `pnpm install --frozen-lockfile 2>&1 | tail -3`, then `git fetch origin phase/0 && git checkout -b task/0021-seed-rules origin/phase/0`. Commit after each step as `0021 step k`.

Hard rules that apply (AGENTS.md): 1 (money is never a float: every CZK amount below is a whole-number integer, percentages are factors; Biome plugin `no-number-money` forbids `parseFloat`/`Number()`), 2 (`packages/domain` is pure: no `Date.now()`, no `new Date()`, no I/O imports; dependency-cruiser allows only `decimal.js`, `zod` and the package itself), 7 (no new dependency), 8 (never push to `main`), 9 (`[verify]` results are recorded in the table below and copied into the report), 10 (open decision T-19 → default, `TODO(decision-T-19)` left in the data). **Every number in this brief is a law value; copy it exactly. If a test and a data file disagree, the brief is wrong: STOP (§8), do not change either side.**

Spec lines (pasted):

- 06 §2: "Location: `packages/domain/rules/cz/<year>.ts`" (the repo keeps the engine under `packages/domain/src/rules/`, noted in 0017c; this brief uses `packages/domain/src/rules/cz/`). "Each value has `valid_from` / `valid_to` and a `source` URL (the law or official page) plus a `verified_at` date." "Resolution: `rules.at(date)` merges base year data + mid-year amendments + `rules_overrides`." "**Every rule has at least one test** asserting its value on a known date, and a test asserting the *previous* value the day before a change."
- 06 §2.1 (2026 column): `vat.rates {standard: 21, reduced: 12}`, `vat.registration_thresholds {calendar_year: 2_000_000, immediate: 2_536_500}`, `vat.kh_document_limit 10_000`, `vat.simplified_document_limit 10_000`, `vat.io_eu_goods_threshold 326_000`, `vat.deduction_deferral_years 2`, `vat.ruceni_cash_threshold 270_000 [verify]`, `vat.cnb_rate_rule 'rate_valid_on_date_else_last_published'`, `vat.deadline_day 25`, `pausalni_vydaje.rates_caps {80: 1_600_000, 60: 1_200_000, 40: 800_000, 30: 600_000}`, `pausalni_dan.bands [{band:1, monthly: 9_162, ceilings:[{max_income:1_000_000}, {max_income:1_500_000, requires_dominant_rate_in:[80,60]}, {max_income:2_000_000, requires_dominant_rate_in:[80]}]}, {band:2, monthly: 16_745, ceilings:[{1_500_000},{2_000_000,[80,60]}]}, {band:3, monthly: 27_139, ceilings:[{2_000_000}]}]`, `pausalni_dan.eligibility {max_income: 2_000_000, max_other_income: 50_000}`, `pausalni_dan.deadlines {entry: '01-10', exit: '01-10', advance_day: 20}`, `insurance.min_advances {social: 5_005, health: 3_306}`, `asset.capitalization_threshold 80_000`, `cash.payment_limit [{valid_to:'2027-07-09', czk:270_000}, {valid_from:'2027-07-10', eur:10_000}] [verify parallel limits]`.
- 02 Phase 0 exit criteria: "`rules.at('2026-05-01')` returns 2026 values (incl. paušální daň band I = 9 162 Kč)". The resolver API is `rules.at(date).get(key)` (0017a), so the check reads `rules.at('2026-05-01').get('pausalni_dan.bands')[0].monthly === 9162`.
- 04 §7: the meters read `vat.registration_thresholds` (2 000 000 / 2 536 500 Kč, calendar-year test since 1 Jan 2025), `vat.io_eu_goods_threshold` (326 000 Kč/year), `pausalni_dan.bands` + `pausalni_dan.eligibility` (≤ 2 000 000 Kč, other income ≤ 50 000 Kč), `pausalni_vydaje.rates_caps` (1.6 M / 1.2 M / 0.8 M / 0.6 M Kč), `cash.payment_limit` (270 000 Kč/day/counterparty; €10 000 from 10 Jul 2027), `vat.ruceni_cash_threshold` (§109), deadlines the 25th (VAT) and the 20th (paušální daň advance).
- 22 §A T-19 (open): "From 10 Jul 2027: does the Czech 270 000 Kč cash limit remain in parallel with the AMLR €10 000?" Default: both limits as rule data from 2027-07-10. The `cash.payment_limit` schema (0017b) holds one `{amount, currency}` per segment, so the stricter EU limit is seeded from 2027-07-10 with `TODO(decision-T-19)`.

Design decisions fixed by this brief:

1. **One file per year, base layer only.** `2025.ts` closes every segment on `2025-12-31`; `2026.ts` leaves them open-ended (`valid_to: null`), so 2027 dates resolve to the 2026 values until the Annual Update Window adds `2027.ts` and closes them. Dates before 2025-01-01 throw `RuleMissingError` (nothing is seeded for 2024).
2. **Retroactive changes are seeded from 2026-01-01.** Zákon č. 90/2026 Sb. (July 2026) cut paušální daň band I from 9 984 to 9 162 Kč and the minimum social advance from 5 720 to 5 005 Kč with effect from 1 Jan 2026 (ČSSZ collects the old amount until June and offsets). The rules hold the value that applies to the year, not the payment schedule (M06 §4.4 relies on this).
3. **`vat.ruceni_cash_threshold` = 270 000 Kč** is the cash threshold of ZDPH § 109 odst. 2 písm. c) bod 4 (cash part of the payment above the limit of zákon č. 254/2004 Sb.). The unpublished-bank-account case (bod 2) has **no amount condition** since 1 Jan 2025; 04 §7 still describes it as "> 270 000 Kč" (owner question 1).
4. Only the 16 keys the ticket names are seeded (`income_tax.*`, `insurance.rates`, `calendar.cz_public_holidays`, EPO and module-owned keys are seeded by the module ticket that first reads them).
5. The test file is `packages/domain/test/rules-values.test.ts` (the ticket says `test/rules/values.test.ts`; the flat name matches 0017a–c). The `src/rules/cz/` subdirectory requires the 0017a purity test to read `src/rules/` recursively (step 5, a 3-line edit).

`[verify]` results (recorded 2026-10-18; copy this table into the report §4):

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

Excerpt the step-5 edit anchors on (`packages/domain/test/rules-engine.test.ts`, inside `describe('purity …')`):

```ts
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), 'utf8');
```

The step-4 replacement expects `packages/domain/src/rules/index.ts` exactly as 0017c left it (the 0017c brief's step 3 content); the `grep` in step 4 checks that.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/cz/2025.ts` | new | `RULES_CZ_2025`: 16 base entries, 2025-01-01..2025-12-31 |
| `packages/domain/src/rules/cz/2026.ts` | new | `RULES_CZ_2026`: 17 base entries from 2026-01-01 (cash limit split at 2027-07-10) |
| `packages/domain/src/rules/cz/index.ts` | new | `CZ_RULE_ENTRIES`, `createCzRules(extra?)` |
| `packages/domain/src/rules/index.ts` | replace | adds the `./cz/index` export line |
| `packages/domain/test/rules-engine.test.ts` | edit | purity test reads `src/rules/` recursively (3 lines) |
| `packages/domain/test/rules-values.test.ts` | new | the spec (20 tests); never edited |

No other file may change.

## 4. Steps

### Step 1: `packages/domain/src/rules/cz/2025.ts` (new, full content)

```ts
// Czech law values in force in 2025 (06 §2.1), base layer, one segment per key for the calendar
// year. Every value names the law or official page it was read from; `verified_at` is the day a
// person last checked it. Amounts are whole CZK integers (ADR-007); percentages are factors.
// Keys not listed here (income tax, insurance rates, holidays, EPO forms, …) are seeded by the
// module ticket that first reads them (P0-DOM-05 scope).
import type { LawRuleKey } from '../law';
import type { RuleEntryInput } from '../segment';

const VALID_FROM = '2025-01-01';
const VALID_TO = '2025-12-31';
const VERIFIED_AT = '2026-10-18';

/** Zákon č. 235/2004 Sb., o dani z přidané hodnoty (ZDPH). */
const ZDPH = 'https://www.zakonyprolidi.cz/cs/2004-235';
/** Zákon č. 586/1992 Sb., o daních z příjmů (ZDP). */
const ZDP = 'https://www.zakonyprolidi.cz/cs/1992-586';
/** Zákon č. 254/2004 Sb., o omezení plateb v hotovosti, § 4 odst. 1 (limit 270 000 Kč). */
const CASH_ACT = 'https://www.zakonyprolidi.cz/cs/2004-254#p4';
/** GFŘ methodology for the control statement (A.4/B.2 vs A.5/B.3 split at 10 000 Kč incl. VAT). */
const KH_METHODOLOGY =
  'https://financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/Metodicka_informace_k_vyplneni_KH_20240101.pdf';
/** Finanční správa: paušální daň for 2025 (bands, monthly advances, income ceilings). */
const PAUSALNI_DAN_2025 =
  'https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan/informace-k-institutu-pausalni-dane-pro-rok-2025';
/** ČSSZ: key social-security figures for 2025 (minimum base 16 295 Kč → advance 4 759 Kč). */
const CSSZ_2025 =
  'https://www.cssz.gov.cz/-/prehled-nejdulezitejsich-udaju-pro-socialni-zabezpeceni-v-roce-2025';

function base(key: LawRuleKey, source: string, value: unknown): RuleEntryInput {
  return {
    key,
    layer: 'base',
    valid_from: VALID_FROM,
    valid_to: VALID_TO,
    source,
    verified_at: VERIFIED_AT,
    value,
  };
}

export const RULES_CZ_2025: readonly RuleEntryInput[] = [
  // ZDPH § 47 odst. 1: 21 % standard, 12 % reduced (since 2024-01-01, zákon č. 349/2023 Sb.).
  base('vat.rates', `${ZDPH}#p47`, { standard: 21, reduced: 12 }),
  // ZDPH § 6 (since 2025-01-01, zákon č. 461/2024 Sb.): calendar-year turnover over 2 000 000 Kč →
  // payer from 1 January of the next year; over 2 536 500 Kč → payer from the next day.
  base('vat.registration_thresholds', `${ZDPH}#p6`, {
    calendar_year: 2_000_000,
    immediate: 2_536_500,
  }),
  // KH: documents up to 10 000 Kč incl. VAT are reported in aggregate (A.5/B.3), above per document.
  base('vat.kh_document_limit', KH_METHODOLOGY, 10_000),
  // ZDPH § 30 odst. 1: a simplified tax document up to 10 000 Kč total.
  base('vat.simplified_document_limit', `${ZDPH}#p30`, 10_000),
  // ZDPH § 2a odst. 2: EU goods acquisitions above 326 000 Kč per calendar year are taxable.
  base('vat.io_eu_goods_threshold', `${ZDPH}#p2a`, 326_000),
  // ZDPH § 73 odst. 3 (since 2025-01-01): deduction by the end of the 2nd calendar year after it arose.
  base('vat.deduction_deferral_years', `${ZDPH}#p73`, 2),
  // ZDPH § 109 odst. 2 písm. c) bod 4: ručení when the cash part of the payment exceeds the limit of
  // zákon č. 254/2004 Sb. (270 000 Kč). The unpublished-account case (bod 2) has no amount since 2025.
  base('vat.ruceni_cash_threshold', `${ZDPH}#p109`, 270_000),
  // ZDPH § 4 odst. 8: ČNB rate valid on the date the tax point arises, else the last published rate.
  // TODO(verify): § number not re-read on 2026-10-18; the enum admits only this value.
  base('vat.cnb_rate_rule', `${ZDPH}#p4`, 'rate_valid_on_date_else_last_published'),
  // ZDPH § 101 odst. 1: the return is due within 25 days after the end of the period.
  base('vat.deadline_day', `${ZDPH}#p101`, 25),
  // ZDP § 7 odst. 7: flat-rate expense percentages and their caps (income cap 2 000 000 Kč).
  base('pausalni_vydaje.rates_caps', `${ZDP}#p7`, {
    '80': 1_600_000,
    '60': 1_200_000,
    '40': 800_000,
    '30': 600_000,
  }),
  // Paušální daň 2025: band I 8 716 Kč (100 + 5 473 + 3 143), band II 16 745 Kč, band III 27 139 Kč.
  base('pausalni_dan.bands', PAUSALNI_DAN_2025, [
    {
      band: 1,
      monthly: 8_716,
      ceilings: [
        { max_income: 1_000_000 },
        { max_income: 1_500_000, requires_dominant_rate_in: [80, 60] },
        { max_income: 2_000_000, requires_dominant_rate_in: [80] },
      ],
    },
    {
      band: 2,
      monthly: 16_745,
      ceilings: [
        { max_income: 1_500_000 },
        { max_income: 2_000_000, requires_dominant_rate_in: [80, 60] },
      ],
    },
    { band: 3, monthly: 27_139, ceilings: [{ max_income: 2_000_000 }] },
  ]),
  // ZDP § 2a odst. 1: income from self-employment up to 2 000 000 Kč, other §§ 8–10 income up to 50 000 Kč.
  base('pausalni_dan.eligibility', `${ZDP}#p2a`, {
    max_income: 2_000_000,
    max_other_income: 50_000,
  }),
  // ZDP § 38lc (entry and exit notice by 10 January) and § 38lk (advance due by the 20th of the month).
  base('pausalni_dan.deadlines', `${ZDP}#p38lc`, {
    entry: '01-10',
    exit: '01-10',
    advance_day: 20,
  }),
  // Social: ČSSZ 2025 (29.2 % of the minimum base 16 295 Kč = 4 759 Kč). Health: VZP, minimum base
  // 23 278,50 Kč → 3 143 Kč (https://www.vzp.cz/platci/informace/osvc/osvc-minimalni-vyse-zaloh).
  base('insurance.min_advances', CSSZ_2025, { social: 4_759, health: 3_143 }),
  // ZDP § 26 odst. 2 písm. a): tangible movable assets with an entry price above 80 000 Kč (since 2021).
  base('asset.capitalization_threshold', `${ZDP}#p26`, 80_000),
  // Zákon č. 254/2004 Sb. § 4 odst. 1: payments above 270 000 Kč per day and counterparty are cashless.
  base('cash.payment_limit', CASH_ACT, { amount: 270_000, currency: 'CZK' }),
];
```

Command: `git add -A && git commit -q -m '0021 step 1' && git log --oneline -1 | tail -1`. Expected: one line with `0021 step 1`.

### Step 2: `packages/domain/src/rules/cz/2026.ts` (new, full content)

```ts
// Czech law values in force from 2026-01-01 (06 §2.1), base layer. Segments are open-ended: the
// Annual Update Window (06 §4) closes them on 2026-12-31 when `2027.ts` is added. Retroactive
// changes (zákon č. 90/2026 Sb., in force July 2026 with effect from 2026-01-01) are seeded from
// 2026-01-01: the rules hold the value that applies to the year, not the payment schedule.
import type { LawRuleKey } from '../law';
import type { RuleEntryInput } from '../segment';

const VALID_FROM = '2026-01-01';
const VERIFIED_AT = '2026-10-18';

/** Zákon č. 235/2004 Sb., o dani z přidané hodnoty (ZDPH). */
const ZDPH = 'https://www.zakonyprolidi.cz/cs/2004-235';
/** Zákon č. 586/1992 Sb., o daních z příjmů (ZDP). */
const ZDP = 'https://www.zakonyprolidi.cz/cs/1992-586';
/** Zákon č. 254/2004 Sb., o omezení plateb v hotovosti, § 4 odst. 1 (limit 270 000 Kč). */
const CASH_ACT = 'https://www.zakonyprolidi.cz/cs/2004-254#p4';
/** Regulation (EU) 2024/1624 (AMLR), Art. 80: cash payments above EUR 10 000 banned from 2027-07-10. */
const AMLR = 'https://eur-lex.europa.eu/eli/reg/2024/1624/oj';
/** GFŘ methodology for the control statement (A.4/B.2 vs A.5/B.3 split at 10 000 Kč incl. VAT). */
const KH_METHODOLOGY =
  'https://financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/Metodicka_informace_k_vyplneni_KH_20240101.pdf';
/** ČSSZ: minimum advances for 2026 (5 720 Kč paid until June, 5 005 Kč from July; zákon č. 90/2026 Sb.). */
const CSSZ_2026 = 'https://www.cssz.gov.cz/zmena-vyse-minimalnich-zaloh-osvc-v-roce-2024';

function base(key: LawRuleKey, source: string, value: unknown): RuleEntryInput {
  return {
    key,
    layer: 'base',
    valid_from: VALID_FROM,
    valid_to: null,
    source,
    verified_at: VERIFIED_AT,
    value,
  };
}

export const RULES_CZ_2026: readonly RuleEntryInput[] = [
  // ZDPH § 47 odst. 1: 21 % standard, 12 % reduced (unchanged since 2024-01-01).
  base('vat.rates', `${ZDPH}#p47`, { standard: 21, reduced: 12 }),
  // ZDPH § 6: calendar-year turnover over 2 000 000 Kč → payer from 1 January of the next year;
  // over 2 536 500 Kč → payer from the next day (unchanged since 2025-01-01).
  base('vat.registration_thresholds', `${ZDPH}#p6`, {
    calendar_year: 2_000_000,
    immediate: 2_536_500,
  }),
  // KH: documents up to 10 000 Kč incl. VAT are reported in aggregate (A.5/B.3), above per document.
  base('vat.kh_document_limit', KH_METHODOLOGY, 10_000),
  // ZDPH § 30 odst. 1: a simplified tax document up to 10 000 Kč total.
  base('vat.simplified_document_limit', `${ZDPH}#p30`, 10_000),
  // ZDPH § 2a odst. 2: EU goods acquisitions above 326 000 Kč per calendar year are taxable.
  base('vat.io_eu_goods_threshold', `${ZDPH}#p2a`, 326_000),
  // ZDPH § 73 odst. 3: deduction by the end of the 2nd calendar year after it arose.
  base('vat.deduction_deferral_years', `${ZDPH}#p73`, 2),
  // ZDPH § 109 odst. 2 písm. c) bod 4: ručení when the cash part of the payment exceeds the limit of
  // zákon č. 254/2004 Sb. (270 000 Kč). The unpublished-account case (bod 2) has no amount since 2025.
  base('vat.ruceni_cash_threshold', `${ZDPH}#p109`, 270_000),
  // ZDPH § 4 odst. 8: ČNB rate valid on the date the tax point arises, else the last published rate.
  // TODO(verify): § number not re-read on 2026-10-18; the enum admits only this value.
  base('vat.cnb_rate_rule', `${ZDPH}#p4`, 'rate_valid_on_date_else_last_published'),
  // ZDPH § 101 odst. 1: the return is due within 25 days after the end of the period.
  base('vat.deadline_day', `${ZDPH}#p101`, 25),
  // ZDP § 7 odst. 7: flat-rate expense percentages and their caps (income cap 2 000 000 Kč).
  base('pausalni_vydaje.rates_caps', `${ZDP}#p7`, {
    '80': 1_600_000,
    '60': 1_200_000,
    '40': 800_000,
    '30': 600_000,
  }),
  // ZDP § 38lk: paušální záloha = tax advance + 1.15 × minimum social advance + minimum health advance.
  // 2026: band I 9 162 Kč (100 + 5 756 + 3 306; zákon č. 90/2026 Sb., retroactive to 2026-01-01,
  // was 9 984 Kč before the act), band II 16 745 Kč, band III 27 139 Kč.
  base('pausalni_dan.bands', `${ZDP}#p38lk`, [
    {
      band: 1,
      monthly: 9_162,
      ceilings: [
        { max_income: 1_000_000 },
        { max_income: 1_500_000, requires_dominant_rate_in: [80, 60] },
        { max_income: 2_000_000, requires_dominant_rate_in: [80] },
      ],
    },
    {
      band: 2,
      monthly: 16_745,
      ceilings: [
        { max_income: 1_500_000 },
        { max_income: 2_000_000, requires_dominant_rate_in: [80, 60] },
      ],
    },
    { band: 3, monthly: 27_139, ceilings: [{ max_income: 2_000_000 }] },
  ]),
  // ZDP § 2a odst. 1: income from self-employment up to 2 000 000 Kč, other §§ 8–10 income up to 50 000 Kč.
  base('pausalni_dan.eligibility', `${ZDP}#p2a`, {
    max_income: 2_000_000,
    max_other_income: 50_000,
  }),
  // ZDP § 38lc (entry and exit notice by 10 January) and § 38lk (advance due by the 20th of the month).
  base('pausalni_dan.deadlines', `${ZDP}#p38lc`, {
    entry: '01-10',
    exit: '01-10',
    advance_day: 20,
  }),
  // Social: minimum base 35 % of the average wage 48 967 Kč = 17 139 Kč → 5 005 Kč (zákon č. 90/2026 Sb.,
  // retroactive to 2026-01-01; ČSSZ collects 5 720 Kč until June and offsets). Health: VZP, minimum
  // base 24 483,50 Kč → 3 306 Kč (https://www.vzp.cz/platci/informace/osvc/osvc-minimalni-vyse-zaloh).
  base('insurance.min_advances', CSSZ_2026, { social: 5_005, health: 3_306 }),
  // ZDP § 26 odst. 2 písm. a): tangible movable assets with an entry price above 80 000 Kč (since 2021).
  base('asset.capitalization_threshold', `${ZDP}#p26`, 80_000),
  // Zákon č. 254/2004 Sb. § 4 odst. 1: payments above 270 000 Kč per day and counterparty are cashless,
  // until the AMLR limit applies.
  {
    ...base('cash.payment_limit', CASH_ACT, { amount: 270_000, currency: 'CZK' }),
    valid_to: '2027-07-09',
  },
  // AMLR Art. 80 (applies from 2027-07-10, Art. 90): no cash payment above EUR 10 000 for goods or
  // services. TODO(decision-T-19): whether the Czech 270 000 Kč limit stays in parallel; the schema
  // holds one regime per segment, so the stricter EU limit is seeded.
  {
    key: 'cash.payment_limit',
    layer: 'base',
    valid_from: '2027-07-10',
    valid_to: null,
    source: AMLR,
    verified_at: VERIFIED_AT,
    value: { amount: 10_000, currency: 'EUR' },
  },
];
```

Command: `git add -A && git commit -q -m '0021 step 2' && git log --oneline -1 | tail -1`. Expected: `0021 step 2`.

### Step 3: `packages/domain/src/rules/cz/index.ts` (new, full content)

```ts
// The Czech rule data (06 §2): every base-layer entry of every seeded year, and the resolver over
// them. Apps add `rules_overrides` rows (layer `override`) through `createCzRules(extra)`.
import { createRules, type RULE_SCHEMAS } from '../keys';
import type { RuleResolver } from '../resolver';
import type { RuleEntryInput } from '../segment';
import { RULES_CZ_2025 } from './2025';
import { RULES_CZ_2026 } from './2026';

/** All seeded Czech entries, oldest year first. */
export const CZ_RULE_ENTRIES: readonly RuleEntryInput[] = [...RULES_CZ_2025, ...RULES_CZ_2026];

/** The Czech rules, optionally merged with amendments or `rules_overrides` rows; pure. */
export function createCzRules(
  extra: readonly RuleEntryInput[] = [],
): RuleResolver<typeof RULE_SCHEMAS> {
  return createRules([...CZ_RULE_ENTRIES, ...extra]);
}

export { RULES_CZ_2025, RULES_CZ_2026 };
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5`. Expected: no `error TS`, exit 0. Commit as `0021 step 3`.

### Step 4: `packages/domain/src/rules/index.ts` (replace the whole file; already in Biome's sort order)

First `grep -nF "from './cz/index'" packages/domain/src/rules/index.ts | head -3` must print nothing and `grep -c '' packages/domain/src/rules/index.ts` must print `42` (otherwise STOP, §8). Then write the file:

```ts
export {
  CountryCode,
  CzkWhole,
  DayOfMonth,
  DecimalString,
  Digits,
  Identifier,
  ModuleOwnedRecord,
  MoneyString,
  MonthDay,
  NonNegInt,
  Pct,
  PositiveInt,
  Ratio,
  YearKey,
} from './atoms';
export { CZ_RULE_ENTRIES, createCzRules, RULES_CZ_2025, RULES_CZ_2026 } from './cz/index';
export {
  RuleError,
  RuleGapError,
  RuleMissingError,
  RuleOverlapError,
  RuleValueError,
  UnknownRuleKeyError,
} from './errors';
export type { RuleKey, RuleSet } from './keys';
export {
  createRules,
  getRuleKeySchema,
  isRuleKey,
  RULE_KEYS,
  RULE_SCHEMAS,
  RuleEntrySchema,
  RuleSetSchema,
} from './keys';
export type { LawRuleKey } from './law';
export { LAW_RULE_KEYS, LAW_RULE_SCHEMAS } from './law';
export type { ProductRuleKey } from './product';
export { PRODUCT_RULE_KEYS, PRODUCT_RULE_SCHEMAS } from './product';
export type { RuleKeyOf, RuleResolver, RuleSchemaMap, RulesAt, RuleValueOf } from './resolver';
export { createRuleResolver } from './resolver';
export type { RuleEntry, RuleEntryInput, RuleLayer } from './segment';
export { LegalDateSchema, RULE_LAYERS, RuleEntryMetaSchema, ruleEntrySchema } from './segment';
```

Command: `pnpm exec biome ci packages/domain/src/rules 2>&1 | tail -5`. Expected: `Checked 11 files … No fixes applied.` and no `Found … errors` (a fixable formatting issue: run `pnpm exec biome format --write packages/domain/src/rules` once and re-check; an error that does not go away: STOP, §8). Commit as `0021 step 4`.

### Step 5: `packages/domain/test/rules-engine.test.ts` (edit: the purity test reads `src/rules/` recursively)

Anchor (must occur exactly once; `grep -nF "for (const file of readdirSync(dir)) {" packages/domain/test/rules-engine.test.ts | head -3` prints one line, else STOP):

```ts
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), 'utf8');
```

Replace with:

```ts
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' });
    for (const file of files.filter((name) => name.endsWith('.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8');
```

Nothing else in the file changes. Command: `pnpm --filter @shoebox/domain test rules-engine 2>&1 | tail -6`. Expected: `Test Files  1 passed (1)`, `Tests  36 passed (36)`. Commit as `0021 step 5`.

### Step 6: `packages/domain/test/rules-values.test.ts` (new, full content; do not edit it)

```ts
import { describe, expect, it } from 'vitest';
import {
  CZ_RULE_ENTRIES,
  createCzRules,
  RULES_CZ_2025,
  RULES_CZ_2026,
  type RuleKey,
  RuleMissingError,
  RuleSetSchema,
} from '../src/index';

// Real law values (P0-DOM-05, 06 §2.1): every key is asserted on a known date and on the day
// before a change. Sources are in the comments of src/rules/cz/2025.ts and 2026.ts.
const rules = createCzRules();

/** The keys P0-DOM-05 seeds; the other law keys are seeded by the module ticket that reads them. */
const SEEDED_KEYS: readonly RuleKey[] = [
  'asset.capitalization_threshold',
  'cash.payment_limit',
  'insurance.min_advances',
  'pausalni_dan.bands',
  'pausalni_dan.deadlines',
  'pausalni_dan.eligibility',
  'pausalni_vydaje.rates_caps',
  'vat.cnb_rate_rule',
  'vat.deadline_day',
  'vat.deduction_deferral_years',
  'vat.io_eu_goods_threshold',
  'vat.kh_document_limit',
  'vat.rates',
  'vat.registration_thresholds',
  'vat.ruceni_cash_threshold',
  'vat.simplified_document_limit',
];

/** Primary sources only (06 §2): the law, the ministry, ČSSZ, VZP or the EU Official Journal. */
const PRIMARY_HOSTS = [
  'www.zakonyprolidi.cz',
  'financnisprava.gov.cz',
  'www.cssz.gov.cz',
  'www.vzp.cz',
  'eur-lex.europa.eu',
];

const PAUSALNI_DAN_CEILINGS = {
  1: [
    { max_income: 1_000_000 },
    { max_income: 1_500_000, requires_dominant_rate_in: [80, 60] },
    { max_income: 2_000_000, requires_dominant_rate_in: [80] },
  ],
  2: [{ max_income: 1_500_000 }, { max_income: 2_000_000, requires_dominant_rate_in: [80, 60] }],
  3: [{ max_income: 2_000_000 }],
};

describe('seed files (06 §2)', () => {
  it('every entry is a valid RuleSetSchema item in the base layer', () => {
    const parsed = RuleSetSchema.safeParse(CZ_RULE_ENTRIES);
    expect(parsed.success).toBe(true);
    expect(CZ_RULE_ENTRIES.every((entry) => entry.layer === 'base')).toBe(true);
    expect(CZ_RULE_ENTRIES).toHaveLength(RULES_CZ_2025.length + RULES_CZ_2026.length);
  });

  it('every entry names a primary source and a verification date', () => {
    for (const entry of CZ_RULE_ENTRIES) {
      expect(PRIMARY_HOSTS, entry.source).toContain(new URL(entry.source).hostname);
      expect(entry.verified_at).toBe('2026-10-18');
    }
  });

  it('seeds exactly the P0-DOM-05 keys in both years', () => {
    expect([...new Set(RULES_CZ_2025.map((e) => e.key))].sort()).toEqual(SEEDED_KEYS);
    expect([...new Set(RULES_CZ_2026.map((e) => e.key))].sort()).toEqual(SEEDED_KEYS);
    expect(RULES_CZ_2025).toHaveLength(16);
    expect(RULES_CZ_2026).toHaveLength(17);
  });

  it('2025 segments span the calendar year; 2026 segments start on 2026-01-01', () => {
    for (const entry of RULES_CZ_2025) {
      expect(entry.valid_from).toBe('2025-01-01');
      expect(entry.valid_to).toBe('2025-12-31');
    }
    expect(RULES_CZ_2026.every((entry) => entry.valid_from >= '2026-01-01')).toBe(true);
    expect(RULES_CZ_2026.filter((entry) => entry.valid_from === '2026-01-01')).toHaveLength(16);
  });

  it('every seeded key resolves on every day of 2025 and 2026 and not before', () => {
    for (const key of SEEDED_KEYS) {
      for (const date of ['2025-01-01', '2025-12-31', '2026-01-01', '2026-12-31']) {
        expect(rules.at(date).has(key), `${key} on ${date}`).toBe(true);
      }
      expect(rules.at('2024-12-31').has(key)).toBe(false);
    }
    expect(() => rules.at('2024-12-31').get('vat.rates')).toThrow(RuleMissingError);
  });
});

describe('VAT (zákon č. 235/2004 Sb.)', () => {
  it('vat.rates: 21 % / 12 % in both years', () => {
    for (const date of ['2025-01-01', '2025-12-31', '2026-01-01', '2026-05-01']) {
      expect(rules.at(date).get('vat.rates')).toEqual({ standard: 21, reduced: 12 });
    }
  });

  it('vat.registration_thresholds: 2 000 000 / 2 536 500 Kč in both years', () => {
    for (const date of ['2025-01-01', '2025-12-31', '2026-01-01', '2026-05-01']) {
      expect(rules.at(date).get('vat.registration_thresholds')).toEqual({
        calendar_year: 2_000_000,
        immediate: 2_536_500,
      });
    }
  });

  it('document limits: KH 10 000 Kč, simplified document 10 000 Kč, EU goods 326 000 Kč', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('vat.kh_document_limit')).toBe(10_000);
      expect(rules.at(date).get('vat.simplified_document_limit')).toBe(10_000);
      expect(rules.at(date).get('vat.io_eu_goods_threshold')).toBe(326_000);
    }
  });

  it('deduction deferral 2 years, ručení cash threshold 270 000 Kč', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('vat.deduction_deferral_years')).toBe(2);
      expect(rules.at(date).get('vat.ruceni_cash_threshold')).toBe(270_000);
    }
  });

  it('ČNB rate rule and the 25th as the deadline day', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('vat.cnb_rate_rule')).toBe(
        'rate_valid_on_date_else_last_published',
      );
      expect(rules.at(date).get('vat.deadline_day')).toBe(25);
    }
  });
});

describe('income tax and paušální daň (zákon č. 586/1992 Sb.)', () => {
  it('pausalni_vydaje.rates_caps: 1.6 M / 1.2 M / 0.8 M / 0.6 M Kč in both years', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('pausalni_vydaje.rates_caps')).toEqual({
        '80': 1_600_000,
        '60': 1_200_000,
        '40': 800_000,
        '30': 600_000,
      });
    }
  });

  it('pausalni_dan.bands 2025: 8 716 / 16 745 / 27 139 Kč with the income ceilings', () => {
    for (const date of ['2025-01-01', '2025-12-31']) {
      expect(rules.at(date).get('pausalni_dan.bands')).toEqual([
        { band: 1, monthly: 8_716, ceilings: PAUSALNI_DAN_CEILINGS[1] },
        { band: 2, monthly: 16_745, ceilings: PAUSALNI_DAN_CEILINGS[2] },
        { band: 3, monthly: 27_139, ceilings: PAUSALNI_DAN_CEILINGS[3] },
      ]);
    }
  });

  it('Phase 0 exit: rules.at(2026-05-01) band I = 9 162 Kč', () => {
    expect(rules.at('2026-05-01').get('pausalni_dan.bands')[0]?.monthly).toBe(9_162);
  });

  it('pausalni_dan.bands 2026: 9 162 Kč from 2026-01-01 (retroactive), 8 716 Kč the day before', () => {
    expect(rules.at('2025-12-31').get('pausalni_dan.bands')[0]?.monthly).toBe(8_716);
    for (const date of ['2026-01-01', '2026-06-30', '2026-07-01', '2026-12-31']) {
      expect(rules.at(date).get('pausalni_dan.bands')).toEqual([
        { band: 1, monthly: 9_162, ceilings: PAUSALNI_DAN_CEILINGS[1] },
        { band: 2, monthly: 16_745, ceilings: PAUSALNI_DAN_CEILINGS[2] },
        { band: 3, monthly: 27_139, ceilings: PAUSALNI_DAN_CEILINGS[3] },
      ]);
    }
  });

  it('pausalni_dan.eligibility and deadlines are unchanged across the year boundary', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('pausalni_dan.eligibility')).toEqual({
        max_income: 2_000_000,
        max_other_income: 50_000,
      });
      expect(rules.at(date).get('pausalni_dan.deadlines')).toEqual({
        entry: '01-10',
        exit: '01-10',
        advance_day: 20,
      });
    }
  });
});

describe('insurance minimum advances (ČSSZ, VZP)', () => {
  it('2025: social 4 759 Kč, health 3 143 Kč; 2026: social 5 005 Kč, health 3 306 Kč', () => {
    for (const date of ['2025-01-01', '2025-12-31']) {
      expect(rules.at(date).get('insurance.min_advances')).toEqual({
        social: 4_759,
        health: 3_143,
      });
    }
    for (const date of ['2026-01-01', '2026-06-30', '2026-07-01']) {
      expect(rules.at(date).get('insurance.min_advances')).toEqual({
        social: 5_005,
        health: 3_306,
      });
    }
  });
});

describe('assets and cash', () => {
  it('asset.capitalization_threshold: 80 000 Kč in both years', () => {
    for (const date of ['2025-12-31', '2026-01-01']) {
      expect(rules.at(date).get('asset.capitalization_threshold')).toBe(80_000);
    }
  });

  it('cash.payment_limit: 270 000 Kč until 2027-07-09, EUR 10 000 from 2027-07-10', () => {
    for (const date of ['2025-01-01', '2025-12-31', '2026-01-01', '2027-07-09']) {
      expect(rules.at(date).get('cash.payment_limit')).toEqual({
        amount: 270_000,
        currency: 'CZK',
      });
    }
    for (const date of ['2027-07-10', '2028-01-01']) {
      expect(rules.at(date).get('cash.payment_limit')).toEqual({ amount: 10_000, currency: 'EUR' });
    }
  });

  it('resolve() carries the source of the winning segment', () => {
    const czk = rules.at('2026-01-01').resolve('cash.payment_limit');
    expect(czk.source).toBe('https://www.zakonyprolidi.cz/cs/2004-254#p4');
    expect(czk.valid_to).toBe('2027-07-09');
    const eur = rules.at('2027-07-10').resolve('cash.payment_limit');
    expect(eur.source).toBe('https://eur-lex.europa.eu/eli/reg/2024/1624/oj');
  });

  it('an override row beats the seeded base value', () => {
    const patched = createCzRules([
      {
        key: 'vat.kh_document_limit',
        layer: 'override',
        valid_from: '2026-03-01',
        valid_to: null,
        source: 'https://financnisprava.gov.cz/',
        verified_at: '2026-03-01',
        value: 20_000,
      },
    ]);
    expect(patched.at('2026-02-28').get('vat.kh_document_limit')).toBe(10_000);
    expect(patched.at('2026-03-01').get('vat.kh_document_limit')).toBe(20_000);
  });
});
```

Command: `pnpm --filter @shoebox/domain test rules-values 2>&1 | tail -6`. Expected: `Test Files  1 passed (1)`, `Tests  20 passed (20)`. Commit as `0021 step 6`.

### Step 7: full checks and the report

Run the §6 commands, then §9.

## 5. Do not touch

- Anything outside §3. In particular not `atoms.ts`, `law.ts`, `keys.ts`, `product.ts`, `errors.ts`, `segment.ts`, `resolver.ts`, `test/rules-law.test.ts`, `test/rules-keys.test.ts`, `packages/domain/src/index.ts`, `packages/domain/src/money/**`, `package.json`, `pnpm-lock.yaml`, `biome.json`, `docs/v3/`, `research/`.
- In `test/rules-engine.test.ts` only the three lines of step 5.
- Do not change a number, a date or a URL in this brief, and do not edit `test/rules-values.test.ts` or a data file to make a test pass (§8).
- Do not add a key, a year or an `amendment`/`override` entry; no `income_tax.*`, `insurance.rates`, holidays or EPO data (module tickets).
- Hard rules 1, 2, 7 (no new dependency), 8.

## 6. Commands

From the repo root (no `--` between `test` and the filter: pnpm passes it to vitest and the filter is lost):

1. `pnpm --filter @shoebox/domain test rules-values 2>&1 | tail -30` → `Tests  20 passed (20)`.
2. `pnpm --filter @shoebox/domain test rules 2>&1 | tail -30` → `Test Files  4 passed (4)`, `Tests  147 passed (147)` (36 engine + 39 law + 52 keys + 20 values).
3. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no `error TS`, exit 0.
4. `pnpm exec biome ci packages/domain 2>&1 | tail -30` → `Checked 32 files … No fixes applied.`, no `Found … errors`.
5. `pnpm lint 2>&1 | tail -30` → exit 0 (`Found 0 errors`; a pre-existing `info` line is fine).
6. `pnpm depcruise 2>&1 | tail -30` → `✔ no dependency violations found (112 modules, 154 dependencies cruised)`.
7. `pnpm test:unit 2>&1 | tail -30` → `Tests  404 passed (404)`; coverage `Lines` for `packages/domain/src/**` ≥ 90 % (about 99 %).

## 7. Acceptance (mirrors the ticket)

- [ ] `packages/domain/src/rules/cz/2025.ts` and `2026.ts` hold `vat.rates`, `vat.registration_thresholds`, `vat.kh_document_limit`, `vat.simplified_document_limit`, `vat.io_eu_goods_threshold`, `vat.deduction_deferral_years`, `vat.ruceni_cash_threshold`, `vat.cnb_rate_rule`, `vat.deadline_day`, `pausalni_vydaje.rates_caps`, `pausalni_dan.bands|eligibility|deadlines`, `insurance.min_advances`, `asset.capitalization_threshold`, `cash.payment_limit` (CZK 270 000 until 2027-07-09, EUR 10 000 from 2027-07-10); every entry carries `valid_from`, `valid_to`, a primary `source` URL and `verified_at` (test "every entry names a primary source").
- [ ] `packages/domain/test/rules-values.test.ts`: every key is asserted on a known date and on the day before a change (2025-12-31 vs 2026-01-01 for the bands and the minimum advances; 2027-07-09 vs 2027-07-10 for the cash limit; the year boundary for unchanged keys); `rules.at('2026-05-01').get('pausalni_dan.bands')[0].monthly === 9162` (02 Phase 0 exit).
- [ ] The `[verify]` table of §2 is copied into the report §4 verbatim; the one `TODO(verify)` (ČNB rule paragraph) and the `TODO(decision-T-19)` comment stay in the data files.
- [ ] `CZ_RULE_ENTRIES` and `createCzRules` are exported from `@shoebox/domain`; the 0017a purity test still covers every file under `src/rules/`, including `cz/`.
- Not in this ticket: 2024 and 2027 data (except the AMLR segment), the other 20 law keys, the DB loader of `rules_overrides` rows, the 04 §7 wording fix (owner question 1).

## 8. Stop and ask

Stop, and write the report, if:

- an anchor excerpt is not found, or the step-4 `grep` prints something unexpected;
- a test fails twice, or a test the brief wrote seems wrong (the source files are given in full; if a given file fails its own tests, the brief is wrong: do not patch either side, report it);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, `Done: steps 1 to k. Left: steps k+1 to n.`);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0021-report.md` (600 tokens at most, plus the `[verify]` table copied from §2), set `Status: review` in this brief, commit as `0021 report`, then `git push -u origin task/0021-seed-rules 2>&1 | tail -3`. The orchestrator opens and merges the PR. The report has:

1. The files changed (`git diff --stat origin/phase/0...HEAD`).
2. Each §6 command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and the `[verify]` table (§2) with its sources.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

HIGH (tax rules). Read `cz/2025.ts` and `cz/2026.ts` number by number against the §2 table and 06 §2.1 (2025 differs from 2026 only in `pausalni_dan.bands[0].monthly` 8 716 → 9 162 and `insurance.min_advances` 4 759/3 143 → 5 005/3 306). Confirm `test/rules-values.test.ts` is byte-identical to this brief, that the only `rules-engine.test.ts` change is the three lines of step 5, and that no `amendment` or `override` entry was added. After merge the orchestrator: ticks P0-DOM-05 in the backlog; in 06 §2.1 marks `vat.ruceni_cash_threshold` [verify] as resolved (cash case, § 109 odst. 2 písm. c) bod 4) and `cash.payment_limit` as T-19 default; appends to decisions "2026-10-18 [rules] open-ended segments for the latest seeded year; retroactive law changes seeded from their effective date"; appends to known-issues "04 §7 describes the §109 unpublished-account trigger with a 270 000 Kč threshold; since 2025 that case has no amount (M07 spec to fix)".

## Owner steps

None to run. Two questions for the owner (answer in the review, the defaults ship):

1. ZDPH § 109 since 1. 1. 2025: paying to an **unpublished** account triggers ručení with **no amount limit**; the 270 000 Kč threshold applies to the **cash** part of a payment. The key keeps its name and the cash meaning (06 §2.1). Default: M07's "unpublished account" check warns at any amount; the orchestrator notes it in known-issues for the M07 brief. Agree?
2. T-19 (cash limit from 10. 7. 2027): the schema holds one regime per segment, so only EUR 10 000 is seeded from 2027-07-10 and `TODO(decision-T-19)` stays. Default: keep; revisit in the 2027 Annual Update Window. Agree?
