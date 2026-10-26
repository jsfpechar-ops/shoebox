# 0339: `serializeKh` and `serializeShv` with golden XML and P9

Status: todo
Ticket: P3-VAT-08 | Depends on: 0334, 0336, 0338 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 55k tokens

## 1. Objective

Serialize `KhComputation` and `ShvComputation` (0334) into DPHKH1 / DPHSHV XML through the 0336 writer, byte-match golden fixtures for the synthetic payer September, and prove with fast-check (200 runs) that every generated case passes `validateXml`.

## 2. Context

M05 §4.7 (pasted): DPHKH1 children `VetaD, VetaP, VetaA2*, VetaA4*, VetaA5?, VetaB2*, VetaB3?, VetaC?`; VetaD(KH) `dokument='KH1'`, `k_uladis='DPH'`, `rok`, `mesic|ctvrt`, `khdph_forma` (`radne`→`B`, `opravne`→`O`, `nasledne`→`N`), `d_poddp`, `d_zjist` (N only). DPHSHV children `VetaD, VetaP, VetaR*`; VetaD(SHV) `dokument='SHV'`, `k_uladis='DPH'`, `shvies_forma` (`radne`→`R`, `nasledne`→`N`), `rok`, `mesic`, `d_poddp`. VetaP as DPHDP3 (0338 order). KH amounts 2 decimals (`dec2Attr`), zero omitted; Věta C carries the DPHDP3 whole-Kč values written with two decimals (`26529.00`) **[verify]**; code attributes (`kod_rezim_pl="0"`, `zdph_44="N"`, `pomer="N"`, `k_pln_eu="0"`) are text and never omitted. SH `pln_hodnota` integer (`intAttr`), `pln_pocet`/`c_rad`/`por_c_stran` plain integers as text. Following-KH storno rows (`k_storno`) are 0347's concern (not emitted here).

Attribute orders: VetaD(KH) `dokument k_uladis khdph_forma rok mesic|ctvrt d_poddp d_zjist`; VetaA2 `c_radku k_stat vatid_dod c_evid_dd dppd zakl_dane1 dan1 zakl_dane2 dan2`; VetaA4 `c_radku dic_odb c_evid_dd dppd zakl_dane1 dan1 zakl_dane2 dan2 kod_rezim_pl zdph_44`; VetaA5/B3 `zakl_dane1 dan1 zakl_dane2 dan2`; VetaB2 `c_radku dic_dod c_evid_dd dppd zakl_dane1 dan1 zakl_dane2 dan2 pomer zdph_44`; VetaC `obrat23 obrat5 pln23 pln5 celk_zd_a2`; VetaD(SHV) `dokument k_uladis shvies_forma rok mesic d_poddp`; VetaR `c_rad por_c_stran k_stat c_vat k_pln_eu pln_pocet pln_hodnota`. VetaA5/VetaB3/VetaC are omitted when null / all-zero; VetaC omitted only when every value is zero.

`fast-check` 4.10.2 is in the workspace catalog (`packages/domain`); adding it to `packages/tax-xml` devDependencies introduces no new package (note it in the report for decisions.md).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/tax-xml/package.json` | edit | devDependencies `"fast-check": "4.10.2"`; then `pnpm install --offline 2>&1 | tail -5` |
| `packages/tax-xml/src/kh.ts` | create | `serializeKh(c: KhComputation, h: EpoHeader, opts: { verzePis: string }): string` |
| `packages/tax-xml/src/shv.ts` | create | `serializeShv(c: ShvComputation, h: EpoHeader, opts: { verzePis: string }): string` |
| `packages/tax-xml/src/index.ts` | edit | export both |
| `testdata/golden-v1/expected/vat/dphkh1-payer-2026-09.xml`, `dphshv-payer-2026-09.xml` | create | below |
| `packages/tax-xml/test/kh-shv.test.ts` | create | below |

## 4. Steps

1. package.json + install. 2. `kh.ts`, `shv.ts` (throw on `h.form` mismatch; `formaCode` from `@shoebox/domain`; `d_zjist` only when `h.kind === 'nasledne'`).
3. Golden `dphkh1-payer-2026-09.xml` (exact, LF, trailing newline; VetaP line identical to the 0338 goldens):
```
<?xml version="1.0" encoding="UTF-8"?>
<Pisemnost nazevSW="Shoebox" verzeSW="0.0.0">
  <DPHKH1 verzePis="03.01">
    <VetaD dokument="KH1" k_uladis="DPH" khdph_forma="B" rok="2026" mesic="9" d_poddp="20.10.2026"/>
    <VetaP c_ufo="451" c_pracufo="2003" dic="7801011229" typ_ds="F" jmeno="Jan" prijmeni="Novák" ulice="Vinohradská" c_pop="1" naz_obce="Praha" psc="13000" stat="ČESKÁ REPUBLIKA" email="jan@example.com"/>
    <VetaA2 c_radku="1" k_stat="NL" vatid_dod="805734958B01" c_evid_dd="1637922054" dppd="03.09.2026" zakl_dane1="11549.94" dan1="2425.49"/>
    <VetaA4 c_radku="1" dic_odb="12345678" c_evid_dd="2026-0001" dppd="10.09.2026" zakl_dane1="10000.00" dan1="2100.00" kod_rezim_pl="0" zdph_44="N"/>
    <VetaA4 c_radku="2" dic_odb="12345678" c_evid_dd="2026-0003" dppd="12.09.2026" zakl_dane1="8264.47" dan1="1735.54" kod_rezim_pl="0" zdph_44="N"/>
    <VetaA5 zakl_dane1="8264.46" dan1="1735.54"/>
    <VetaB2 c_radku="1" dic_dod="87654321" c_evid_dd="2026090001" dppd="02.09.2026" zakl_dane1="10711.44" dan1="2249.40" pomer="N" zdph_44="N"/>
    <VetaB2 c_radku="2" dic_dod="87654321" c_evid_dd="DOB-7" dppd="15.09.2026" zakl_dane1="-9917.36" dan1="-2082.64" pomer="N" zdph_44="N"/>
    <VetaB3 zakl_dane1="990.08" dan1="207.92"/>
    <VetaC obrat23="26529.00" pln23="1784.00" celk_zd_a2="11550.00"/>
  </DPHKH1>
