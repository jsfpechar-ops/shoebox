# 0332: `classifyPeriod` not_ready checks

Status: todo
Ticket: P3-VAT-03 (part b) | Depends on: 0331 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 50k tokens

## 1. Objective

Fill the 11 `not_ready` checks of the simple-period classifier (things the user can fix in the app) into the registry 0331 left as placeholders.

## 2. Context

M05 §4.3 rows (pasted; outcome `not_ready` for all):

| Code | Condition |
|---|---|
| `S_PENDING_DOCUMENTS` | documents in the period with `status` not in (`finalized`,`supporting`,`duplicate`) and class in `BOOKABLE_CLASSES` (`../ledgers/tax`) |
| `S_BLOCKING_VALIDATION` | `doc.hasBlockingValidation` |
| `S_BUSINESS_FLAG_UNKNOWN` | a document with ≥ 1 entry and `businessFlag === 'unknown'` |
| `S_FX_MISSING`, `S_DATE_MISSING`, `S_SELF_ASSESSED_RATE_UNKNOWN`, `S_MIXED_TREATMENT_SAME_RATE` | pass-through of `input.ledgerIssues` grouped by code (`documentIds` = the issue's documents) |
| `S_KH_DIC_MISSING` | payer: (a) a document with an entry of treatment `rcv_domestic_vat` whose `partner.dic` is null; or (b) a document with an entry in `A5`/`B3` whose `khDocumentTotalCzk` abs > `vat.kh_document_limit` while `partner.dic` is null and `partner.documentShowsDic` is true (an A4/B2 candidate routed down only because the DIČ is missing) |
| `S_KH_EVIDENCE_NUMBER_MISSING` | payer: entry with `khSection` in (`A2`,`A4`,`B2`) and empty `evidenceNumber` |
| `S_DOMESTIC_NOT_TAX_DOC` | payer: a document with a line of treatment `rcv_domestic_vat` and `taxDocStatus` not in (`full_tax_document`,`simplified_tax_document`) |
| `S_SH_VAT_ID_INVALID` | entry with `shvCode !== null` whose document partner `vatId` is null or `vatIdValid !== true` |

M05 §9 #8: "supplier gross 10 000,01 without DIČ → `S_KH_DIC_MISSING`" (case a). Missing **buyer** DIČ on a foreign invoice (Booking August) fails nothing.

0331 defined `SimpleCheckContext`, `SimpleCheckFn`, `SIMPLE_CHECKS` and the test helpers (`entry`, `doc`, `line`, `io`, `payer` are exported from `test/classify-period.test.ts`; import them).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/checks-ready.ts` | create | `export const READY_CHECKS: ReadonlyArray<readonly [SimpleCheckCode, SimpleCheckFn]>` (11 codes) |
| `packages/domain/src/vat/classify-period.ts` | edit | add `readonly khDocumentLimitCzk: number` to `SimpleCheckContext` (from `rules.at(period.start).get('vat.kh_document_limit')`); replace the 11 placeholders with `...READY_CHECKS` keeping the code order |
| `packages/domain/test/classify-period-ready.test.ts` | create | below |

## 4. Steps

1. Edit `classify-period.ts` as in §3 (remove the `TODO(0332)` placeholders). `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.
2. Create `checks-ready.ts`.
3. Test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { classifyPeriod, type SimpleCheckCode } from '../src/vat/classify-period';
import { doc, entry, io, line, payer } from './classify-period.test';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const check = (r: ReturnType<typeof classifyPeriod>, code: SimpleCheckCode) => r.checks.find((c) => c.code === code)!;
const CZ = { dic: 'CZ12345678', vatId: null, vatIdValid: null, documentShowsDic: true };
const NO_DIC = { dic: null, vatId: null, vatIdValid: null, documentShowsDic: false };

describe('not_ready checks (0332)', () => {
  it('S_PENDING_DOCUMENTS: a ready invoice blocks, a supporting document does not', () => {
    expect(check(classifyPeriod(io({ documents: [doc({ documentId: 'b', status: 'ready' })] }), rules), 'S_PENDING_DOCUMENTS')).toMatchObject({ outcome: 'not_ready', documentIds: ['b'] });
    expect(check(classifyPeriod(io({ documents: [doc({ documentId: 'b' }), doc({ documentId: 's', class: 'other_supporting', status: 'supporting' })] }), rules), 'S_PENDING_DOCUMENTS').outcome).toBe('pass');
    expect(classifyPeriod(io({ documents: [doc({ documentId: 'b', status: 'needs_review' })] }), rules).verdict).toBe('not_ready');
  });
  it('S_BLOCKING_VALIDATION and S_BUSINESS_FLAG_UNKNOWN', () => {
    expect(check(classifyPeriod(io({ documents: [doc({ documentId: 'b', hasBlockingValidation: true })] }), rules), 'S_BLOCKING_VALIDATION').documentIds).toEqual(['b']);
    expect(check(classifyPeriod(io({ documents: [doc({ documentId: 'b', businessFlag: 'unknown' })] }), rules), 'S_BUSINESS_FLAG_UNKNOWN').outcome).toBe('not_ready');
    expect(check(classifyPeriod(io({ documents: [doc({ documentId: 'b', businessFlag: 'mixed' })] }), rules), 'S_BUSINESS_FLAG_UNKNOWN').outcome).toBe('pass');
  });
  it('ledger issues pass through by code', () => {
    const r = classifyPeriod(io({ ledgerIssues: [{ code: 'S_FX_MISSING', documentId: 'c' }, { code: 'S_FX_MISSING', documentId: 'a' }, { code: 'S_DATE_MISSING', documentId: 'b' }] }), rules);
    expect(check(r, 'S_FX_MISSING')).toMatchObject({ outcome: 'not_ready', documentIds: ['a', 'c'] });
    expect(check(r, 'S_DATE_MISSING').documentIds).toEqual(['b']);
    expect(check(r, 'S_SELF_ASSESSED_RATE_UNKNOWN').outcome).toBe('pass');
    expect(check(r, 'S_MIXED_TREATMENT_SAME_RATE').outcome).toBe('pass');
  });
  it('S_KH_DIC_MISSING (#8): supplier 10 000,01 without DIČ; with DIČ passes; IO never', () => {
    const dom = (partner: typeof CZ, total: string, section: 'B2' | 'B3') => ({
      entries: [entry({ documentId: 'm', vatTreatment: 'rcv_domestic_vat', dphdp3Rows: ['40'], khSection: section, khDocumentTotalCzk: czk(total), baseCzk: czk('8264.47'), vatCzk: czk('1735.54'), counterpartyVatId: partner.dic })],
      documents: [doc({ documentId: 'm', taxDocStatus: 'full_tax_document', partner, lines: [line({ vatTreatment: 'rcv_domestic_vat' })] })],
    });
    expect(check(classifyPeriod(payer(dom(NO_DIC, '10000.01', 'B3')), rules), 'S_KH_DIC_MISSING')).toMatchObject({ outcome: 'not_ready', documentIds: ['m'] });
    expect(check(classifyPeriod(payer(dom(CZ, '10000.01', 'B2')), rules), 'S_KH_DIC_MISSING').outcome).toBe('pass');
    expect(check(classifyPeriod(io(dom(NO_DIC, '10000.01', 'B3')), rules), 'S_KH_DIC_MISSING').outcome).toBe('pass');
  });
  it('S_KH_DIC_MISSING (b): A5 over the limit with a DIČ printed but not captured', () => {
    const out = payer({ entries: [entry({ documentId: 'i', vatTreatment: 'iss_domestic_vat', dphdp3Rows: ['1'], khSection: 'A5', khDocumentTotalCzk: czk('12100.00'), baseCzk: czk('10000.00'), vatCzk: czk('2100.00'), counterpartyVatId: null })],
      documents: [doc({ documentId: 'i', class: 'issued_invoice', taxDocStatus: 'full_tax_document', partner: { ...NO_DIC, documentShowsDic: true }, lines: [line({ vatTreatment: 'iss_domestic_vat' })] })] });
    expect(check(classifyPeriod(out, rules), 'S_KH_DIC_MISSING').outcome).toBe('not_ready');
    const b2c = { ...out, documents: [{ ...out.documents[0]!, partner: NO_DIC }] };
    expect(check(classifyPeriod(b2c, rules), 'S_KH_DIC_MISSING').outcome).toBe('pass');
  });
  it('S_KH_EVIDENCE_NUMBER_MISSING: A2 entry without a document number; A5 does not need one', () => {
    expect(check(classifyPeriod(payer({ entries: [entry({ documentId: 'b', dphdp3Rows: ['5', '43'], khSection: 'A2', evidenceNumber: null })] }), rules), 'S_KH_EVIDENCE_NUMBER_MISSING').documentIds).toEqual(['b']);
    expect(check(classifyPeriod(payer({ entries: [entry({ documentId: 'b', vatTreatment: 'iss_domestic_vat', dphdp3Rows: ['1'], khSection: 'A5', evidenceNumber: '' })] }), rules), 'S_KH_EVIDENCE_NUMBER_MISSING').outcome).toBe('pass');
  });
  it('S_DOMESTIC_NOT_TAX_DOC: Alza "není daňový doklad" with a domestic VAT line', () => {
    const alza = payer({ documents: [doc({ documentId: 'b' }), doc({ documentId: 'z', taxDocStatus: 'not_tax_document', partner: CZ, lines: [line({ vatTreatment: 'rcv_domestic_vat' })] })] });
    expect(check(classifyPeriod(alza, rules), 'S_DOMESTIC_NOT_TAX_DOC').documentIds).toEqual(['z']);
    expect(check(classifyPeriod(payer({ documents: [doc({ documentId: 'z', taxDocStatus: 'simplified_tax_document', partner: CZ, lines: [line({ vatTreatment: 'rcv_domestic_vat' })] })] }), rules), 'S_DOMESTIC_NOT_TAX_DOC').outcome).toBe('pass');
  });
  it('S_SH_VAT_ID_INVALID: SH entry needs a VIES-valid VAT ID', () => {
    const sh = (vatIdValid: boolean | null) => payer({ entries: [entry({ documentId: 'e', vatTreatment: 'iss_eu_service', dphdp3Rows: ['21'], shvCode: 3, vatCzk: czk('0.00'), counterpartyVatId: 'DE123456789' })],
      documents: [doc({ documentId: 'e', class: 'issued_invoice', partner: { dic: null, vatId: 'DE123456789', vatIdValid, documentShowsDic: false }, lines: [line({ vatTreatment: 'iss_eu_service' })] })] });
    expect(check(classifyPeriod(sh(false), rules), 'S_SH_VAT_ID_INVALID').outcome).toBe('not_ready');
    expect(check(classifyPeriod(sh(null), rules), 'S_SH_VAT_ID_INVALID').outcome).toBe('not_ready');
    expect(check(classifyPeriod(sh(true), rules), 'S_SH_VAT_ID_INVALID').outcome).toBe('pass');
  });
  it('Booking August: missing buyer DIČ fails nothing', () => {
    expect(classifyPeriod(io({ entries: [entry({ documentId: 'b', vatPointDate: d('2026-09-03'), baseCzk: czk('11549.94'), vatCzk: czk('2425.49') })] }), rules).verdict).toBe('simple');
  });
});
```
Command: `pnpm --filter @shoebox/domain test -- classify-period 2>&1 | tail -30` (runs both files) → green.
4. Commit `feat(domain): classifyPeriod not_ready checks (0332)`.

## 5. Do not touch

`checks-accountant.ts`, the 0331 test file, rules.

## 6. Commands

`pnpm --filter @shoebox/domain test -- classify-period 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Both classifier test files green; no placeholder left (`grep -n 'TODO(0332)' packages/domain/src/vat/*.ts` empty).

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0332-report.md`.

## Risk list

`checks-ready.ts`.

## Owner steps

None.
