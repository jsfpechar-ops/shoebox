# 0338: `serializeDphdp3` with golden XML

Status: todo
Ticket: P3-VAT-07 | Depends on: 0329, 0333, 0336 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 55k tokens

## 1. Objective

Serialize a `Dphdp3Computation` + `EpoHeader` into the EPO DPHDP3 XML, table-driven from the row map (attribute names never typed in the serializer), byte-matching four golden files (P4 August/September/October as an identified person, one synthetic payer month) and passing `validateXml`.

## 2. Context

M05 §4.7 VetaD/VetaP mapping is encoded by 0329 (`EpoHeader`, `formaCode`). Attribute orders (byte-determinism): VetaD `dokument k_uladis dapdph_forma typ_platce rok mesic|ctvrt trans c_okec d_poddp d_zjist`; VetaP `c_ufo c_pracufo dic typ_ds jmeno prijmeni titul ulice c_pop c_orient naz_obce psc stat email c_telef` (`stat` = `ČESKÁ REPUBLIKA` constant, `typ_ds` = `F`); Veta1/Veta2/Veta4 attributes in **row-map order** (`CZ_DPHDP3_ROW_MAP` order: rows 1,2,3,4,5,6,10,11,12,13 → Veta1; 20,21,22,25,26 → Veta2; 40,41,42 → Veta4, then derived 43,44,46), Veta6 `dan_zocelk odp_zocelk dano_da dano_no dano`. Which Věta a row belongs to: rows 1–19 Veta1, 20–39 Veta2, 40–49 Veta4, 50–59 Veta5, 60–69 Veta6. Zero/empty attributes omitted; Veta1/2/4/5 omitted when empty; Veta6 always present and for a nil return written as `dano_da="0"` **[verify nil form]**. Amounts via `intAttr` (whole Kč), dates via `dateAttr`.

Derived rows are not in the treatment row map (its schema needs a treatment). Add to `packages/domain/src/rules/cz/epo.ts` (data only, after `CZ_DPHDP3_ROW_MAP`):
```ts
/** Derived DPHDP3 rows (M05 §4.4 step 4, §4.6): attrs [base, tax] or [value]; `confirmed:false` until checked against the XSD (T-02). */
export const CZ_DPHDP3_DERIVED_ROWS: readonly { row: string; attrs: readonly string[]; confirmed: boolean }[] = [
  { row: '43', attrs: ['nar_zdp23', 'od_zdp23'], confirmed: true },
  { row: '44', attrs: ['nar_zdp5', 'od_zdp5'], confirmed: false },
  { row: '46', attrs: ['odp_sum_nar'], confirmed: false },
  { row: '62', attrs: ['dan_zocelk'], confirmed: false },
  { row: '63', attrs: ['odp_zocelk'], confirmed: false },
  { row: '64', attrs: ['dano_da'], confirmed: false },
  { row: '65', attrs: ['dano_no'], confirmed: false },
  { row: '66', attrs: ['dano'], confirmed: false },
];
```
Golden values (0333): Aug row 5 13 700/2 877, ř.62=ř.64=2 877 · Sep row 5 11 550/2 425 · Oct row 5 2 212/465 + row 12 245/52, ř.62=517 · payer Sep rows 1 26 529/5 571, 5 11 550/2 425, 40 1 784/375, 43 11 550/2 425, 46 2 800, ř.62 7 996, ř.63 2 800, ř.64 5 196. Header profile = 0329's `FULL` (c_ufo 451, c_pracufo 2003, dic 7801011229, Jan Novák, Vinohradská 1, Praha 13000, jan@example.com, NACE 552000); preparedOn 20.09.2026 / 20.10.2026 / 20.11.2026 / payer 20.10.2026; appVersion `0.0.0`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/cz/epo.ts` | edit | append `CZ_DPHDP3_DERIVED_ROWS` (exported through the existing `export * from './rules/cz/epo'`) |
| `packages/tax-xml/src/dphdp3.ts` | create | `serializeDphdp3`, `vetaOfRow` |
| `packages/tax-xml/src/index.ts` | edit | `export * from './dphdp3';` |
| `testdata/golden-v1/expected/vat/dphdp3-2026-08.xml`, `dphdp3-2026-09.xml`, `dphdp3-2026-10.xml`, `dphdp3-payer-2026-09.xml` | create | below (exact bytes, LF, trailing newline) |
| `packages/tax-xml/test/dphdp3.test.ts` | create | below |

## 4. Steps

