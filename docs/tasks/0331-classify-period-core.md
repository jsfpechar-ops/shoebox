# 0331: `classifyPeriod` core: types, verdict precedence, needs_accountant checks

Status: todo
Ticket: P3-VAT-03 (part a) | Depends on: 0328 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

The pure simple-period classifier skeleton: input/output types stored verbatim in `filings.simple_check`, verdict precedence `needs_accountant > not_ready > nothing_to_file > simple`, and all checks whose outcome is `needs_accountant` (plus TA-11). Brief 0332 adds the `not_ready` checks into the same registry.

## 2. Context

M05 §4.3 (pasted). Output:
```ts
{ verdict: 'simple' | 'not_ready' | 'needs_accountant' | 'nothing_to_file',
  checks: Array<{ code: SimpleCheckCode; outcome: 'pass' | 'not_ready' | 'needs_accountant'; documentIds: string[]; params: Record<string, string | number> }>,
  policyVersion: string, rulesDate: string, evaluatedAt: string }
```
`verdict` = `needs_accountant` if any check is `needs_accountant`; else `not_ready` if any is `not_ready`; else `nothing_to_file` if IO and no entry with `dphdp3Rows ∩ {3..13}` and no SH entry; else `simple`. All checks always run; every code appears exactly once in `checks` (outcome `pass` when nothing matched, `documentIds: []`, `params: {}`).

| Code | Condition | Outcome |
|---|---|---|
| `S_PROFILE_UNSUPPORTED` | status not in (`platce`, `identifikovana_osoba`), or `entityType ≠ 'osvc'` (any profile version overlapping the period) | needs_accountant |
| `S_PROFILE_CHANGED_IN_PERIOD` | `vatStatus` or `vatPeriod` differs between two profile versions overlapping the period | needs_accountant |
| `S_ENTRY_BEFORE_STATUS` | an entry's `vatPointDate` precedes the earliest profile version with an IO/payer status (`params.earliest`) | not_ready |
| `S_TREATMENT_NOT_ALLOWED` | an entry's treatment not in `policy.allowed_treatments[status]` (`params.treatment` = first offender) | needs_accountant |
| `S_RC_COMMODITY` | any line with `rcCommodityCode` not null | needs_accountant |
| `S_FORBIDDEN_CLASS` | document class in `policy.forbid_document_classes` or a line type in `policy.forbid_line_types` | needs_accountant |
| `S_EU_GOODS_MULTI_RATE` | an `rcv_eu_goods_acquisition` document has more distinct `vatRateType`s among its entries than `policy.max_rates_per_eu_goods_document` | needs_accountant |
| `S_PRIOR_PERIOD_CREDIT_NOTE` | a credit note (class `*_credit_note`) in the period `corrects` a document whose `vatPointDate` is before `period.start` | needs_accountant |
| `S_PARTIAL_SHARE_DEDUCTION` | payer: a line with treatment `rcv_domestic_vat` or self-assessed (`rcv_eu_service_reverse_charge`, `rcv_non_eu_service_reverse_charge`, `rcv_eu_goods_acquisition`) and `0 < businessSharePct < 100` | needs_accountant |
| `S_PLATFORM_INCOME_PAYER` | payer: a `platform_statement` document with a line whose category is `taxable_income`-like (`categoryCode` starts with `income_`) and `linkedIssuedInvoiceId === null` | needs_accountant |
| `S_IO_OUTPUT_VAT` | IO: any line with treatment `iss_domestic_vat`, `iss_eu_service`, `iss_eu_goods`, `iss_non_eu_service` | needs_accountant |
| `S_MAX_DOCS` | VAT-relevant documents (documents with ≥ 1 entry) in period > `policy.max_docs` (`params.count`, `params.max`) | needs_accountant |
| `S_IO_NEGATIVE_TAX` | IO: Σ `vatCzk` over entries with a row in 3..13 is negative (TA-11 default; `TODO(decision-TA-11)`) | needs_accountant |