</Pisemnost>
```
`dphshv-payer-2026-09.xml`:
```
<?xml version="1.0" encoding="UTF-8"?>
<Pisemnost nazevSW="Shoebox" verzeSW="0.0.0">
  <DPHSHV verzePis="02.01">
    <VetaD dokument="SHV" k_uladis="DPH" shvies_forma="R" rok="2026" mesic="9" d_poddp="20.10.2026"/>
    <VetaP c_ufo="451" c_pracufo="2003" dic="7801011229" typ_ds="F" jmeno="Jan" prijmeni="Novák" ulice="Vinohradská" c_pop="1" naz_obce="Praha" psc="13000" stat="ČESKÁ REPUBLIKA" email="jan@example.com"/>
    <VetaR c_rad="1" por_c_stran="1" k_stat="AT" c_vat="U12345678" k_pln_eu="0" pln_pocet="1" pln_hodnota="500"/>
    <VetaR c_rad="2" por_c_stran="1" k_stat="DE" c_vat="123456789" k_pln_eu="3" pln_pocet="2" pln_hodnota="3001"/>
  </DPHSHV>
</Pisemnost>
```
4. Test file verbatim:
```ts
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildEpoHeader, computeDphdp3, computeKh, computeShv, createCzRules, type EpoTaxpayerProfile, Money, parseLegalDate, type VatLedgerEntryDraft, vatForRate } from '@shoebox/domain';
import { serializeKh, serializeShv, validateXml } from '../src/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const START = d('2026-09-01');
const golden = (name: string) => readFileSync(new URL(`../../../testdata/golden-v1/expected/vat/${name}`, import.meta.url), 'utf8');
const PROFILE: EpoTaxpayerProfile = { vatStatus: 'platce', dic: 'CZ7801011229', firstName: 'Jan', lastName: 'Novák', title: null, address: { street: 'Vinohradská', house_number: '1', orientation_number: null, city: 'Praha', zip: '130 00' }, fuCode: '451', ufoCode: '2003', mainActivityNace: '5520', filingEmail: 'jan@example.com', filingPhone: null };
function header(form: 'DPHKH1' | 'DPHSHV', kind: 'radne' | 'nasledne' = 'radne') {
  const r = buildEpoHeader(PROFILE, { form, kind, period: { start: START, end: d('2026-09-30'), kind: 'month' }, preparedOn: d('2026-10-20'), discoveredOn: kind === 'nasledne' ? d('2026-11-02') : undefined, appVersion: '0.0.0' });
  if (!r.ok) throw new Error('header');
  return r.header;
}
const e = (documentId: string, rows: string[], base: string, vat: string, o: Partial<VatLedgerEntryDraft> = {}): VatLedgerEntryDraft => ({
  periodStart: START, periodEnd: d('2026-09-30'), vatPointDate: d('2026-09-03'), vatPointRule: 'issue_date', lineId: null, documentId,
  vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', vatRatePct: 21, baseCzk: czk(base), vatCzk: czk(vat), deductionPct: '100', currency: 'CZK',
  baseForeign: null, fxRate: null, fxAmount: null, fxRateDate: null, dphdp3Rows: rows, khSection: null, khDocumentTotalCzk: null, shvCode: null, counterpartyVatId: null, evidenceNumber: documentId, ...o,
});
const SEP: VatLedgerEntryDraft[] = [
  e('inv-a', ['1'], '10000.00', '2100.00', { vatTreatment: 'iss_domestic_vat', khSection: 'A4', counterpartyVatId: 'CZ12345678', evidenceNumber: '2026-0001', vatPointDate: d('2026-09-10') }),
  e('inv-b', ['1'], '8264.46', '1735.54', { vatTreatment: 'iss_domestic_vat', khSection: 'A5', counterpartyVatId: 'CZ12345678', evidenceNumber: '2026-0002', vatPointDate: d('2026-09-11') }),
  e('inv-c', ['1'], '8264.47', '1735.54', { vatTreatment: 'iss_domestic_vat', khSection: 'A4', counterpartyVatId: 'CZ12345678', evidenceNumber: '2026-0003', vatPointDate: d('2026-09-12') }),
  e('booking-aug', ['5', '43'], '11549.94', '2425.49', { khSection: 'A2', counterpartyVatId: 'NL805734958B01', evidenceNumber: '1637922054' }),
  e('manager', ['40'], '10711.44', '2249.40', { vatTreatment: 'rcv_domestic_vat', khSection: 'B2', counterpartyVatId: 'CZ87654321', evidenceNumber: '2026090001', vatPointDate: d('2026-09-02') }),
  e('ikea', ['40'], '990.08', '207.92', { vatTreatment: 'rcv_domestic_vat', khSection: 'B3', evidenceNumber: 'R-0757' }),
  e('credit', ['40'], '-9917.36', '-2082.64', { vatTreatment: 'rcv_domestic_vat', khSection: 'B2', counterpartyVatId: 'CZ87654321', evidenceNumber: 'DOB-7', vatPointDate: d('2026-09-15') }),
  e('s1', ['21'], '1000.10', '0.00', { vatTreatment: 'iss_eu_service', shvCode: 3, counterpartyVatId: 'DE123456789', vatPointDate: d('2026-09-05') }),
  e('s2', ['21'], '2000.20', '0.00', { vatTreatment: 'iss_eu_service', shvCode: 3, counterpartyVatId: 'DE123456789', vatPointDate: d('2026-09-20') }),
  e('g1', ['20'], '500.00', '0.00', { vatTreatment: 'iss_eu_goods', shvCode: 0, counterpartyVatId: 'ATU12345678', vatPointDate: d('2026-09-21') }),
];
const lookup = (id: string) => ({ manager: { duzp: d('2026-09-02'), partnerCountry: 'CZ' }, credit: { duzp: d('2026-09-15'), partnerCountry: 'CZ' } }[id]);