1. epo.ts constant. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.
2. `dphdp3.ts` exports exactly:
```ts
export function vetaOfRow(row: string): 'Veta1' | 'Veta2' | 'Veta4' | 'Veta5' | 'Veta6';
export interface Dphdp3SerializeOptions { readonly verzePis: string; readonly rowMap?: Dphdp3RowMap; readonly derived?: typeof CZ_DPHDP3_DERIVED_ROWS; readonly row66?: Money }   // defaults: CZ_DPHDP3_ROW_MAP, CZ_DPHDP3_DERIVED_ROWS
export function serializeDphdp3(c: Dphdp3Computation, h: EpoHeader, opts: Dphdp3SerializeOptions): string;
```
Throws `Error('dphdp3: header form mismatch')` unless `h.form === 'DPHDP3'`; `Error('dphdp3: row N has no attrs')` when a non-zero row lacks attrs; `formaCode(h.form, h.kind) === null` → throw. `c_okec` = `h.naceCode6 ?? null`; `d_zjist` = `h.discoveredOn` (dodatecne only). ř.62–65 come from `c.row62…row65` through the derived attrs (62/63/64/65), ř.66 from `opts.row66`.
3. Golden files. `dphdp3-2026-08.xml` is exactly the `AUG` string of the 0336 test. `dphdp3-2026-09.xml`: same with `mesic="9"`, `d_poddp="20.10.2026"`, `<Veta1 p_sl23_e="11550" dan_psl23_e="2425"/>`, `<Veta6 dan_zocelk="2425" dano_da="2425"/>`. `dphdp3-2026-10.xml`: `mesic="10"`, `d_poddp="20.11.2026"`, `<Veta1 p_sl23_e="2212" dan_psl23_e="465" p_sl23_z="245" dan_psl23_z="52"/>`, `<Veta6 dan_zocelk="517" dano_da="517"/>`. `dphdp3-payer-2026-09.xml`: `typ_platce="P"`, `mesic="9"`, `d_poddp="20.10.2026"`, then
```
    <Veta1 obrat23="26529" dan23="5571" p_sl23_e="11550" dan_psl23_e="2425"/>
    <Veta4 pln23="1784" odp_tuz23_nar="375" nar_zdp23="11550" od_zdp23="2425" odp_sum_nar="2800"/>
    <Veta6 dan_zocelk="7996" odp_zocelk="2800" dano_da="5196"/>
```
4. Test file verbatim:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEpoHeader, computeDphdp3, createCzRules, type EpoTaxpayerProfile, Money, parseLegalDate, type VatLedgerEntryDraft } from '@shoebox/domain';
import { serializeDphdp3, validateXml, vetaOfRow } from '../src/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const golden = (name: string) => readFileSync(new URL(`../../../testdata/golden-v1/expected/vat/${name}`, import.meta.url), 'utf8');
const PROFILE: EpoTaxpayerProfile = { vatStatus: 'identifikovana_osoba', dic: 'CZ7801011229', firstName: 'Jan', lastName: 'Novák', title: null, address: { street: 'Vinohradská', house_number: '1', orientation_number: null, city: 'Praha', zip: '130 00' }, fuCode: '451', ufoCode: '2003', mainActivityNace: '5520', filingEmail: 'jan@example.com', filingPhone: null };
const e = (documentId: string, rows: string[], base: string, vat: string, o: Partial<VatLedgerEntryDraft> = {}): VatLedgerEntryDraft => ({
  periodStart: d('2026-08-01'), periodEnd: d('2026-08-31'), vatPointDate: d('2026-08-03'), vatPointRule: 'issue_date', lineId: null, documentId,
  vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', vatRatePct: 21, baseCzk: czk(base), vatCzk: czk(vat), deductionPct: '100', currency: 'CZK',
  baseForeign: null, fxRate: null, fxAmount: null, fxRateDate: null, dphdp3Rows: rows, khSection: null, khDocumentTotalCzk: null, shvCode: null, counterpartyVatId: null, evidenceNumber: documentId, ...o,
});
function header(status: 'identifikovana_osoba' | 'platce', start: string, end: string, preparedOn: string) {
  const r = buildEpoHeader({ ...PROFILE, vatStatus: status }, { form: 'DPHDP3', kind: 'radne', period: { start: d(start), end: d(end), kind: 'month' }, preparedOn: d(preparedOn), appVersion: '0.0.0' });
  if (!r.ok) throw new Error('header');
  return r.header;
}
const V = { verzePis: '03.01' };
const cases = [
  { file: 'dphdp3-2026-08.xml', status: 'identifikovana_osoba' as const, start: '2026-08-01', end: '2026-08-31', prepared: '2026-09-20', entries: [e('booking-jul', ['5'], '13699.77', '2876.95')] },
  { file: 'dphdp3-2026-09.xml', status: 'identifikovana_osoba' as const, start: '2026-09-01', end: '2026-09-30', prepared: '2026-10-20', entries: [e('booking-aug', ['5'], '11549.94', '2425.49')] },
  { file: 'dphdp3-2026-10.xml', status: 'identifikovana_osoba' as const, start: '2026-10-01', end: '2026-10-31', prepared: '2026-11-20', entries: [e('cloudflare', ['12'], '245.35', '51.52', { vatTreatment: 'rcv_non_eu_service_reverse_charge' }), e('anthropic', ['5'], '2212.20', '464.56')] },
  { file: 'dphdp3-payer-2026-09.xml', status: 'platce' as const, start: '2026-09-01', end: '2026-09-30', prepared: '2026-10-20', entries: [
    e('inv-a', ['1'], '10000.00', '2100.00', { vatTreatment: 'iss_domestic_vat' }), e('inv-b', ['1'], '8264.46', '1735.54', { vatTreatment: 'iss_domestic_vat' }), e('inv-c', ['1'], '8264.47', '1735.54', { vatTreatment: 'iss_domestic_vat' }),
    e('booking-aug', ['5', '43'], '11549.94', '2425.49'), e('manager', ['40'], '10711.44', '2249.40', { vatTreatment: 'rcv_domestic_vat' }), e('ikea', ['40'], '990.08', '207.92', { vatTreatment: 'rcv_domestic_vat' }), e('credit', ['40'], '-9917.36', '-2082.64', { vatTreatment: 'rcv_domestic_vat' }) ] },
];

