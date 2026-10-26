# 0349: Period preview data (`buildPeriodPreview`) and row labels

Status: todo
Ticket: P3-VAT-11 (part a) | Depends on: 0334 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 50k tokens

## 1. Objective

Pure preview data for the human check before download: every DPHDP3 row with its label, raw and rounded values and the contributing ledger entries (partner, number, date, currency, foreign amount, FX rate), KH grouped by section, SH by country/VAT ID. The preview PDF is deferred (no PDF renderer in the repo: `TODO(decision-pdf)`; lane D decides).

## 2. Context

M05 §4.9 (pasted): `getPeriodPreview(orgId, type, periodStart)` returns rows with labels (`vat.row.{n}.label`), base, tax, and per row the contributing ledger entries `{documentId, partnerName, documentNumber, vatPointDate, currency, amountForeign, fxRate, fxRateDate, baseCzk, vatCzk}`. KH preview groups by section; SH by country/VAT ID. Rounding is shown explicitly ("13 699,77 Kč → zaokrouhleno 13 700 Kč": the data carries `raw` and `rounded`; formatting is the screen's job). AGENTS rule 6 (this repo): English copy only, keys in `packages/i18n/messages/en.json`; M05's Czech labels are a documented contradiction → English labels now, `TODO(i18n-cs)`.

Labels (en.json keys, values): `vat.row.1.label` "Domestic supplies, standard rate" · `2` "Domestic supplies, reduced rate" · `3` "Goods acquired from the EU, standard rate" · `4` "Goods acquired from the EU, reduced rate" · `5` "Services received from the EU, standard rate" · `6` "Services received from the EU, reduced rate" · `12` "Services received from outside the EU, standard rate" · `13` "Services received from outside the EU, reduced rate" · `20` "Goods supplied to the EU" · `21` "Services supplied to the EU" · `26` "Other supplies outside the Czech Republic" · `40` "Domestic purchases, standard rate" · `41` "Domestic purchases, reduced rate" · `43` "Deduction on EU and foreign supplies, standard rate" · `44` "Deduction on EU and foreign supplies, reduced rate" · `46` "Total deduction" · `62` "Total output tax" · `63` "Total deduction" · `64` "Tax to pay" · `65` "Excess deduction"; plus `vat.kh.section.A2` "Received supplies you self-assess (A.2)", `A4` "Issued over 10 000 Kč to VAT-registered customers (A.4)", `A5` "Other issued supplies (A.5)", `B2` "Received over 10 000 Kč with deduction (B.2)", `B3` "Other received supplies with deduction (B.3)"; `vat.shv.code.0` "Goods to the EU", `vat.shv.code.3` "Services to the EU". The i18n test checks ICU syntax and missing keys (`pnpm --filter @shoebox/i18n test`); `MessageKey` type comes from the JSON.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/preview.ts` | create | types + `buildPeriodPreview` (labels are keys, not text: domain has no i18n) |
| `packages/domain/test/vat-preview.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append export |
| `packages/i18n/messages/en.json` | edit | the keys above (alphabetical position near other `vat.` keys or at the end) |

## 4. Steps

1. `preview.ts` exports exactly:
```ts
export interface PreviewEntry { readonly documentId: string; readonly partnerName: string | null; readonly documentNumber: string | null; readonly vatPointDate: LegalDate; readonly currency: string; readonly amountForeign: string | null; readonly fxRate: string | null; readonly fxRateDate: LegalDate | null; readonly baseCzk: string; readonly vatCzk: string }   // Money as toFixed2()
export interface PreviewRow { readonly row: string; readonly labelKey: `vat.row.${string}.label`; readonly raw: { base: string; tax: string } | null; readonly rounded: { base: string; tax: string }; readonly entries: readonly PreviewEntry[] }
export interface PreviewDocumentMeta { readonly partnerName: string | null; readonly documentNumber: string | null }
export interface PeriodPreview { readonly form: 'DPHDP3' | 'DPHKH1' | 'DPHSHV'; readonly periodStart: LegalDate; readonly rows: readonly PreviewRow[]; readonly result: { row62: string; row63: string; row64: string; row65: string } | null; readonly khSections: ReadonlyArray<{ section: 'A2' | 'A4' | 'A5' | 'B2' | 'B3'; labelKey: string; rows: ReadonlyArray<{ key: string; counterparty: string | null; evidenceNumber: string | null; dppd: LegalDate | null; zaklDane1: string; dan1: string; zaklDane2: string; dan2: string; entries: readonly PreviewEntry[] }> }> | null; readonly shvRows: ReadonlyArray<{ kStat: string; cVat: string; code: number; labelKey: string; plnHodnota: string; plnPocet: number; entries: readonly PreviewEntry[] }> | null }
export function buildPeriodPreview(form: PeriodPreview['form'], entries: readonly VatLedgerEntryDraft[], meta: ReadonlyMap<string, PreviewDocumentMeta>, dp3: Dphdp3Computation, kh: KhComputation | null, shv: ShvComputation | null): PeriodPreview;
```
DPHDP3 rows: every row in `dp3.rows` ordered numerically; derived rows have `raw: null` and no entries; entries of a source row = entries whose `dphdp3Rows` contains it, sorted by (`vatPointDate`, `documentNumber`, `documentId`). KH rows' entries = entries of that document in that section; aggregates list all their entries. SH entries = entries of the group.
2. Test verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3 } from '../src/vat/dphdp3';
import { computeKh } from '../src/vat/kh';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';
import { buildPeriodPreview } from '../src/vat/preview';
import { computeShv } from '../src/vat/shv';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const e = (documentId: string, rows: string[], base: string, vat: string, o: Partial<VatLedgerEntryDraft> = {}): VatLedgerEntryDraft => ({
  periodStart: d('2026-10-01'), periodEnd: d('2026-10-31'), vatPointDate: d('2026-10-15'), vatPointRule: 'issue_date', lineId: null, documentId, vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', vatRatePct: 21,
  baseCzk: czk(base), vatCzk: czk(vat), deductionPct: '100', currency: 'CZK', baseForeign: null, fxRate: null, fxAmount: null, fxRateDate: null, dphdp3Rows: rows, khSection: null, khDocumentTotalCzk: null, shvCode: null, counterpartyVatId: null, evidenceNumber: documentId, ...o,
});
const OCT = [
  e('anthropic', ['5'], '2212.20', '464.56', { currency: 'EUR', baseForeign: Money.parse('90.00', 'EUR'), fxRate: '24.580000', fxAmount: 1, fxRateDate: d('2026-10-15'), counterpartyVatId: 'IE3797893MH', evidenceNumber: 'INV-90' }),
  e('cloudflare', ['12'], '245.35', '51.52', { vatTreatment: 'rcv_non_eu_service_reverse_charge', currency: 'USD', baseForeign: Money.parse('10.46', 'USD'), fxRate: '23.456000', fxAmount: 1, fxRateDate: d('2026-10-02'), vatPointDate: d('2026-10-03') }),
];
const META = new Map([['anthropic', { partnerName: 'Anthropic Ireland, Limited', documentNumber: 'INV-90' }], ['cloudflare', { partnerName: 'Cloudflare, Inc.', documentNumber: null }]]);

