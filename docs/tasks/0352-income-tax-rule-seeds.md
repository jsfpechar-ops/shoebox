# 0352: Rule seeds `income_tax.rates`, `income_tax.credits`, `insurance.rates` (2025, 2026)

Status: todo
Ticket: P4-POD-01 (rules) | Depends on: — | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 12 tool calls, 35k tokens

## 1. Objective

Seed the three law keys the income-tax podklady and the tax-reserve estimate read (M06 §3, 06 §2.1). The schemas already exist in `packages/domain/src/rules/law.ts`; only the values and their tests are missing. Rule 1: rates, limits and deadlines live only here.

## 2. Context

Schemas (law.ts, already there, do not edit):
```ts
'income_tax.rates': z.strictObject({ r1: Pct, r2: Pct, threshold_annual: CzkWhole }),
'income_tax.credits': z.strictObject({ taxpayer: CzkWhole }),
'insurance.rates': z.strictObject({ social_pct: Pct, social_base_pct: Pct, health_pct: Pct, health_base_pct: Pct }),
```
Seed helper in each year file: `base(key, source, value)` (sets `layer: 'base'`, `valid_from` = 1 Jan of the year, `valid_to: null`, `verified_at`). Append the three entries right after the existing `base('insurance.min_advances', …)` entry in both `cz/2025.ts` and `cz/2026.ts`.

Values (primary sources; `[verify]` items go in the report with the page you checked):

| Key | 2025 | 2026 | Source |
|---|---|---|---|
| `income_tax.rates` | `{ r1: 15, r2: 23, threshold_annual: 1_676_052 }` | `{ r1: 15, r2: 23, threshold_annual: 1_762_812 }` | ZDP § 16 odst. 1 (`https://www.zakonyprolidi.cz/cs/1992-586#p16`): 15 % up to 36 × the average wage, 23 % above. 2025: 36 × 46 557; 2026: 36 × 48 967 = 1 762 812 (22 T-18, computed in research [I]) **[verify both products against the nařízení vlády on the average wage for each year]** |
| `income_tax.credits` | `{ taxpayer: 30_840 }` | `{ taxpayer: 30_840 }` | ZDP § 35ba odst. 1 písm. a) (`…#p35ba`) |
| `insurance.rates` | `{ social_pct: 29.2, social_base_pct: 55, health_pct: 13.5, health_base_pct: 50 }` | same | social: zákon č. 589/1992 Sb. § 7 odst. 1 písm. c) (29,2 %) and § 5b odst. 1 (base 55 % of the profit since 2024) `https://www.zakonyprolidi.cz/cs/1992-589`; health: zákon č. 592/1992 Sb. § 2 odst. 1 (13,5 %) and § 3a odst. 2 (base 50 %) `https://www.zakonyprolidi.cz/cs/1992-592` **[verify the 55 % base for 2025 and 2026; the 2024 consolidation package phased it 50 → 55 %]** |

Put each source URL in the `source` argument and a one-line comment above the entry (the existing entries show the style). `Pct` accepts decimals (29.2, 13.5).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/cz/2025.ts` | edit | three `base(...)` entries after `insurance.min_advances` |
| `packages/domain/src/rules/cz/2026.ts` | edit | same, 2026 values |
| `packages/domain/test/rules-values.test.ts` | edit | add the keys to `SEEDED_KEYS` (alphabetical) and the `describe` below |

## 4. Steps

1. 2025 entries. Anchor (2025.ts): the line starting `base('insurance.min_advances',`. Insert after that statement (after its closing `),`).
2. 2026 entries. Anchor (2026.ts): `base('insurance.min_advances', CSSZ_2026, { social: 5_005, health: 3_306 }),`. Insert after it.
3. Test: add `'income_tax.credits'`, `'income_tax.rates'`, `'insurance.rates'` to `SEEDED_KEYS` (keep alphabetical order), then append:
```ts
describe('income tax and insurance rates (M06, 06 §2.1)', () => {
  it('income_tax.rates: 15 % / 23 %, threshold 1 676 052 (2025) and 1 762 812 (2026)', () => {
    expect(rules.at('2025-12-31').get('income_tax.rates')).toEqual({ r1: 15, r2: 23, threshold_annual: 1_676_052 });
    expect(rules.at('2026-01-01').get('income_tax.rates')).toEqual({ r1: 15, r2: 23, threshold_annual: 1_762_812 });
  });
  it('income_tax.credits.taxpayer: 30 840 Kč in both years', () => {
    for (const date of ['2025-06-30', '2026-06-30']) {
      expect(rules.at(date).get('income_tax.credits')).toEqual({ taxpayer: 30_840 });
    }
  });
  it('insurance.rates: social 29,2 % of 55 %, health 13,5 % of 50 %', () => {
    for (const date of ['2025-01-01', '2026-12-31']) {
      expect(rules.at(date).get('insurance.rates')).toEqual({
        social_pct: 29.2,
        social_base_pct: 55,
        health_pct: 13.5,
        health_base_pct: 50,
      });
    }
  });
});
```
Command: `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` (all rules tests green, including the existing "every seeded key parses" checks).
4. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.
5. Commit `feat(rules): income_tax and insurance rate seeds 2025–2026 (0352)`.

## 5. Do not touch

`law.ts`, `product.ts`, any other key, `apps/`.

## 6. Commands

`pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] The three keys resolve on any date in 2025 and 2026 with the values above; `RuleMissingError` on 2024-12-31 (the existing seeded-keys test proves it).
- [ ] Report lists each `[verify]` with the page checked and whether the value held.

## 8. Stop and ask

TEMPLATE §8. Also stop if a primary source shows a different number: do not seed a value you could not confirm; seed it with the brief's number and mark `[verify-failed]` in the report.

## 9. Report

`docs/tasks/0352-report.md`.

## Risk list

Every value is money or a tax rate (rule 1).

## Owner steps

1. Read the report's `[verify]` lines; the 2026 threshold (T-18) is an internal computation until the nařízení vlády is checked.