describe('serializeDphdp3 golden (M05 §9 #1–#3, #6)', () => {
  for (const c of cases) {
    it(`${c.file} byte-matches and validates`, async () => {
      const comp = computeDphdp3(c.entries, c.status, rules, d(c.start));
      const xml = serializeDphdp3(comp, header(c.status, c.start, c.end, c.prepared), V);
      expect(xml).toBe(golden(c.file));
      const v = await validateXml(xml, 'DPHDP3', '03.01.04');
      expect(v.valid, JSON.stringify(v.errors)).toBe(true);
    });
  }
  it('August: Veta1 p_sl23_e/dan_psl23_e, Veta6 dan_zocelk, no Veta4, no Veta2', () => {
    const xml = golden('dphdp3-2026-08.xml');
    expect(xml).toContain('p_sl23_e="13700" dan_psl23_e="2877"');
    expect(xml).toContain('dan_zocelk="2877"');
    expect(xml).not.toContain('<Veta4');
    expect(xml).not.toContain('<Veta2');
    expect(xml).toContain('typ_platce="I"');
  });
  it('P7: entry permutation gives identical bytes', () => {
    const c = cases[3]!;
    const a = serializeDphdp3(computeDphdp3(c.entries, 'platce', rules, d(c.start)), header('platce', c.start, c.end, c.prepared), V);
    const b = serializeDphdp3(computeDphdp3([...c.entries].reverse(), 'platce', rules, d(c.start)), header('platce', c.start, c.end, c.prepared), V);
    expect(a).toBe(b);
  });
  it('nil payer return keeps Veta6 with dano_da="0"; dodatecne writes D and d_zjist and dano', () => {
    const nil = serializeDphdp3(computeDphdp3([], 'platce', rules, d('2026-09-01')), header('platce', '2026-09-01', '2026-09-30', '2026-10-20'), V);
    expect(nil).toContain('<Veta6 dano_da="0"/>');
    expect(nil).toContain('trans="N"');
    const hd = buildEpoHeader({ ...PROFILE, vatStatus: 'platce' }, { form: 'DPHDP3', kind: 'dodatecne', period: { start: d('2026-09-01'), end: d('2026-09-30'), kind: 'month' }, preparedOn: d('2026-12-01'), discoveredOn: d('2026-11-30'), appVersion: '0.0.0' });
    if (!hd.ok) throw new Error('header');
    const dod = serializeDphdp3(computeDphdp3(cases[3]!.entries, 'platce', rules, d('2026-09-01')), hd.header, { ...V, row66: czk('100.00') });
    expect(dod).toContain('dapdph_forma="D"');
    expect(dod).toContain('d_zjist="30.11.2026"');
    expect(dod).toContain('dano_da="5196" dano="100"');
  });
  it('vetaOfRow and header guards', () => {
    expect(['1', '21', '40', '50', '62'].map(vetaOfRow)).toEqual(['Veta1', 'Veta2', 'Veta4', 'Veta5', 'Veta6']);
    const h = { ...header('platce', '2026-09-01', '2026-09-30', '2026-10-20'), form: 'DPHKH1' as const };
    expect(() => serializeDphdp3(computeDphdp3([], 'platce', rules, d('2026-09-01')), h, V)).toThrow(/mismatch/);
  });
});
```
Command: `pnpm --filter @shoebox/tax-xml test -- dphdp3 2>&1 | tail -30`; also `pnpm eval --quick 2>&1 | tail -30` (testdata changed; expected: unchanged pass/fail counts).
5. Commit `feat(tax-xml): serializeDphdp3 + golden XML (0338)`.

## 5. Do not touch

`xml.ts`, `forms.ts`, `validate.ts` (if a golden fails structural validation, the data in `forms.ts` or this brief is wrong: STOP and report the exact error).

## 6. Commands

`pnpm --filter @shoebox/tax-xml test -- dphdp3 2>&1 | tail -30` · `pnpm --filter @shoebox/tax-xml typecheck 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` · `pnpm eval --quick 2>&1 | tail -30`

## 7. Acceptance

- [ ] Four goldens byte-match and validate (structural now; XSD once vendored); P7 holds.
- [ ] Report lists every T-02 attribute decision: derived attrs 44/46/62–66 `confirmed:false`, nil-return `dano_da="0"`, `c_okec` emitted for IO, `verzePis="03.01"`.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0338-report.md`.

## Risk list

`dphdp3.ts`, the golden files, `epo.ts` constant.

## Owner steps

1. After vendoring the XSDs (0336 owner step), re-run this test; any failure is a T-02 finding to record in 22 §C.