describe('buildPeriodPreview (M05 §4.9, §9 #2/#3)', () => {
  it('DPHDP3 rows carry raw → rounded and their entries with FX data', () => {
    const dp3 = computeDphdp3(OCT, 'identifikovana_osoba', rules, d('2026-10-01'));
    const p = buildPeriodPreview('DPHDP3', OCT, META, dp3, null, null);
    expect(p.rows.map((r) => r.row)).toEqual(['5', '12']);
    expect(p.rows[0]).toMatchObject({ labelKey: 'vat.row.5.label', raw: { base: '2212.20', tax: '464.56' }, rounded: { base: '2212.00', tax: '465.00' } });
    expect(p.rows[0]?.entries).toEqual([{ documentId: 'anthropic', partnerName: 'Anthropic Ireland, Limited', documentNumber: 'INV-90', vatPointDate: '2026-10-15', currency: 'EUR', amountForeign: '90.00', fxRate: '24.580000', fxRateDate: '2026-10-15', baseCzk: '2212.20', vatCzk: '464.56' }]);
    expect(p.rows[1]?.entries[0]).toMatchObject({ partnerName: 'Cloudflare, Inc.', documentNumber: null, currency: 'USD', amountForeign: '10.46' });
    expect(p.result).toEqual({ row62: '517.00', row63: '0.00', row64: '517.00', row65: '0.00' });
    expect(p.khSections).toBeNull();
  });
  it('payer: derived rows have no raw; KH sections and SH groups list entries', () => {
    const sep = [
      e('inv-a', ['1'], '10000.00', '2100.00', { vatTreatment: 'iss_domestic_vat', khSection: 'A4', counterpartyVatId: 'CZ12345678', evidenceNumber: '2026-0001' }),
      e('booking', ['5', '43'], '11549.94', '2425.49', { khSection: 'A2', counterpartyVatId: 'NL805734958B01' }),
      e('s1', ['21'], '1000.10', '0.00', { vatTreatment: 'iss_eu_service', shvCode: 3, counterpartyVatId: 'DE123456789' }),
    ];
    const dp3 = computeDphdp3(sep, 'platce', rules, d('2026-10-01'));
    const kh = computeKh(sep, dp3, () => undefined);
    const p = buildPeriodPreview('DPHKH1', sep, new Map(), dp3, kh, computeShv(sep, rules, d('2026-10-01')));
    expect(p.rows.find((r) => r.row === '43')).toMatchObject({ raw: null, rounded: { base: '11550.00', tax: '2425.00' }, entries: [] });
    expect(p.khSections?.map((s) => [s.section, s.rows.length])).toEqual([['A2', 1], ['A4', 1]]);
    expect(p.khSections?.[1]?.rows[0]).toMatchObject({ counterparty: '12345678', evidenceNumber: '2026-0001', zaklDane1: '10000.00', dan1: '2100.00' });
    expect(p.shvRows).toEqual([expect.objectContaining({ kStat: 'DE', cVat: '123456789', code: 3, labelKey: 'vat.shv.code.3', plnHodnota: '1001.00', plnPocet: 1 })]);
  });
});
```
Command: `pnpm --filter @shoebox/domain test -- vat-preview 2>&1 | tail -30`.
3. en.json keys; `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`.
4. Index export; typecheck; commit `feat(domain): period preview data + row labels (0349)`.

## 5. Do not touch

`cs.json`, screens, worker.

## 6. Commands

`pnpm --filter @shoebox/domain test -- vat-preview 2>&1 | tail -30` · `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Green; every `labelKey` the preview can emit exists in `en.json` (add a loop in the test over rows 1,2,3,4,5,6,12,13,20,21,26,40,41,43,44,46,62,63,64,65 if the i18n package exposes the key list to domain tests; otherwise state in the report that the i18n test covers it).

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0349-report.md`.

## Risk list

None beyond presentation (no tax math here).

## Owner steps

1. Decide the preview-PDF renderer (decisions.md, `TODO(decision-pdf)`); lane D builds the sheet.
