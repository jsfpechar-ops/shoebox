# 0346: Imported own return → `origin='imported'` filing and "matches filed" check

Status: todo
Ticket: P3-VAT-09 (part d) | Depends on: 0343, 0344 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 50k tokens

## 1. Objective

When the user uploads a DPHDP3 they already filed (the P4 August decoy), register it as an imported filing and tell them whether our computation matches it (`vat.card.matches_filed`) or an amendment flow is needed. Pure matching + a small worker step called from `vat.period.evaluate`.

## 2. Context

M05 §4.11 (pasted): Imported filed return: a `government_filing` document whose extracted fields (M02 `filing` profile, keys of 04 §9.4: `filing.form_code`, `filing.period_start`, `filing.kind`, `filing.filer_dic`, `filing.rows.{row}.base|tax`) identify a DPHDP3 for this org creates a `filings` row with `origin='imported'`, `state='marked_filed'`, `totals` from those fields, link `reported_in` from each ledger document of the period. If our computation equals the imported totals → card "Sedí s vaším podaným přiznáním"; otherwise → amendment flow. M05 §9 #1: August IO computation equals the imported filed DPHDP3 (row 5 = 13 700 / 2 877; labels also carry rows 62 and 64).

Document fields live in `document_fields` (`packages/db/src/schema/document-details.ts`: grep the exact columns, typically `document_id, key, value_text/value_json, confidence`); field keys are dotted strings. `filed_on` = the document's `issue_date` (the filed return carries its submission date); `filer_dic` must equal the org profile's DIČ digits (`dicDigits`, 0329) or the document is ignored (someone else's return). Filing `kind` from `filing.kind` (`radne` default). Existing imported filing for the same `(period_start, kind, source_document_id)` → no duplicate (idempotent). Status `marked_filed` rows are not "open", so the unique index is not involved. Document links: table `document_links (from_document_id, to_document_id, kind)`; use the `reported_in` kind if it exists in `DOC_LINK_KIND_VALUES` (grep), else skip links and report.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/imported.ts` | create | pure parsing + comparison |
| `packages/domain/test/imported-filing.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append export |
| `apps/worker/src/vat/imported.ts` | create | `registerImportedFilings(tx, orgId, periodStart, deps)`: find `government_filing` documents of the org whose fields parse to a DPHDP3 for this period, insert the imported filing via `insertFiling` (0343) when missing, add links; called at the end of `evaluatePeriod` (0344 `service.ts`: one call + one import; add `readGovernmentFilingFields(tx, orgId)` to `VatStore` as optional dep with a db implementation in this file) |
| `apps/worker/test/imported-filing.test.ts` | create | fake store: one P4 August decoy document → one imported filing with totals; second run → none; foreign DIČ → none |

## 4. Steps

1. Domain `imported.ts` exports exactly:
```ts
export interface ImportedFilingFields { readonly formCode: string; readonly periodStart: LegalDate; readonly kind: FilingKind; readonly filerDicDigits: string; readonly rows: Readonly<Record<string, { readonly base?: number; readonly tax?: number }>> }
/** From dotted field keys → value strings; null unless form_code and period_start parse. `filing.period_start` may be 'YYYY-MM' (→ first day) or 'YYYY-MM-DD'. Row values are whole-Kč integers (strings with spaces allowed: '13 700'). */
export function parseImportedFilingFields(fields: ReadonlyArray<{ key: string; value: string | null }>): ImportedFilingFields | null;
export type ImportedMatch = { readonly matches: true } | { readonly matches: false; readonly differences: ReadonlyArray<{ row: string; attr: 'base' | 'tax'; filed: number; ours: number }> };
/** Compares rows 1–66 present on either side; a row missing on one side counts as 0. ours = Dphdp3Computation (rows + row62..65). */
export function compareWithImported(ours: Dphdp3Computation, imported: ImportedFilingFields): ImportedMatch;
export function importedTotals(imported: ImportedFilingFields): { rows: Record<string, { base?: number; tax?: number }>; source: 'imported' };
```
2. Test verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3 } from '../src/vat/dphdp3';
import { compareWithImported, parseImportedFilingFields } from '../src/vat/imported';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';

const d = parseLegalDate;
const rules = createCzRules();
const FIELDS = [
  { key: 'filing.form_code', value: 'DPHDP3' }, { key: 'filing.period_start', value: '2026-08' }, { key: 'filing.kind', value: 'radne' }, { key: 'filing.filer_dic', value: 'CZ7801011229' },
  { key: 'filing.rows.5.base', value: '13 700' }, { key: 'filing.rows.5.tax', value: '2877' }, { key: 'filing.rows.62.tax', value: '2877' }, { key: 'filing.rows.64.tax', value: '2877' },
];
const booking: VatLedgerEntryDraft = { periodStart: d('2026-08-01'), periodEnd: d('2026-08-31'), vatPointDate: d('2026-08-03'), vatPointRule: 'issue_date', lineId: null, documentId: 'b', vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', vatRatePct: 21, baseCzk: Money.parse('13699.77', 'CZK'), vatCzk: Money.parse('2876.95', 'CZK'), deductionPct: '100', currency: 'CZK', baseForeign: null, fxRate: null, fxAmount: null, fxRateDate: null, dphdp3Rows: ['5'], khSection: null, khDocumentTotalCzk: null, shvCode: null, counterpartyVatId: 'NL805734958B01', evidenceNumber: '1634188207' };

describe('imported filing (M05 §9 #1)', () => {
  it('parses the P4 decoy fields', () => {
    expect(parseImportedFilingFields(FIELDS)).toEqual({ formCode: 'DPHDP3', periodStart: '2026-08-01', kind: 'radne', filerDicDigits: '7801011229', rows: { '5': { base: 13700, tax: 2877 }, '62': { tax: 2877 }, '64': { tax: 2877 } } });
    expect(parseImportedFilingFields(FIELDS.filter((f) => f.key !== 'filing.period_start'))).toBeNull();
    expect(parseImportedFilingFields([{ key: 'filing.form_code', value: 'DPHDP3' }, { key: 'filing.period_start', value: '2026-08-01' }])?.kind).toBe('radne');
  });
  it('August computation matches the filed return; a different base does not', () => {
    const ours = computeDphdp3([booking], 'identifikovana_osoba', rules, d('2026-08-01'));
    const imported = parseImportedFilingFields(FIELDS)!;
    expect(compareWithImported(ours, imported)).toEqual({ matches: true });
    const off = { ...imported, rows: { ...imported.rows, '5': { base: 13701, tax: 2877 } } };
    expect(compareWithImported(ours, off)).toEqual({ matches: false, differences: [{ row: '5', attr: 'base', filed: 13701, ours: 13700 }] });
    const extra = { ...imported, rows: { ...imported.rows, '12': { base: 100, tax: 21 } } };
    expect(compareWithImported(ours, extra)).toMatchObject({ matches: false });
  });
});
```
Command: `pnpm --filter @shoebox/domain test -- imported-filing 2>&1 | tail -30`.
3. Worker `imported.ts` + the `evaluatePeriod` hook: after classification, `registerImportedFilings`; when an imported filing exists for the period and verdict is `simple`, compute DP3 and set `EvaluateResult.matchesFiled: boolean | null` (extend the 0344 type with this optional field) and log `filing.matches_filed` / `filing.amendment_needed` (`vat.card.matches_filed` copy is lane D's). Worker test with a fake store (three cases of §3). Command: `pnpm --filter @shoebox/worker test -- imported-filing 2>&1 | tail -30`.
4. Commit `feat: imported own DPHDP3 as filing + match check (0346)`.

## 5. Do not touch

Extraction (`packages/extraction`: the `filing` field profile is lane B's), migrations.

## 6. Commands

`pnpm --filter @shoebox/domain test -- imported-filing 2>&1 | tail -30` · `pnpm --filter @shoebox/worker test -- imported-filing 2>&1 | tail -30` · both typechecks

## 7. Acceptance

- [ ] Tests green; a second evaluate run creates no duplicate; foreign DIČ ignored.

## 8. Stop and ask

TEMPLATE §8; `document_fields` columns differ from the assumption (report the real ones).

## 9. Report

`docs/tasks/0346-report.md`.

## Risk list

Worker `imported.ts` (writes filings from extracted data: must never mark our own generated filing as filed).

## Owner steps

None.