`entry.dphdp3Rows` ∩ {3..13} means a row string in `['3','4','5','6','9','10','11','12','13']`. SH entry = `shvCode !== null`. Policy: `rules.at(period.start).get('vat.simple_period_policy')`, parsed with the strict schema below (the law schema is loose). `rulesDate` = `period.start`. Existing types: `VatLedgerEntryDraft`, `BusinessFlag` (`../vat/ledger`), `DocumentClass`, `DocumentStatus`, `TaxDocStatus`, `LineType`, `VatTreatment`, `VatRateType`, `VatStatus`, `VatPeriod` (`../enums/index`), `LegalDate` (`../dates/index`), `CzRules` (0330 `../vat/period`), `CZ_SIMPLE_PERIOD_POLICY` (0328).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/classify-period.ts` | create | types, policy schema, registry, `classifyPeriod` |
| `packages/domain/src/vat/checks-accountant.ts` | create | the 13 checks above as `SimpleCheckFn`s |
| `packages/domain/test/classify-period.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append `export * from './vat/classify-period';` |

## 4. Steps

1. `classify-period.ts` exports exactly:
```ts
export type SimpleCheckCode =
  | 'S_PROFILE_UNSUPPORTED' | 'S_PROFILE_CHANGED_IN_PERIOD' | 'S_ENTRY_BEFORE_STATUS' | 'S_TREATMENT_NOT_ALLOWED' | 'S_RC_COMMODITY' | 'S_FORBIDDEN_CLASS'
  | 'S_EU_GOODS_MULTI_RATE' | 'S_PRIOR_PERIOD_CREDIT_NOTE' | 'S_PARTIAL_SHARE_DEDUCTION' | 'S_PLATFORM_INCOME_PAYER' | 'S_IO_OUTPUT_VAT' | 'S_MAX_DOCS' | 'S_IO_NEGATIVE_TAX'
  | 'S_PENDING_DOCUMENTS' | 'S_BLOCKING_VALIDATION' | 'S_BUSINESS_FLAG_UNKNOWN' | 'S_FX_MISSING' | 'S_DATE_MISSING' | 'S_SELF_ASSESSED_RATE_UNKNOWN' | 'S_MIXED_TREATMENT_SAME_RATE'
  | 'S_KH_DIC_MISSING' | 'S_KH_EVIDENCE_NUMBER_MISSING' | 'S_DOMESTIC_NOT_TAX_DOC' | 'S_SH_VAT_ID_INVALID';
export type SimpleOutcome = 'pass' | 'not_ready' | 'needs_accountant';
export interface SimpleCheck { readonly code: SimpleCheckCode; readonly outcome: SimpleOutcome; readonly documentIds: string[]; readonly params: Record<string, string | number> }
export type SimpleVerdict = 'simple' | 'not_ready' | 'needs_accountant' | 'nothing_to_file';
export interface SimpleCheckResult { readonly verdict: SimpleVerdict; readonly checks: SimpleCheck[]; readonly policyVersion: string; readonly rulesDate: string; readonly evaluatedAt: string }
export interface PeriodLine { readonly lineType: LineType; readonly vatTreatment: VatTreatment | null; readonly vatRateType: VatRateType; readonly businessSharePct: string; readonly rcCommodityCode: string | null; readonly categoryCode: string | null; readonly linkedIssuedInvoiceId: string | null }
export interface PeriodDocument { readonly documentId: string; readonly class: DocumentClass; readonly status: DocumentStatus; readonly taxDocStatus: TaxDocStatus; readonly businessFlag: BusinessFlag; readonly vatPointDate: LegalDate | null; readonly correctsDocumentId: string | null; readonly correctsVatPointDate: LegalDate | null; readonly partner: { readonly dic: string | null; readonly vatId: string | null; readonly vatIdValid: boolean | null; readonly documentShowsDic: boolean }; readonly lines: readonly PeriodLine[]; readonly hasBlockingValidation: boolean }
export interface ProfileVersion { readonly validFrom: LegalDate; readonly validTo: LegalDate | null; readonly vatStatus: VatStatus; readonly vatPeriod: VatPeriod | null; readonly entityType: 'osvc' | 'sro' }
export interface LedgerIssueRef { readonly code: 'S_FX_MISSING' | 'S_DATE_MISSING' | 'S_SELF_ASSESSED_RATE_UNKNOWN' | 'S_MIXED_TREATMENT_SAME_RATE'; readonly documentId: string }
export interface PeriodClassifierInput { readonly status: VatStatus; readonly period: { readonly start: LegalDate; readonly end: LegalDate }; readonly entries: readonly VatLedgerEntryDraft[]; readonly documents: readonly PeriodDocument[]; readonly profiles: readonly ProfileVersion[]; readonly ledgerIssues: readonly LedgerIssueRef[]; readonly evaluatedAt: string }
export const SimplePeriodPolicySchema: z.ZodType<SimplePeriodPolicy>;   // strict version of 0328's shape (version, allowed_treatments{identifikovana_osoba, platce}, forbid_document_classes, forbid_line_types, max_docs, max_rates_per_eu_goods_document, allow_partial_business_share_on_deduction, allow_prior_period_credit_notes)
export interface SimpleCheckContext { readonly input: PeriodClassifierInput; readonly policy: SimplePeriodPolicy; readonly isPayer: boolean; readonly isIo: boolean; readonly entriesByDocument: ReadonlyMap<string, readonly VatLedgerEntryDraft[]>; readonly docsById: ReadonlyMap<string, PeriodDocument> }
export type SimpleCheckFn = (ctx: SimpleCheckContext) => Omit<SimpleCheck, 'code'> | null;   // null = pass
export const RETURN_ROWS_3_13: ReadonlySet<string>;
export const SIMPLE_CHECKS: ReadonlyArray<readonly [SimpleCheckCode, SimpleCheckFn]>;   // order = the code list above; 0332 fills the not_ready half
export function classifyPeriod(input: PeriodClassifierInput, rules: CzRules): SimpleCheckResult;
```
`SIMPLE_CHECKS` in this brief: the 13 accountant checks from `checks-accountant.ts`; for the 11 `not_ready` codes register a placeholder `() => null` with a `// TODO(0332)` comment so every code is present and passes. Checks are pure; `documentIds` sorted and unique; Money values in `params` are written with `toFixed2()`.
2. `checks-accountant.ts`: `export const ACCOUNTANT_CHECKS: ReadonlyArray<readonly [SimpleCheckCode, SimpleCheckFn]>` implementing the 13 rows of the table.
3. Test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { classifyPeriod, type PeriodClassifierInput, type PeriodDocument, type PeriodLine, type SimpleCheckCode } from '../src/vat/classify-period';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const AUG = { start: d('2026-08-01'), end: d('2026-08-31') };
export const entry = (o: Partial<VatLedgerEntryDraft> & { documentId: string }): VatLedgerEntryDraft => ({
  periodStart: AUG.start, periodEnd: AUG.end, vatPointDate: d('2026-08-03'), vatPointRule: 'issue_date', lineId: null,
  vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', vatRatePct: 21, baseCzk: czk('13699.77'), vatCzk: czk('2876.95'),
  deductionPct: '100', currency: 'CZK', baseForeign: null, fxRate: null, fxAmount: null, fxRateDate: null,
  dphdp3Rows: ['5'], khSection: null, khDocumentTotalCzk: null, shvCode: null, counterpartyVatId: 'NL805734958B01', evidenceNumber: '1234567890', ...o,
});
export const line = (o: Partial<PeriodLine> = {}): PeriodLine => ({ lineType: 'item', vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', businessSharePct: '100', rcCommodityCode: null, categoryCode: 'exp_software_saas', linkedIssuedInvoiceId: null, ...o });
export const doc = (o: Partial<PeriodDocument> & { documentId: string }): PeriodDocument => ({
  class: 'received_invoice', status: 'finalized', taxDocStatus: 'foreign_document', businessFlag: 'business', vatPointDate: d('2026-08-03'),
  correctsDocumentId: null, correctsVatPointDate: null, partner: { dic: null, vatId: 'NL805734958B01', vatIdValid: true, documentShowsDic: false }, lines: [line()], hasBlockingValidation: false, ...o,
});
const IO_PROFILE = [{ validFrom: d('2026-01-01'), validTo: null, vatStatus: 'identifikovana_osoba' as const, vatPeriod: 'monthly' as const, entityType: 'osvc' as const }];
const PAYER_PROFILE = [{ ...IO_PROFILE[0]!, vatStatus: 'platce' as const }];
export const io = (o: Partial<PeriodClassifierInput> = {}): PeriodClassifierInput => ({ status: 'identifikovana_osoba', period: AUG, entries: [entry({ documentId: 'b' })], documents: [doc({ documentId: 'b' })], profiles: IO_PROFILE, ledgerIssues: [], evaluatedAt: '2026-09-20T10:00:00Z', ...o });
export const payer = (o: Partial<PeriodClassifierInput> = {}): PeriodClassifierInput => io({ status: 'platce', profiles: PAYER_PROFILE, entries: [entry({ documentId: 'b', dphdp3Rows: ['5', '43'], khSection: 'A2' })], ...o });
const failing = (r: ReturnType<typeof classifyPeriod>) => r.checks.filter((c) => c.outcome !== 'pass').map((c) => c.code);
const check = (r: ReturnType<typeof classifyPeriod>, code: SimpleCheckCode) => r.checks.find((c) => c.code === code)!;

describe('classifyPeriod: verdicts', () => {
  it('golden August IO → simple; every code present once; metadata', () => {
    const r = classifyPeriod(io(), rules);
    expect(r.verdict).toBe('simple');
    expect(failing(r)).toEqual([]);
    expect(new Set(r.checks.map((c) => c.code)).size).toBe(r.checks.length);
    expect(r.checks.length).toBe(24);
    expect(r).toMatchObject({ policyVersion: '2026.1', rulesDate: '2026-08-01', evaluatedAt: '2026-09-20T10:00:00Z' });
  });
  it('IO with no return rows and no SH → nothing_to_file; with an SH entry → simple', () => {
    expect(classifyPeriod(io({ entries: [], documents: [] }), rules).verdict).toBe('nothing_to_file');
    expect(classifyPeriod(io({ entries: [entry({ documentId: 'b', vatTreatment: 'iss_no_vat', dphdp3Rows: [], shvCode: 3, vatCzk: czk('0.00') })], documents: [doc({ documentId: 'b', class: 'issued_invoice', lines: [line({ vatTreatment: 'iss_no_vat' })] })] }), rules).verdict).toBe('simple');
  });
  it('payer with no entries → simple (nil return), never nothing_to_file', () => {
    expect(classifyPeriod(payer({ entries: [], documents: [] }), rules).verdict).toBe('simple');
  });
  it('precedence: needs_accountant beats not_ready', () => {
    const r = classifyPeriod(io({ entries: [entry({ documentId: 'b', vatPointDate: d('2025-12-15') })], documents: [doc({ documentId: 'b', class: 'received_advance_tax_doc' })] }), rules);
    expect(r.verdict).toBe('needs_accountant');
    expect(failing(r)).toEqual(expect.arrayContaining(['S_ENTRY_BEFORE_STATUS', 'S_FORBIDDEN_CLASS']));
  });
});

describe('needs_accountant checks (M05 §9 #7, #9)', () => {
  it('S_PROFILE_UNSUPPORTED: neplatce or sro', () => {
    expect(check(classifyPeriod(io({ status: 'neplatce' }), rules), 'S_PROFILE_UNSUPPORTED').outcome).toBe('needs_accountant');
    expect(check(classifyPeriod(io({ profiles: [{ ...IO_PROFILE[0]!, entityType: 'sro' }] }), rules), 'S_PROFILE_UNSUPPORTED').outcome).toBe('needs_accountant');
  });
  it('S_PROFILE_CHANGED_IN_PERIOD: status flips mid-month; a version ending before the period is ignored', () => {
    const flip = [{ ...IO_PROFILE[0]!, validTo: d('2026-08-14') }, { ...PAYER_PROFILE[0]!, validFrom: d('2026-08-15') }];
    expect(check(classifyPeriod(io({ profiles: flip }), rules), 'S_PROFILE_CHANGED_IN_PERIOD').outcome).toBe('needs_accountant');
    const old = [{ ...PAYER_PROFILE[0]!, validTo: d('2026-07-31') }, { ...IO_PROFILE[0]!, validFrom: d('2026-08-01') }];
    expect(check(classifyPeriod(io({ profiles: old }), rules), 'S_PROFILE_CHANGED_IN_PERIOD').outcome).toBe('pass');
  });
  it('S_ENTRY_BEFORE_STATUS (not_ready) names the document and the earliest date', () => {
    const r = classifyPeriod(io({ profiles: [{ ...IO_PROFILE[0]!, validFrom: d('2026-08-10') }] }), rules);
    expect(check(r, 'S_ENTRY_BEFORE_STATUS')).toEqual({ code: 'S_ENTRY_BEFORE_STATUS', outcome: 'not_ready', documentIds: ['b'], params: { earliest: '2026-08-10' } });
    expect(r.verdict).toBe('not_ready');
  });
  it('S_TREATMENT_NOT_ALLOWED: IO with EU goods (#9); payer allows it', () => {
    const goods = (p: typeof io) => p({ entries: [entry({ documentId: 'g', vatTreatment: 'rcv_eu_goods_acquisition', dphdp3Rows: ['3'] })], documents: [doc({ documentId: 'g', lines: [line({ vatTreatment: 'rcv_eu_goods_acquisition' })] })] });
    expect(check(classifyPeriod(goods(io), rules), 'S_TREATMENT_NOT_ALLOWED')).toMatchObject({ outcome: 'needs_accountant', documentIds: ['g'], params: { treatment: 'rcv_eu_goods_acquisition' } });
    expect(check(classifyPeriod(goods(payer), rules), 'S_TREATMENT_NOT_ALLOWED').outcome).toBe('pass');
  });
  it('S_RC_COMMODITY and S_FORBIDDEN_CLASS (class and line type)', () => {
    expect(check(classifyPeriod(io({ documents: [doc({ documentId: 'b', lines: [line({ rcCommodityCode: '4' })] })] }), rules), 'S_RC_COMMODITY').outcome).toBe('needs_accountant');
    expect(check(classifyPeriod(io({ documents: [doc({ documentId: 'b', class: 'received_advance_tax_doc' })] }), rules), 'S_FORBIDDEN_CLASS').documentIds).toEqual(['b']);
    expect(check(classifyPeriod(io({ documents: [doc({ documentId: 'b', lines: [line({ lineType: 'advance_deduction' })] })] }), rules), 'S_FORBIDDEN_CLASS').outcome).toBe('needs_accountant');
  });
  it('S_EU_GOODS_MULTI_RATE: two rates on one EU goods document', () => {
    const two = payer({ entries: [entry({ documentId: 'g', vatTreatment: 'rcv_eu_goods_acquisition', dphdp3Rows: ['3', '43'] }), entry({ documentId: 'g', vatTreatment: 'rcv_eu_goods_acquisition', vatRateType: 'reduced', vatRatePct: 12, dphdp3Rows: ['4', '44'] })], documents: [doc({ documentId: 'g' })] });
    expect(check(classifyPeriod(two, rules), 'S_EU_GOODS_MULTI_RATE').outcome).toBe('needs_accountant');
    expect(check(classifyPeriod(payer({ entries: [two.entries[0]!], documents: two.documents }), rules), 'S_EU_GOODS_MULTI_RATE').outcome).toBe('pass');
  });
  it('S_PRIOR_PERIOD_CREDIT_NOTE: corrects a July document; same-period correction passes', () => {
    const cn = (when: string) => io({ entries: [entry({ documentId: 'b' }), entry({ documentId: 'cn', baseCzk: czk('-1000.00'), vatCzk: czk('-210.00') })], documents: [doc({ documentId: 'b' }), doc({ documentId: 'cn', class: 'received_credit_note', correctsDocumentId: 'x', correctsVatPointDate: d(when) })] });
    expect(check(classifyPeriod(cn('2026-07-15'), rules), 'S_PRIOR_PERIOD_CREDIT_NOTE')).toMatchObject({ outcome: 'needs_accountant', documentIds: ['cn'] });
    expect(check(classifyPeriod(cn('2026-08-02'), rules), 'S_PRIOR_PERIOD_CREDIT_NOTE').outcome).toBe('pass');
  });
  it('S_PARTIAL_SHARE_DEDUCTION: payer 60 % share on a domestic purchase; IO ignores it', () => {
    const docs = [doc({ documentId: 'b', lines: [line({ vatTreatment: 'rcv_domestic_vat', businessSharePct: '60' })] })];
    expect(check(classifyPeriod(payer({ documents: docs }), rules), 'S_PARTIAL_SHARE_DEDUCTION').outcome).toBe('needs_accountant');
    expect(check(classifyPeriod(io({ documents: docs }), rules), 'S_PARTIAL_SHARE_DEDUCTION').outcome).toBe('pass');
  });
  it('S_PLATFORM_INCOME_PAYER: platform statement income without a linked issued invoice', () => {
    const ps = (linked: string | null) => payer({ documents: [doc({ documentId: 'b' }), doc({ documentId: 'p', class: 'platform_statement', lines: [line({ vatTreatment: 'iss_domestic_vat', categoryCode: 'income_services', linkedIssuedInvoiceId: linked })] })] });
    expect(check(classifyPeriod(ps(null), rules), 'S_PLATFORM_INCOME_PAYER').documentIds).toEqual(['p']);
    expect(check(classifyPeriod(ps('inv-1'), rules), 'S_PLATFORM_INCOME_PAYER').outcome).toBe('pass');
  });
  it('S_IO_OUTPUT_VAT (#9) and S_IO_NEGATIVE_TAX (TA-11)', () => {
    expect(check(classifyPeriod(io({ documents: [doc({ documentId: 'b', lines: [line({ vatTreatment: 'iss_domestic_vat' })] })] }), rules), 'S_IO_OUTPUT_VAT').outcome).toBe('needs_accountant');
    expect(check(classifyPeriod(payer({ documents: [doc({ documentId: 'b', lines: [line({ vatTreatment: 'iss_domestic_vat' })] })] }), rules), 'S_IO_OUTPUT_VAT').outcome).toBe('pass');
    const neg = io({ entries: [entry({ documentId: 'b' }), entry({ documentId: 'cn', baseCzk: czk('-20000.00'), vatCzk: czk('-4200.00') })], documents: [doc({ documentId: 'b' }), doc({ documentId: 'cn', class: 'received_credit_note', correctsDocumentId: 'b', correctsVatPointDate: d('2026-08-03') })] });
    expect(check(classifyPeriod(neg, rules), 'S_IO_NEGATIVE_TAX')).toMatchObject({ outcome: 'needs_accountant', params: { sumVatCzk: '-1323.05' } });
  });
  it('S_MAX_DOCS: 151 documents with entries → needs_accountant', () => {
    const ids = Array.from({ length: 151 }, (_, i) => `d${i}`);
    const r = classifyPeriod(io({ entries: ids.map((id) => entry({ documentId: id })), documents: ids.map((id) => doc({ documentId: id })) }), rules);
    expect(check(r, 'S_MAX_DOCS')).toMatchObject({ outcome: 'needs_accountant', params: { count: 151, max: 150 } });
  });
});
```
Implement until green. Command: `pnpm --filter @shoebox/domain test -- classify-period 2>&1 | tail -30`.
4. Index line, typecheck, commit `feat(domain): classifyPeriod core and needs_accountant checks (0331)`.

## 5. Do not touch

`ledger.ts`, rules, enums. Do not implement the 0332 codes.

## 6. Commands

`pnpm --filter @shoebox/domain test -- classify-period 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Test green (24 codes present, verdict precedence, each accountant code pass+fail).
- [ ] `S_IO_NEGATIVE_TAX` carries `TODO(decision-TA-11)`.

## 8. Stop and ask

TEMPLATE §8; if `LineType` lacks `advance_deduction`, STOP and report (enum gap).

## 9. Report

`docs/tasks/0331-report.md`.

## Risk list

Both source files (decide what reaches the tax office).

## Owner steps

None.
