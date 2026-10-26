# 0334: `computeKh` (DPHKH1) and `computeShv` (DPHSHV)

Status: todo
Ticket: P3-VAT-05 (part a) | Depends on: 0333 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 55k tokens

## 1. Objective

Pure control-statement and recapitulative-statement computations from VAT ledger entries: KH sections A2/A4/A5/B2/B3 with haléře, Věta C mirrored from the DPHDP3 computation, SH rows per (country, VAT ID, code) rounded up to whole Kč. Routing into sections is already on each entry (`khSection`, `shvCode`, 0311); this brief only groups, sums and orders.

## 2. Context

M05 §4.5 (pasted). **KH** (payers only):
- `A2`: one row per document: `k_stat` = 2-letter prefix of `counterpartyVatId` (Greece `EL`) else partner country; `vatid_dod` = VAT ID without the prefix or empty; `c_evid_dd` = `evidenceNumber`; `dppd` = entry `vatPointDate`; `zakl_dane1/dan1` = standard-rate sums, `zakl_dane2/dan2` = reduced, 2 decimals.
- `A4`: per document: `dic_odb` = digits of `counterpartyVatId`, `c_evid_dd`, `dppd` = document `duzp` (fallback: entry `vatPointDate`), `zakl_dane1..2`, `dan1..2`, `kod_rezim_pl="0"`, `zdph_44="N"`.
- `B2`: per document: `dic_dod`, `c_evid_dd`, `dppd` = `duzp` (fallback as above), sums, `pomer="N"`, `zdph_44="N"`.
- `A5`, `B3`: one aggregate row each (Σ of entries), `null` if no entries.
- `c_radku`: 1-based per Věta after sorting by (`dppd`, `c_evid_dd`, dic/vatid) **[verify format]**.
- **Věta C** = DPHDP3 values (whole CZK): `obrat23` = ř.1 base, `obrat5` = ř.2 base, `pln23` = ř.40 base, `pln5` = ř.41 base, `celk_zd_a2` = Σ bases of ř.3,4,5,6,12,13 **[verify: DP3 values vs KH sums]**.

**SH** (`computeShv`): group SH entries of the calendar month by (`k_stat`, `c_vat`, `k_pln_eu` = `shvCode`): `pln_hodnota` = Σ `baseCzk` rounded per `vat.shv_rounding` (`ceil` → `ceil0`, `round` → `round0`, `floor` → `floor0`, from `../money/index`; CTF §1.4 "rounded up" **[verify]**, credit notes negative), `pln_pocet` = distinct documents, `c_rad` 1-based after sorting by (`k_stat`, `c_vat`, `k_pln_eu`), `por_c_stran = 1` **[verify]**.

DIČ digits: `dicDigits` (0329 `../vat/header`). Rate buckets: `vatRateType` `standard` → suffix 1, `reduced` → 2; `zero`/`none` entries in a KH section are summed into bucket 1 base with zero tax (never dropped). `Money.sum(items, 'CZK')`, `round2` not needed (entries are already 2-dp).