describe('serializeKh / serializeShv golden', () => {
  it('DPHKH1 byte-matches and validates', async () => {
    const xml = serializeKh(computeKh(SEP, computeDphdp3(SEP, 'platce', rules, START), lookup), header('DPHKH1'), { verzePis: '03.01' });
    expect(xml).toBe(golden('dphkh1-payer-2026-09.xml'));
    const v = await validateXml(xml, 'DPHKH1', '03.01.15');
    expect(v.valid, JSON.stringify(v.errors)).toBe(true);
  });
  it('DPHSHV byte-matches and validates', async () => {
    const xml = serializeShv(computeShv(SEP, rules, START), header('DPHSHV'), { verzePis: '02.01' });
    expect(xml).toBe(golden('dphshv-payer-2026-09.xml'));
    expect((await validateXml(xml, 'DPHSHV', '02.01.05')).valid).toBe(true);
  });
  it('následné KH writes N and d_zjist; empty KH has VetaD/VetaP only', () => {
    const xml = serializeKh(computeKh(SEP, computeDphdp3(SEP, 'platce', rules, START), lookup), header('DPHKH1', 'nasledne'), { verzePis: '03.01' });
    expect(xml).toContain('khdph_forma="N" rok="2026" mesic="9" d_poddp="20.10.2026" d_zjist="02.11.2026"');
    const empty = serializeKh(computeKh([], computeDphdp3([], 'platce', rules, START), lookup), header('DPHKH1'), { verzePis: '03.01' });
    expect(empty.match(/<Veta/g)).toHaveLength(2);
  });
});

