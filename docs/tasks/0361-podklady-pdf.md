# 0361: Podklady PDF summary (`buildPodkladyPdf`, ≤ 4 pages)

Status: todo
Ticket: P4-POD-04 (PDF) | Depends on: 0359 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 55k tokens

## 1. Objective

A short A4 PDF a layman reads and an accountant trusts (M06 §4.9): header, headline numbers, categories, comparison or paušální daň box, assets/private/pass-through/VAT note, warnings, the "what is not in this summary" checklist and the disclaimer. Whole-Kč amounts (`round0`, half-up). The text content is a pure function (`podkladyPdfLines`) so the test reads lines, not PDF bytes.

## 2. Context

M06 names react-pdf; the repo has no PDF writer in `packages/exports` and rule 7 forbids a new dependency without an owner line. `pdf-lib 1.17.1` is already a dependency of `packages/extraction`, so it is not new to the repo: add `"pdf-lib": "1.17.1"` to `packages/exports/package.json` dependencies (owner step records it). Use `StandardFonts.Helvetica` / `HelveticaBold` (WinAnsi): the copy is English (rule 6), but partner names and descriptions may carry Czech diacritics outside WinAnsi → `transliterate()` them (the map always applies, even to letters WinAnsi has: `č→c, ř→r, ě→e, š→s, ž→z, ý→y, á→a, í→i, é→e, ó→o, ú/ů→u, ď→d, ť→t, ň→n`, upper-case too; any other character outside WinAnsi → `?`). `TODO(decision-pdf-font)`: embedding a Unicode font needs a font file and `@pdf-lib/fontkit` (owner decision).

Layout (M06 §4.9 order): (1) header: legal name, IČO, year, regime, generated date; watermark line when `summary.watermark` (`podklady.watermark`); (2) headline: Income / Expenses (or Flat-rate expenses (rate %)) / Base before adjustments / Advances paid; (3) categories table: label, amount (income, deductible, non-deductible, pass-through, private part); (4) comparison (`podklady.flat.result` + cap + the four caveats) or the paušální daň box (`pd.band_ok|band_exceeded|regime_limit_exceeded`, `pd.advances_*`, `pd.notice`, eligibility lines, `pd.no_return`); (5) assets (date, supplier, price) + `podklady.assets.note`, small assets count, private use (personal count/sum, partial shares), pass-through totals, VAT note text + VAT paid; (6) warnings: readiness + asset warnings; (7) checklist `podklady.section.checklist` + one line per key; (8) footer disclaimer `podklady.disclaimer` on every page. Page size A4 (595.28 × 841.89 pt), margins 48 pt, 10 pt body, 14 pt headings, a new page when `y < 90`; ≤ 4 pages for the S4 fixture.

