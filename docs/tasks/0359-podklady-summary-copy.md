# 0359: `buildPodkladySummary` + the podklady copy (en.json)

Status: todo
Ticket: P4-POD-04 (summary) | Depends on: 0353, 0354, 0355, 0356, 0357 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 22 tool calls, 60k tokens

## 1. Objective

One pure function that assembles everything the PDF, the XLSX, the preview API and the partial XML read (M06 §6 `buildPodkladySummary`), plus every English string the podklady use (rule 6: `en.json` only, `cs.json` dormant, M06's Czech copy is a documented contradiction → `TODO(i18n-cs)`). This brief owns all `podklady.*`, `pd.*`, `reserve.*` and `asset.*` keys; later briefs add none.

## 2. Context

M06 §4.9 headline block ("Hlavní čísla"): income, expenses (or flat-rate), difference ("base before adjustments"), advances paid. Regime of the year = the segment covering `⟨year⟩-12-31` (else the last segment in the year). Composition:

- `totals = computeAnnualTotals(entries, year)` (0353). `readiness = checkPodkladyReadiness({ year, profiles, ...input.readiness }, today)`; `blocked = isBlocked(readiness)`; `watermark = readiness has P_YEAR_OPEN`.
- `flatRate` (0355): `danova_evidence` → rate `answers.comparisonRate ?? 60`; `pausalni_vydaje` → `profile.pausalRate ?? answers.comparisonRate ?? 60`; `pausalni_dan` → `null`. `income = totals.incomeTotal`, `actual = totals.deductibleTotal`.
- `pausalniDan` (0356) only for `pausalni_dan`: `band = pausalDanBand ?? 1`, `activityClass = pausalRate ?? answers.activityClass ?? 60`, `months` = months of the year covered by paušál segments, `advances` = transactions with `categoryCode='tax_pausal_advance'`.
- `assets = listAssets(assetLines, rules, year)` (0357), `privateUse = summarizePrivateUse(...)`, `vatNote = buildVatNote({ year, segments: profiles, vatPayments: Σ |tax_vat_payment| in year, vatFilings, domesticCashIncome: totals.incomeTotal }, rules)` (the income total approximates domestic cash turnover: comment `TODO(decision-vat-turnover)`).
- `payments`: transactions of the year grouped by `categoryCode` (`tax_vat_payment`, `tax_income_payment`, `tax_pausal_advance`, `ins_social_own`, `ins_health_own`, `tax_other_fees`), `byMonth[0..11]` absolute sums, `total`. `advancesPaid` = total of `tax_income_payment` (+ `tax_pausal_advance` for paušál users).
- `headline`: DE → `{ income: round0(incomeTotal), expenses: round0(deductibleTotal), base: flatRate.baseActual, label: 'actual' }`; PV → `{ income, expenses: flatRate.flat, base: flatRate.baseFlat, label: 'flat' }`; PD → `{ income, expenses: zero, base: round0(income), label: 'pausalni_dan' }`.
- `checklistKeys` (M06 §4.9, regime-filtered, this order): `podklady.checklist.credits`, `.deductions`, `.other_income`, `.depreciation` (DE only), `.car` (DE only), `.base_adjustments`, `.advances_paid`, `.insurance_reports`, `.accommodation` (only when `totals.income` has `income_accommodation`), `.missing_documents`.
- `partialXmlEligible = input.partialXmlAvailable && (regime === 'pausalni_vydaje' || (regime === 'pausalni_dan' && pausalniDan.returnRequired))` (decisions 2026-10-18: never DE). `noReturnKey = 'pd.no_return'` for PD without `returnRequired`, else `null`. `disclaimerKey = 'podklady.disclaimer'`.
- Year with no entries and no transactions → `empty: true` (the card is not shown; preview says `podklady.no_data`).

`en.json` is a flat map of ICU strings (`packages/i18n/messages/en.json`); `pnpm --filter @shoebox/i18n test` checks ICU syntax. Add the keys in one alphabetical block at the end of the file (before the closing brace), keeping valid JSON.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/income-tax/summary.ts` | create | `PodkladyInput`, `PodkladySummary`, `CHECKLIST_KEYS`, `buildPodkladySummary` |
| `packages/domain/test/podklady-summary.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append `export * from './income-tax/summary';` |
| `packages/i18n/messages/en.json` | edit | the keys in step 3 |

## 4. Steps

1. `summary.ts` exports exactly:
```ts
export interface PodkladyTransaction { readonly categoryCode: string; readonly bookedOn: LegalDate; readonly amount: Money }
export interface PodkladyInput {
  readonly year: number; readonly taxpayer: { readonly legalName: string; readonly ico: string | null };
  readonly profiles: readonly ProfileSegment[]; readonly entries: readonly AnnualTotalsEntry[];
  readonly assetLines: readonly AssetLineInput[]; readonly privateUse: PrivateUseInput;
  readonly vatFilings: VatNoteInput['vatFilings']; readonly transactions: readonly PodkladyTransaction[];
  readonly readiness: Omit<ReadinessInput, 'year' | 'profiles'>; readonly answers: PodkladyAnswers;
  readonly partialXmlAvailable: boolean;
}
export interface PaymentsByCategory { readonly categoryCode: string; readonly total: Money; readonly byMonth: readonly Money[] }   // 12 entries
export interface PodkladyHeadline { readonly income: Money; readonly expenses: Money; readonly base: Money; readonly label: 'actual' | 'flat' | 'pausalni_dan' }
export const CHECKLIST_KEYS = ['podklady.checklist.credits', 'podklady.checklist.deductions', 'podklady.checklist.other_income', 'podklady.checklist.depreciation', 'podklady.checklist.car', 'podklady.checklist.base_adjustments', 'podklady.checklist.advances_paid', 'podklady.checklist.insurance_reports', 'podklady.checklist.accommodation', 'podklady.checklist.missing_documents'] as const;
export interface PodkladySummary {
  readonly year: number; readonly generatedOn: LegalDate; readonly taxpayer: PodkladyInput['taxpayer']; readonly empty: boolean;
  readonly regime: TaxRegime; readonly segments: readonly ProfileSegment[]; readonly watermark: boolean;
  readonly readiness: readonly ReadinessCheck[]; readonly blocked: boolean;
  readonly totals: AnnualTotals; readonly headline: PodkladyHeadline;
  readonly flatRate: FlatRateComparison | null; readonly pausalniDan: PausalniDanCheck | null;
  readonly assets: AssetLists; readonly privateUse: PrivateUseSummary; readonly vatNote: VatNote;
  readonly payments: readonly PaymentsByCategory[]; readonly advancesPaid: Money;
  readonly checklistKeys: readonly string[]; readonly disclaimerKey: 'podklady.disclaimer';
  readonly partialXmlEligible: boolean; readonly noReturnKey: 'pd.no_return' | null;
}
export function buildPodkladySummary(input: PodkladyInput, rules: CzRules, today: LegalDate): PodkladySummary;
```
2. Test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { EMPTY_ANSWERS } from '../src/income-tax/answers';
import type { ProfileSegment } from '../src/income-tax/readiness';
import { buildPodkladySummary, CHECKLIST_KEYS, type PodkladyInput } from '../src/income-tax/summary';
import type { AnnualTotalsEntry } from '../src/income-tax/totals';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const f = (m: Money) => m.toFixed2();
let n = 0;
const e = (categoryCode: string, taxEffect: AnnualTotalsEntry['taxEffect'], amount: string, share = '100', business = amount): AnnualTotalsEntry => ({
  entryDate: d('2026-04-10'), taxYear: 2026, basis: 'payment', documentId: `doc-${(n += 1)}`, lineId: `l-${n}`, categoryCode, taxEffect, amountCzk: amount, businessSharePct: share, businessAmountCzk: business,
});
const seg = (o: Partial<ProfileSegment> = {}): ProfileSegment => ({ validFrom: d('2025-01-01'), validTo: null, entityType: 'osvc', taxRegime: 'danova_evidence', vatStatus: 'neplatce', pausalRate: null, pausalDanBand: null, hasAccountant: true, ...o });
const tx = (categoryCode: string, amount: string, bookedOn: string) => ({ categoryCode, bookedOn: d(bookedOn), amount: czk(amount) });
const base = (o: Partial<PodkladyInput> = {}): PodkladyInput => ({
  year: 2026, taxpayer: { legalName: 'Tomáš Novák', ico: '12345678' }, profiles: [seg()], entries: [], assetLines: [],
  privateUse: { personalDocuments: [], partialShareLines: [], carRegimeAnswers: [] }, vatFilings: [], transactions: [],
  readiness: { ledger: { staleEntries: 0, documentsFinalizedAfterBuild: 0 }, pendingDocuments: 0, unpaidIssued: 0, unexplainedTransactions: { count: 0, sum: czk('0') }, businessFlagUnknown: { count: 0, sum: czk('0') } },
  answers: EMPTY_ANSWERS, partialXmlAvailable: true, ...o,
});
const s2 = base({
  entries: [e('income_services', 'taxable_income', '1400000.00'), e('exp_material', 'deductible_expense', '400000.00'), e('exp_fuel', 'deductible_expense', '60000.00'), e('exp_telecom', 'deductible_expense', '24000.00', '50', '12000.00'), e('exp_small_assets', 'deductible_expense', '48000.00'), e('exp_representation', 'non_deductible_expense', '4000.00'), e('asset_long_term', 'asset', '650000.00')],
  transactions: [...Array.from({ length: 12 }, (_, i) => tx('ins_social_own', '5005.00', `2026-${String(i + 1).padStart(2, '0')}-08`)), tx('ins_health_own', '3306.00', '2026-01-08'), tx('tax_income_payment', '15000.00', '2026-06-15')],
  answers: { ...EMPTY_ANSWERS, comparisonRate: 80 },
});

describe('buildPodkladySummary S2 (danova_evidence, closed year)', () => {
  const s = buildPodkladySummary(s2, rules, d('2027-02-10'));
  it('headline actual: income 1 400 000, expenses 520 000, base 880 000; advances paid 15 000; not watermarked', () => {
    expect([f(s.headline.income), f(s.headline.expenses), f(s.headline.base), s.headline.label]).toEqual(['1400000.00', '520000.00', '880000.00', 'actual']);
    expect([f(s.advancesPaid), s.watermark, s.blocked, s.empty, s.regime, s.generatedOn]).toEqual(['15000.00', false, false, false, 'danova_evidence', '2027-02-10']);
  });
  it('flat-rate comparison at the answered 80 %: better flat by 600 000; no paušální daň block; XML never for DE', () => {
    expect([s.flatRate?.rate, s.flatRate?.better, f(s.flatRate?.difference ?? czk('0'))]).toEqual([80, 'flat', '600000.00']);
    expect([s.pausalniDan, s.partialXmlEligible, s.noReturnKey]).toEqual([null, false, null]);
  });
  it('payments by category and month; social has 12 months of 5 005', () => {
    const social = s.payments.find((p) => p.categoryCode === 'ins_social_own');
    expect([f(social?.total ?? czk('0')), social?.byMonth.length, f(social?.byMonth[11] ?? czk('0'))]).toEqual(['60060.00', 12, '5005.00']);
    expect(s.payments.map((p) => p.categoryCode)).toEqual(['ins_health_own', 'ins_social_own', 'tax_income_payment']);
  });
  it('checklist for DE includes depreciation and car, excludes accommodation; disclaimer key fixed', () => {
    expect(s.checklistKeys).toEqual(CHECKLIST_KEYS.filter((k) => k !== 'podklady.checklist.accommodation'));
    expect(s.disclaimerKey).toBe('podklady.disclaimer');
  });
});

describe('other regimes and states', () => {
  it('S3 pausalni_vydaje 60 %: headline flat (expenses 1 200 000 capped, base 2 300 000); XML eligible', () => {
    const s = buildPodkladySummary(base({ profiles: [seg({ taxRegime: 'pausalni_vydaje', pausalRate: 60, vatStatus: 'platce' })], entries: [e('income_services', 'taxable_income', '3500000.00'), e('exp_material', 'deductible_expense', '2900000.00')] }), rules, d('2027-02-10'));
    expect([f(s.headline.expenses), f(s.headline.base), s.headline.label, s.partialXmlEligible, s.vatNote.kind]).toEqual(['1200000.00', '2300000.00', 'flat', true, 'payer']);
    expect(s.checklistKeys).not.toContain('podklady.checklist.depreciation');
    expect(buildPodkladySummary(base({ profiles: [seg({ taxRegime: 'pausalni_vydaje', pausalRate: 60 })], entries: [e('income_services', 'taxable_income', '1.00')], partialXmlAvailable: false }), rules, d('2027-02-10')).partialXmlEligible).toBe(false);
  });
  it('S1 pausalni_dan: paušální daň block, no flat rate, no return, XML not offered; with a band breach the XML is offered', () => {
    const pd = seg({ taxRegime: 'pausalni_dan', pausalRate: 60, pausalDanBand: 1, vatStatus: 'identifikovana_osoba' });
    const advances = Array.from({ length: 12 }, (_, i) => tx('tax_pausal_advance', '9162.00', `2026-${String(i + 1).padStart(2, '0')}-15`));
    const s = buildPodkladySummary(base({ profiles: [pd], entries: [e('income_services', 'taxable_income', '850000.00')], transactions: advances }), rules, d('2027-01-05'));
    expect([s.flatRate, s.pausalniDan?.fitBand, f(s.pausalniDan?.paid ?? czk('0')), s.noReturnKey, s.partialXmlEligible, s.headline.label, f(s.advancesPaid)]).toEqual([null, 1, '109944.00', 'pd.no_return', false, 'pausalni_dan', '109944.00']);
    const breach = buildPodkladySummary(base({ profiles: [pd], entries: [e('income_services', 'taxable_income', '1600000.00')] }), rules, d('2027-01-05'));
    expect([breach.pausalniDan?.returnRequired, breach.partialXmlEligible, breach.noReturnKey]).toEqual([true, true, null]);
  });
  it('open year is watermarked; ucetnictvi is blocked; accommodation income adds its checklist key; no data → empty', () => {
    const open = buildPodkladySummary(base({ entries: [e('income_accommodation', 'taxable_income', '1000.00')] }), rules, d('2026-10-26'));
    expect([open.watermark, open.checklistKeys.includes('podklady.checklist.accommodation')]).toEqual([true, true]);
    expect(buildPodkladySummary(base({ profiles: [seg({ taxRegime: 'ucetnictvi' })] }), rules, d('2027-02-10')).blocked).toBe(true);
    expect(buildPodkladySummary(base(), rules, d('2027-02-10')).empty).toBe(true);
  });
  it('regime of the year is the segment covering 31 December', () => {
    const s = buildPodkladySummary(base({ profiles: [seg({ validTo: d('2026-06-30') }), seg({ validFrom: d('2026-07-01'), taxRegime: 'pausalni_vydaje', pausalRate: 60 })], entries: [e('income_services', 'taxable_income', '100.00')] }), rules, d('2027-02-10'));
    expect([s.regime, s.readiness.map((c) => c.code)]).toEqual(['pausalni_vydaje', ['P_REGIME_CHANGED']]);
  });
});
```
Command: `pnpm --filter @shoebox/domain test -- podklady-summary 2>&1 | tail -30`.
3. `en.json`: add exactly these keys (values are the English copy; lane D and the PDF/XLSX use them):
```
"podklady.disclaimer": "This is not a tax return. It is a summary of the documents in the app. You or your accountant file the return."
"podklady.watermark": "Interim figures as of {date}"
"podklady.no_data": "We have no documents for {year}."
"podklady.changed_after_handoff": "The summary has changed since you handed it over: {diff}"
"podklady.title": "Income-tax summary for {year}"
"podklady.headline.income": "Income"
"podklady.headline.expenses": "Expenses"
"podklady.headline.expenses_flat": "Flat-rate expenses ({rate} %)"
"podklady.headline.base": "Base before adjustments"
"podklady.headline.advances": "Advances paid"
"podklady.section.categories": "By category"
"podklady.section.comparison": "Flat rate vs actual expenses"
"podklady.section.pausalni_dan": "Flat-rate tax"
"podklady.section.assets": "Assets and private use"
"podklady.section.warnings": "What to check"
"podklady.section.checklist": "What is not in this summary"
"podklady.flat.result": "With the {rate} % flat rate the tax base would be {difference} Kč {direction} than with actual expenses."
"podklady.flat.lower": "lower"
"podklady.flat.higher": "higher"
"podklady.flat.equal": "The flat rate and actual expenses give the same base."
"podklady.flat.cap": "The flat rate is capped at {cap} Kč – you have reached the limit."
"podklady.flat.caveat.depreciation": "Actual expenses here exclude depreciation of assets and car allowances."
"podklady.flat.caveat.insurance": "Your own social and health insurance is never an expense."
"podklady.flat.caveat.credits_35ca": "With flat-rate expenses above half of your total base you may lose the spouse credit and the child benefit (§ 35ca)."
"podklady.flat.caveat.switching": "Switching between the two methods has consequences – ask your accountant."
"pd.band_ok": "Income of {income} Kč fits band {band} (limit {limit} Kč)."
"pd.band_exceeded": "Income of {income} Kč exceeded the limit of band {band} ({limit} Kč). Ask your accountant."
"pd.regime_limit_exceeded": "Income of {income} Kč exceeded the flat-rate tax limit of {limit} Kč. Ask your accountant."
"pd.lower_band_possible": "Band {band} may be enough next year."
"pd.advances_ok": "Advances: paid {paid} Kč, due {expected} Kč. All good."
"pd.advances_missing": "{delta} Kč still to pay."
"pd.advances_overpaid": "Overpaid by {delta} Kč."
"pd.eligibility.intro": "You may not meet the flat-rate regime conditions: {reason}. Then a tax return is required – ask your accountant."
"pd.eligibility.vat_payer": "you were a VAT payer during the year"
"pd.eligibility.other_income": "other income above {limit} Kč"
"pd.eligibility.employment": "employment beyond the DPP/DPČ limits"
"pd.eligibility.insolvency": "insolvency or a partnership in a v.o.s./k.s."
"pd.notice": "Until {date} you can change the band or leave the regime."
"pd.entry_notice": "Until {date} you can give notice to enter the flat-rate regime."
"pd.no_return": "For {year} you do not file a return if the conditions held all year."
"podklady.dap.note.standard": "Electronic filing by {due}; on paper by 1 April."
"podklady.dap.note.advisor": "Electronic filing by {due}; with a tax advisor by 1 July."
"podklady.readiness.P_YEAR_OPEN": "The year is not over; figures are interim as of {date}."
"podklady.readiness.P_REGIME_UNSUPPORTED": "We do not prepare the summary for double-entry accounting – hand the export to your accountant."
"podklady.readiness.P_REGIME_CHANGED": "Your tax regime changed during the year ({regimes}); figures are split per period."
"podklady.readiness.P_LEDGER_STALE": "Recalculating…"
"podklady.readiness.P_PENDING_DOCUMENTS": "{count, plural, one {# document is} other {# documents are}} waiting for review."
"podklady.readiness.P_UNPAID_ISSUED": "{count, plural, one {# issued invoice has} other {# issued invoices have}} no payment – we do not count them as income."
"podklady.readiness.P_UNEXPLAINED_TX": "{count, plural, one {# payment} other {# payments}} without a document ({sum} Kč)."
"podklady.readiness.P_BUSINESS_FLAG_UNKNOWN": "{count, plural, one {# document} other {# documents}} not yet marked business or private ({sum} Kč)."
"podklady.vat.payer": "Income and expenses are without VAT."
"podklady.vat.io": "VAT you pay as an identified person on purchases from abroad cannot be deducted; for income tax it is usually an expense – your accountant confirms."
"podklady.vat.none": "You are not registered for VAT; amounts include VAT."
"podklady.vat.mixed": "Your VAT status changed during the year; see the periods."
"podklady.vat.registration_warning": "Turnover exceeded the VAT registration threshold."
"podklady.assets.note": "Depreciation is calculated by your accountant. It is not in this summary."
"asset.maybe_misclassified": "{price} Kč is above the asset threshold ({threshold} Kč) – should this be an asset?"
"asset.below_threshold": "{price} Kč is below the asset threshold ({threshold} Kč) – should this be an expense?"
"podklady.checklist.credits": "Tax credits (e.g. the taxpayer credit) and the child benefit."
"podklady.checklist.deductions": "Deductible items (donations, mortgage interest, pension and life insurance…)."
"podklady.checklist.other_income": "Other income: employment (§ 6), capital (§ 8), rental (§ 9), other (§ 10), foreign income."
"podklady.checklist.depreciation": "Depreciation of the assets in the Assets list."
"podklady.checklist.car": "Car: flat-rate transport allowance or actual costs, private-use reduction."
"podklady.checklist.base_adjustments": "Base adjustments (rows 103/104), losses from earlier years."
"podklady.checklist.advances_paid": "Income-tax advances paid (row 85) and flat-rate tax paid (row 86) – we list what we found in payments; you confirm."
"podklady.checklist.insurance_reports": "Social (ČSSZ) and health-insurance annual reports – not prepared by the app."
"podklady.checklist.accommodation": "Accommodation income: § 7 or § 9 – your accountant decides."
"podklady.checklist.missing_documents": "Documents missing in the app ({count})."
"podklady.card.view": "View"
"podklady.card.pdf": "Download PDF"
"podklady.card.xlsx": "Download XLSX"
"podklady.card.mark_filed": "Handed to the accountant / filed"
"podklady.xml.dialog": "Do you also want the file for MOJE daně? We fill in only the header and the income{pvPart}. You complete the rest on MOJE daně."
"podklady.xml.pv_part": " and the flat-rate expenses"
"podklady.xml.rc_label": "Personal identification number (rodné číslo) – we do not store it"
"podklady.xml.unavailable": "We do not prepare the file for {year} yet."
"reserve.label": "Estimated amount to set aside for tax and insurance"
"reserve.badge": "estimate"
"reserve.how": "We count only the documents and payments in the app since 1 January. We do not include credits other than the taxpayer credit, deductions, depreciation or other income. The real tax will differ."
"reserve.pausalni_dan": "Flat-rate tax advances: paid {paid} of {due} Kč"
```
Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`.
4. Index export; `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.
5. Commit `feat(income-tax): buildPodkladySummary + podklady copy (0359)`.

## 5. Do not touch

The functions of 0353–0357 (compose them, do not patch them: if one lacks something, stop and ask), `cs.json`, `apps/`.

## 6. Commands

`pnpm --filter @shoebox/domain test -- podklady-summary 2>&1 | tail -30` · `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] S2 headline 1 400 000 / 520 000 / 880 000; S3 flat 1 200 000 / 2 300 000; S1 109 944 and `pd.no_return`; every key above exists in `en.json` and the i18n test is green.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0359-report.md`.

## Risk list

`headline` numbers (shown first on every output).

## Owner steps

1. Decisions line: "2026-10-26 podklady copy in English (rule 6), Czech in `later/` when cs.json wakes; checklist wording per M06 §4.9".