describe('P9: every generated payer period is structurally valid (200 runs)', () => {
  type Kind = 'iss_domestic' | 'rcv_domestic' | 'eu_service' | 'eu_goods_out' | 'eu_service_out';
  const docArb = (idx: number) => fc.record({
    kind: fc.constantFrom<Kind>('iss_domestic', 'rcv_domestic', 'eu_service', 'eu_goods_out', 'eu_service_out'),
    rate: fc.constantFrom<'standard' | 'reduced'>('standard', 'reduced'),
    cents: fc.integer({ min: 1, max: 1_500_000 }), sign: fc.constantFrom<1 | -1>(1, 1, 1, -1), big: fc.boolean(), idx: fc.constant(idx),
    evid: fc.stringMatching(/^[A-Za-z0-9ěščřžýáíé<&"' -]{1,20}$/),
  });
  const periodArb = fc.integer({ min: 0, max: 40 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => docArb(i))));
  function toEntry(x: { kind: Kind; rate: 'standard' | 'reduced'; cents: number; sign: 1 | -1; big: boolean; idx: number; evid: string }): VatLedgerEntryDraft {
    const base = czk(((x.cents * x.sign) / 100).toFixed(2));
    const pct = x.rate === 'standard' ? '21' : '12';
    const day = d(`2026-09-${String(1 + (x.idx % 28)).padStart(2, '0')}`);
    const common = { documentId: `doc-${x.idx}`, vatRateType: x.rate, vatRatePct: Number(pct), evidenceNumber: x.evid, vatPointDate: day } as const;
    switch (x.kind) {
      case 'iss_domestic': return e(common.documentId, [x.rate === 'standard' ? '1' : '2'], base.toFixed2(), vatForRate(base, pct).toFixed2(), { ...common, vatTreatment: 'iss_domestic_vat', khSection: x.big ? 'A4' : 'A5', counterpartyVatId: 'CZ12345678' });
      case 'rcv_domestic': return e(common.documentId, [x.rate === 'standard' ? '40' : '41'], base.toFixed2(), vatForRate(base, pct).toFixed2(), { ...common, vatTreatment: 'rcv_domestic_vat', khSection: x.big ? 'B2' : 'B3', counterpartyVatId: 'CZ87654321' });
      case 'eu_service': return e(common.documentId, x.rate === 'standard' ? ['5', '43'] : ['6', '44'], base.toFixed2(), vatForRate(base, pct).toFixed2(), { ...common, khSection: 'A2', counterpartyVatId: 'DE123456789' });
      case 'eu_goods_out': return e(common.documentId, ['20'], base.toFixed2(), '0.00', { ...common, vatTreatment: 'iss_eu_goods', shvCode: 0, counterpartyVatId: 'ATU12345678' });
      case 'eu_service_out': return e(common.documentId, ['21'], base.toFixed2(), '0.00', { ...common, vatTreatment: 'iss_eu_service', shvCode: 3, counterpartyVatId: 'FR12345678901' });
    }
  }
  it('KH and SH', async () => {
    await fc.assert(fc.asyncProperty(periodArb, async (docs) => {
      const entries = docs.map(toEntry);
      const dp3 = computeDphdp3(entries, 'platce', rules, START);
      const kh = await validateXml(serializeKh(computeKh(entries, dp3, () => undefined), header('DPHKH1'), { verzePis: '03.01' }), 'DPHKH1', '03.01.15');
      expect(kh.valid, JSON.stringify(kh.errors)).toBe(true);
      const sh = await validateXml(serializeShv(computeShv(entries, rules, START), header('DPHSHV'), { verzePis: '02.01' }), 'DPHSHV', '02.01.05');
      expect(sh.valid, JSON.stringify(sh.errors)).toBe(true);
    }), { numRuns: 200 });
  });
});
```
The `evid` generator includes `< & " '` and diacritics on purpose: escaping must round-trip through `parseEpoXml`. Command: `pnpm --filter @shoebox/tax-xml test 2>&1 | tail -30`.
5. Commit `feat(tax-xml): serializeKh, serializeShv, golden, P9 (0339)`.

## 5. Do not touch

`xml.ts`, `forms.ts`, `validate.ts`, `dphdp3.ts`, `packages/domain`.

## 6. Commands

`pnpm --filter @shoebox/tax-xml test 2>&1 | tail -30` · `pnpm --filter @shoebox/tax-xml typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Goldens byte-match; P9 200 runs green; report notes the fast-check devDependency and the `[verify]` items (Věta C decimals, `c_radku` width, `por_c_stran`).

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0339-report.md`.

## Risk list

`kh.ts`, `shv.ts`, golden files.

## Owner steps

1. Decisions line: "2026-10-26 `fast-check` added to `@shoebox/tax-xml` devDependencies (already in the workspace; no new package)".