Amount format: `formatKc(m: Money) = round0(m).toFixed2()` without the decimals, thousands separated by a thin space, e.g. `141 540 Kč`. Labels: the caller passes `t(key, params)` (ICU formatting is the web app's job; tests pass a stub that returns `key` plus a JSON of params).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/exports/package.json` | edit | add `"pdf-lib": "1.17.1"` to `dependencies` (alphabetical) |
| `packages/exports/src/podklady-pdf.ts` | create | `transliterate`, `formatKc`, `podkladyPdfLines`, `buildPodkladyPdf` |
| `packages/exports/src/index.ts` | edit | export the four names |
| `packages/exports/test/podklady-pdf.test.ts` | create | below |

## 4. Steps

1. `pnpm install --filter @shoebox/exports 2>&1 | tail -5` after the package.json edit (lockfile changes are expected; commit them).
2. `podklady-pdf.ts` exports exactly:
```ts
import type { Money, PodkladySummary } from '@shoebox/domain';
export type Translate = (key: string, params?: Record<string, string | number>) => string;
export type PdfLine = { readonly kind: 'h1' | 'h2' | 'text' | 'row' | 'gap' | 'footer'; readonly text: string; readonly value?: string };   // row: text + right-aligned value
export function transliterate(text: string): string;
export function formatKc(m: Money): string;                     // '141 540 Kč'
export function podkladyPdfLines(s: PodkladySummary, t: Translate): PdfLine[];
export function buildPodkladyPdf(s: PodkladySummary, t: Translate): Promise<Uint8Array>;   // pdf-lib, A4, Helvetica
export const PDF_MIME = 'application/pdf';
```
`podkladyPdfLines` emits exactly one `footer` line (the disclaimer; the renderer repeats it on every page) and uses `t('podklady.title', { year })` as the `h1`.
3. Test file verbatim:
```ts
import { buildPodkladySummary, CZK, EMPTY_ANSWERS, Money, createCzRules, parseLegalDate, type PodkladyInput } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { buildPodkladyPdf, formatKc, podkladyPdfLines, transliterate } from '../src/podklady-pdf';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const t = (key: string, params?: Record<string, string | number>) => (params ? `${key}${JSON.stringify(params)}` : key);
let n = 0;
const e = (categoryCode: string, taxEffect: PodkladyInput['entries'][number]['taxEffect'], amount: string) => ({
  entryDate: d('2026-04-10'), taxYear: 2026, basis: 'payment' as const, documentId: `doc-${(n += 1)}`, lineId: `l-${n}`, categoryCode, taxEffect, amountCzk: amount, businessSharePct: '100', businessAmountCzk: amount,
});
const seg = (o: Partial<PodkladyInput['profiles'][number]>) => ({ validFrom: d('2025-01-01'), validTo: null, entityType: 'osvc', taxRegime: 'danova_evidence' as const, vatStatus: 'neplatce' as const, pausalRate: null, pausalDanBand: null, hasAccountant: false, ...o });
const base = (o: Partial<PodkladyInput> = {}): PodkladyInput => ({
  year: 2026, taxpayer: { legalName: 'Tomáš Řehoř', ico: '12345678' }, profiles: [seg({})],
  entries: [e('income_services', 'taxable_income', '1400000.00'), e('exp_material', 'deductible_expense', '400000.00'), e('exp_fuel', 'deductible_expense', '60000.00'), e('exp_telecom', 'deductible_expense', '12000.00'), e('exp_small_assets', 'deductible_expense', '48000.00'), e('exp_representation', 'non_deductible_expense', '4000.00')],
  assetLines: [{ documentId: 'van', lineId: 'van-1', documentNumber: 'F-2026-11', partnerName: 'Škoda Dealer', description: 'Dodávka', issueDate: d('2026-05-12'), paidAt: d('2026-05-12'), categoryCode: 'asset_long_term', net: null, gross: czk('650000.00'), businessSharePct: '100', vatDeducted: false, carFlag: true, paidInYear: czk('650000.00') }],
  privateUse: { personalDocuments: [], partialShareLines: [{ documentId: 'phone', lineId: 'p1', description: 'Telefon', totalCzk: czk('24000.00'), businessSharePct: '50' }], carRegimeAnswers: [] },
  vatFilings: [], transactions: [{ categoryCode: 'tax_income_payment', bookedOn: d('2026-06-15'), amount: czk('-15000.00') }],
  readiness: { ledger: { staleEntries: 0, documentsFinalizedAfterBuild: 0 }, pendingDocuments: 0, unpaidIssued: 1, unexplainedTransactions: { count: 0, sum: czk('0') }, businessFlagUnknown: { count: 0, sum: czk('0') } },
  answers: { ...EMPTY_ANSWERS, comparisonRate: 80 }, partialXmlAvailable: false, ...o,
});

describe('podkladyPdfLines S2 (M06 §9 general 2)', () => {
  const lines = podkladyPdfLines(buildPodkladySummary(base(), rules, d('2027-02-10')), t);
  const texts = lines.map((l) => `${l.text}${l.value ? ` | ${l.value}` : ''}`);
  it('headline rows in whole Kč: income 1 400 000, expenses 520 000, base 880 000, advances 15 000', () => {
    expect(texts).toContain('podklady.headline.income | 1 400 000 Kč');
    expect(texts).toContain('podklady.headline.expenses | 520 000 Kč');
    expect(texts).toContain('podklady.headline.base | 880 000 Kč');
    expect(texts).toContain('podklady.headline.advances | 15 000 Kč');
  });
  it('comparison line with the 600 000 difference, the cap line absent, the four caveats present', () => {
    expect(texts.some((x) => x.startsWith('podklady.flat.result') && x.includes('"difference":"600 000 Kč"') && x.includes('"direction":"podklady.flat.lower"'))).toBe(true);
    expect(texts.some((x) => x.startsWith('podklady.flat.cap'))).toBe(false);
    for (const k of ['depreciation', 'insurance', 'credits_35ca', 'switching']) expect(texts).toContain(`podklady.flat.caveat.${k}`);
  });
  it('assets, private use, warnings, checklist (DE: depreciation and car present, accommodation absent), one footer disclaimer', () => {
    expect(texts.some((x) => x.includes('Skoda Dealer') && x.includes('650 000 Kč'))).toBe(true);
    expect(texts).toContain('podklady.assets.note');
    expect(texts.some((x) => x.includes('Telefon') && x.includes('12 000 Kč'))).toBe(true);
    expect(texts.some((x) => x.startsWith('podklady.readiness.P_UNPAID_ISSUED'))).toBe(true);
    for (const k of ['credits', 'deductions', 'other_income', 'depreciation', 'car', 'base_adjustments', 'advances_paid', 'insurance_reports', 'missing_documents']) expect(texts).toContain(`podklady.checklist.${k}`);
    expect(texts).not.toContain('podklady.checklist.accommodation');
    expect(lines.filter((l) => l.kind === 'footer')).toEqual([{ kind: 'footer', text: 'podklady.disclaimer' }]);
    expect(lines[0]).toEqual({ kind: 'h1', text: 'podklady.title{"year":2026}' });
  });
  it('paušální daň user gets the pd block instead of the comparison', () => {
    const pd = podkladyPdfLines(buildPodkladySummary(base({ profiles: [seg({ taxRegime: 'pausalni_dan', pausalRate: 60, pausalDanBand: 1 })], entries: [e('income_services', 'taxable_income', '850000.00')], transactions: [] }), rules, d('2027-02-10')), t).map((l) => l.text);
    expect(pd.some((x) => x.startsWith('pd.band_ok'))).toBe(true);
    expect(pd.some((x) => x.startsWith('pd.advances_missing'))).toBe(true);
    expect(pd.some((x) => x.startsWith('pd.no_return'))).toBe(true);
    expect(pd.some((x) => x.startsWith('podklady.flat.result'))).toBe(false);
  });
});

describe('helpers and bytes', () => {
  it('formatKc rounds half-up to whole Kč with thin-space thousands', () => {
    expect([formatKc(czk('141540.19')), formatKc(czk('98459.81')), formatKc(czk('0.50')), formatKc(czk('-302.00'))]).toEqual(['141 540 Kč', '98 460 Kč', '1 Kč', '-302 Kč']);
  });
  it('transliterate maps Czech diacritics and replaces anything else outside WinAnsi', () => {
    expect(transliterate('Příliš žluťoučký kůň ÚPĚL ďábelské ódy – 10 €')).toBe('Prilis zlutoucky kun UPEL dabelske ody – 10 €');
    expect(transliterate('東京')).toBe('??');
  });
  it('buildPodkladyPdf: a PDF with at most 4 pages that contains the footer text', async () => {
    const bytes = await buildPodkladyPdf(buildPodkladySummary(base(), rules, d('2027-02-10')), t);
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 8));
    expect(head.startsWith('%PDF-1.')).toBe(true);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeLessThanOrEqual(4);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
```
Command: `pnpm --filter @shoebox/exports test -- podklady-pdf 2>&1 | tail -30`. (`–` and `€` are in WinAnsi, keep them.)
4. Index exports; `pnpm --filter @shoebox/exports typecheck 2>&1 | tail -30`.
5. Commit `feat(exports): podklady PDF summary with pdf-lib (0361)`.

## 5. Do not touch

`xlsx.ts`, `zip.ts`, domain functions, `apps/`.

## 6. Commands

`pnpm --filter @shoebox/exports test -- podklady-pdf 2>&1 | tail -30` · `pnpm --filter @shoebox/exports typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Every headline number is whole Kč (general 1); every checklist key of the regime and the disclaimer are in the lines (general 2); ≤ 4 pages.

## 8. Stop and ask

TEMPLATE §8. Stop if `pnpm install` tries to change any other package's lockfile entries beyond adding pdf-lib to exports.

## 9. Report

`docs/tasks/0361-report.md`. Include the page count of the S2 fixture.

## Risk list

`formatKc` (rounding shown to the user); the dependency add.

## Owner steps

1. Decisions line: "2026-10-26 [deps] pdf-lib 1.17.1 in packages/exports (already in extraction); Helvetica + transliteration until a Unicode font is chosen (TODO(decision-pdf-font))".
2. Later: choose a font file (e.g. the UI's Inter TTF) so Czech names render with diacritics; that is a separate small brief.