Synthetic payer September (same entries as 0333's payer case, with KH data): inv-a A4 `CZ12345678` `2026-0001` dppd 2026-09-10 10 000,00/2 100,00 · inv-b A5 8 264,46/1 735,54 (gross exactly 10 000,00) · inv-c A4 `2026-0003` dppd 2026-09-12 8 264,47/1 735,54 (gross 10 000,01) · booking-aug A2 `NL805734958B01` `1637922054` dppd 2026-09-03 11 549,94/2 425,49 · manager B2 `CZ87654321` `2026090001` duzp 2026-09-02 10 711,44/2 249,40 · ikea B3 990,08/207,92 · credit B2 `CZ87654321` `DOB-7` duzp 2026-09-15 −9 917,36/−2 082,64. Věta C from 0333: obrat23 26 529, pln23 1 784, celk_zd_a2 11 550, obrat5 = pln5 = 0.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/kh.ts` | create | KH types + `computeKh` |
| `packages/domain/src/vat/shv.ts` | create | SH types + `computeShv` |
| `packages/domain/test/kh.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append `export * from './vat/kh';` and `export * from './vat/shv';` |

## 4. Steps

1. `kh.ts` exports exactly:
```ts
export interface KhAmounts { readonly zaklDane1: Money; readonly dan1: Money; readonly zaklDane2: Money; readonly dan2: Money }
export interface KhA2Row extends KhAmounts { readonly cRadku: number; readonly kStat: string; readonly vatidDod: string; readonly cEvidDd: string; readonly dppd: LegalDate; readonly documentId: string }
export interface KhA4Row extends KhAmounts { readonly cRadku: number; readonly dicOdb: string; readonly cEvidDd: string; readonly dppd: LegalDate; readonly kodRezimPl: '0'; readonly zdph44: 'N'; readonly documentId: string }
export interface KhB2Row extends KhAmounts { readonly cRadku: number; readonly dicDod: string; readonly cEvidDd: string; readonly dppd: LegalDate; readonly pomer: 'N'; readonly zdph44: 'N'; readonly documentId: string }
export interface KhAggregate extends KhAmounts { readonly documentIds: readonly string[] }
export interface KhVetaC { readonly obrat23: Money; readonly obrat5: Money; readonly pln23: Money; readonly pln5: Money; readonly celkZdA2: Money }
export interface KhComputation { readonly periodStart: LegalDate; readonly a2: readonly KhA2Row[]; readonly a4: readonly KhA4Row[]; readonly a5: KhAggregate | null; readonly b2: readonly KhB2Row[]; readonly b3: KhAggregate | null; readonly c: KhVetaC; readonly entryCount: number }
export interface KhDocumentInfo { readonly duzp: LegalDate | null; readonly partnerCountry: string | null }
export type KhDocumentLookup = (documentId: string) => KhDocumentInfo | undefined;
export function vatIdParts(vatId: string | null): { kStat: string; number: string } | null;   // 'NL805734958B01' → {NL, 805734958B01}; null when null/empty; non-letter prefix → kStat ''
export function computeKh(entries: readonly VatLedgerEntryDraft[], dp3: Dphdp3Computation, lookup: KhDocumentLookup): KhComputation;
```
Entries with `khSection === null` or in A1/A3/B1 are ignored (not in scope; count them in nothing). Rows with `cEvidDd` null → `''` (0332 already blocks this). Sorting keys compare as strings; ties keep documentId order.
2. `shv.ts` exports exactly:
```ts
export interface ShvRow { readonly cRad: number; readonly kStat: string; readonly cVat: string; readonly kPlnEu: 0 | 1 | 2 | 3; readonly plnHodnota: Money; readonly plnPocet: number; readonly porCStran: 1; readonly documentIds: readonly string[] }
export interface ShvComputation { readonly monthStart: LegalDate; readonly rows: readonly ShvRow[]; readonly total: Money }
export function computeShv(entries: readonly VatLedgerEntryDraft[], rules: CzRules, monthStart: LegalDate): ShvComputation;   // only entries whose vatPointDate is in that month and shvCode !== null
```
3. Test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3 } from '../src/vat/dphdp3';
import { computeKh, type KhDocumentInfo, vatIdParts } from '../src/vat/kh';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';
import { computeShv } from '../src/vat/shv';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const f2 = (m: Money) => m.toFixed2();
const e = (documentId: string, rows: string[], base: string, vat: string, o: Partial<VatLedgerEntryDraft> = {}): VatLedgerEntryDraft => ({
  periodStart: d('2026-09-01'), periodEnd: d('2026-09-30'), vatPointDate: d('2026-09-03'), vatPointRule: 'issue_date', lineId: null, documentId,
  vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', vatRatePct: 21, baseCzk: czk(base), vatCzk: czk(vat), deductionPct: '100',
  currency: 'CZK', baseForeign: null, fxRate: null, fxAmount: null, fxRateDate: null, dphdp3Rows: rows, khSection: null, khDocumentTotalCzk: null,
  shvCode: null, counterpartyVatId: null, evidenceNumber: documentId, ...o,
});
const SEP: VatLedgerEntryDraft[] = [
  e('inv-a', ['1'], '10000.00', '2100.00', { vatTreatment: 'iss_domestic_vat', khSection: 'A4', khDocumentTotalCzk: czk('12100.00'), counterpartyVatId: 'CZ12345678', evidenceNumber: '2026-0001', vatPointDate: d('2026-09-10') }),
  e('inv-b', ['1'], '8264.46', '1735.54', { vatTreatment: 'iss_domestic_vat', khSection: 'A5', khDocumentTotalCzk: czk('10000.00'), counterpartyVatId: 'CZ12345678', evidenceNumber: '2026-0002', vatPointDate: d('2026-09-11') }),
  e('inv-c', ['1'], '8264.47', '1735.54', { vatTreatment: 'iss_domestic_vat', khSection: 'A4', khDocumentTotalCzk: czk('10000.01'), counterpartyVatId: 'CZ12345678', evidenceNumber: '2026-0003', vatPointDate: d('2026-09-12') }),
  e('booking-aug', ['5', '43'], '11549.94', '2425.49', { khSection: 'A2', counterpartyVatId: 'NL805734958B01', evidenceNumber: '1637922054' }),
  e('manager', ['40'], '10711.44', '2249.40', { vatTreatment: 'rcv_domestic_vat', khSection: 'B2', khDocumentTotalCzk: czk('12960.84'), counterpartyVatId: 'CZ87654321', evidenceNumber: '2026090001', vatPointDate: d('2026-09-02') }),
  e('ikea', ['40'], '990.08', '207.92', { vatTreatment: 'rcv_domestic_vat', khSection: 'B3', khDocumentTotalCzk: czk('1198.00'), counterpartyVatId: null, evidenceNumber: 'R-0757' }),
  e('credit', ['40'], '-9917.36', '-2082.64', { vatTreatment: 'rcv_domestic_vat', khSection: 'B2', khDocumentTotalCzk: czk('-12000.00'), counterpartyVatId: 'CZ87654321', evidenceNumber: 'DOB-7', vatPointDate: d('2026-09-15') }),
];
const DOCS: Record<string, KhDocumentInfo> = { manager: { duzp: d('2026-09-02'), partnerCountry: 'CZ' }, credit: { duzp: d('2026-09-15'), partnerCountry: 'CZ' }, 'booking-aug': { duzp: null, partnerCountry: 'NL' } };
const lookup = (id: string) => DOCS[id];
const dp3 = computeDphdp3(SEP, 'platce', rules, d('2026-09-01'));

describe('computeKh (M05 §4.5, §9 #8)', () => {
  const kh = computeKh(SEP, dp3, lookup);
  it('A4 boundary: 10 000,00 → A5 aggregate, 10 000,01 → A4; rows sorted by dppd with c_radku', () => {
    expect(kh.a4.map((r) => [r.cRadku, r.dicOdb, r.cEvidDd, r.dppd, f2(r.zaklDane1), f2(r.dan1), r.kodRezimPl, r.zdph44])).toEqual([
      [1, '12345678', '2026-0001', '2026-09-10', '10000.00', '2100.00', '0', 'N'],
      [2, '12345678', '2026-0003', '2026-09-12', '8264.47', '1735.54', '0', 'N'],
    ]);
    expect(kh.a5).toMatchObject({ documentIds: ['inv-b'] });
    expect([f2(kh.a5!.zaklDane1), f2(kh.a5!.dan1), f2(kh.a5!.zaklDane2), f2(kh.a5!.dan2)]).toEqual(['8264.46', '1735.54', '0.00', '0.00']);
  });
  it('A2 from the EU supplier with k_stat/vatid split and dppd = vat point date', () => {
    expect(kh.a2.map((r) => ({ ...r, zaklDane1: f2(r.zaklDane1), dan1: f2(r.dan1), zaklDane2: f2(r.zaklDane2), dan2: f2(r.dan2) }))).toEqual([{ cRadku: 1, kStat: 'NL', vatidDod: '805734958B01', cEvidDd: '1637922054', dppd: '2026-09-03', zaklDane1: '11549.94', dan1: '2425.49', zaklDane2: '0.00', dan2: '0.00', documentId: 'booking-aug' }]);
  });
  it('B2 credit note −12 000 is negative; B3 aggregate; dppd = duzp', () => {
    expect(kh.b2.map((r) => [r.cRadku, r.dicDod, r.cEvidDd, r.dppd, f2(r.zaklDane1), f2(r.dan1), r.pomer, r.zdph44])).toEqual([
      [1, '87654321', '2026090001', '2026-09-02', '10711.44', '2249.40', 'N', 'N'],
      [2, '87654321', 'DOB-7', '2026-09-15', '-9917.36', '-2082.64', 'N', 'N'],
    ]);
    expect([f2(kh.b3!.zaklDane1), f2(kh.b3!.dan1)]).toEqual(['990.08', '207.92']);
    expect(kh.entryCount).toBe(7);
  });
  it('Věta C mirrors the DPHDP3 (P1)', () => {
    expect(Object.fromEntries(Object.entries(kh.c).map(([k, m]) => [k, f2(m)]))).toEqual({ obrat23: '26529.00', obrat5: '0.00', pln23: '1784.00', pln5: '0.00', celkZdA2: '11550.00' });
  });
  it('two rates of one document land in one row (buckets 1 and 2); permutation gives identical output (P7)', () => {
    const two = [
      e('x', ['1'], '100.00', '21.00', { vatTreatment: 'iss_domestic_vat', khSection: 'A4', counterpartyVatId: 'CZ12345678', evidenceNumber: 'X-1' }),
      e('x', ['2'], '50.00', '6.00', { vatTreatment: 'iss_domestic_vat', vatRateType: 'reduced', vatRatePct: 12, khSection: 'A4', counterpartyVatId: 'CZ12345678', evidenceNumber: 'X-1' }),
    ];
    const a = computeKh(two, computeDphdp3(two, 'platce', rules, d('2026-09-01')), lookup);
    const b = computeKh([...two].reverse(), computeDphdp3([...two].reverse(), 'platce', rules, d('2026-09-01')), lookup);
    expect(a.a4).toHaveLength(1);
    expect([f2(a.a4[0]!.zaklDane1), f2(a.a4[0]!.dan1), f2(a.a4[0]!.zaklDane2), f2(a.a4[0]!.dan2)]).toEqual(['100.00', '21.00', '50.00', '6.00']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('empty sections are null/empty; vatIdParts', () => {
    const none = computeKh([], computeDphdp3([], 'platce', rules, d('2026-09-01')), lookup);
    expect([none.a2, none.a4, none.a5, none.b2, none.b3]).toEqual([[], [], null, [], null]);
    expect(vatIdParts('EL123456789')).toEqual({ kStat: 'EL', number: '123456789' });
    expect(vatIdParts(null)).toBeNull();
  });
});

describe('computeShv', () => {
  it('groups by country, VAT ID and code; Σ 1 000,10 + 2 000,20 = 3 000,30 → ceil 3 001; pln_pocet 2', () => {
    const sh = computeShv([
      e('s1', ['21'], '1000.10', '0.00', { vatTreatment: 'iss_eu_service', shvCode: 3, counterpartyVatId: 'DE123456789', vatPointDate: d('2026-09-05') }),
      e('s2', ['21'], '2000.20', '0.00', { vatTreatment: 'iss_eu_service', shvCode: 3, counterpartyVatId: 'DE123456789', vatPointDate: d('2026-09-20') }),
      e('g1', ['20'], '500.00', '0.00', { vatTreatment: 'iss_eu_goods', shvCode: 0, counterpartyVatId: 'AT U12345678', vatPointDate: d('2026-09-21') }),
      e('old', ['21'], '999.00', '0.00', { vatTreatment: 'iss_eu_service', shvCode: 3, counterpartyVatId: 'DE123456789', vatPointDate: d('2026-08-31') }),
    ], rules, d('2026-09-01'));
    expect(sh.rows.map((r) => [r.cRad, r.kStat, r.cVat, r.kPlnEu, f2(r.plnHodnota), r.plnPocet, r.porCStran])).toEqual([
      [1, 'AT', 'U12345678', 0, '500.00', 1, 1],
      [2, 'DE', '123456789', 3, '3001.00', 2, 1],
    ]);
    expect(f2(sh.total)).toBe('3501.00');
    expect(sh.rows[1]!.documentIds).toEqual(['s1', 's2']);
  });
  it('no SH entries → no rows', () => {
    expect(computeShv([e('x', ['1'], '1.00', '0.21')], rules, d('2026-09-01')).rows).toEqual([]);
  });
});
```
`vatIdParts` must drop inner spaces (`'AT U12345678'` → `U12345678`). Command: `pnpm --filter @shoebox/domain test -- kh 2>&1 | tail -30` (also runs `kh-routing`; both green).
4. Index lines; typecheck; commit `feat(domain): computeKh and computeShv (0334)`.

## 5. Do not touch

`epo.ts` (routing), `dphdp3.ts`, rules.

## 6. Commands

`pnpm --filter @shoebox/domain test -- kh 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Green; typecheck clean. Report lists `[verify]`: `c_radku` format, Věta C source, SH rounding of negative groups, `por_c_stran`.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0334-report.md`.

## Risk list

`kh.ts`, `shv.ts`.

## Owner steps

None.
