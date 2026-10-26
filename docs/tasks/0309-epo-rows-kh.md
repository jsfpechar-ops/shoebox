# 0309: `epo.dphdp3_row_map` and `epo.kh_routing` as typed rule data, `resolveDphdp3Rows`, `resolveKhSection`

Status: done
Ticket: P1-LEDG-02 (a) | Depends on: none | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Put the DPHDP3 row numbers and the control-statement (KH) routing into data with a strict schema, and resolve rows and KH sections from that data only, so a form change edits one table and no row number lives in logic. Tests cover every row of the M04 §4.10 table for payers and identified persons and the 10 000 Kč boundary.

## 2. Context

Hard rule 1: row maps and the KH limit are rule data. The law schema `epo.dphdp3_row_map` in `packages/domain/src/rules/law.ts` is a `looseObject` with `row`, `attrs` (required, min 1), `treatment`, `side`; this brief makes `attrs` optional there (rows whose XML attribute names are not yet verified carry none) and defines the strict row schema in the new file. `epo.kh_routing` is `ModuleOwnedRecord` (loose); the strict schema lives in the new file too. Seeding into `2025.ts`/`2026.ts` is brief 0310.

M04 §4.10 row table (pasted; P = `platce`, I = `identifikovana_osoba`):

| vat_treatment | rate | P rows | I rows |
|---|---|---|---|
| `rcv_domestic_vat` | standard / reduced | `{40}` / `{41}` (only when the deduction is allowed) | — |
| `rcv_eu_service_reverse_charge` | standard / reduced | `{5,43}` / `{6,44}` | `{5}` / `{6}` |
| `rcv_non_eu_service_reverse_charge` | standard / reduced | `{12,43}` / `{13,44}` | `{12}` / `{13}` |
| `rcv_eu_goods_acquisition` | standard / reduced | `{3,43}` / `{4,44}` | `{3}` / `{4}` only after `vat.io_eu_goods_threshold` exceeded, else — (see spec note 1: seeded as — for I) |
| `rcv_domestic_reverse_charge` | standard / reduced | `{10,43}` / `{11,44}` | — |
| `rcv_import_customs` | any | `{42}` (deduction row; only when allowed) | — |
| `iss_domestic_vat` | standard / reduced | `{1}` / `{2}` | — |
| `iss_eu_service` | any | `{21}` | `{}` (SH only) |
| `iss_eu_goods` / `iss_non_eu_service` / `iss_export_goods` / `iss_domestic_reverse_charge` / `iss_exempt` | any | `{20}` / `{26}` / `{22}` / `{25}` / `{50}` | — |
| `rcv_domestic_no_vat`, `rcv_foreign_vat_charged`, `rcv_out_of_scope`, `iss_no_vat` | | no entry | no entry |

For payers the deduction row (43/44, and the self-contained 40/41/42) is included only when the deduction is allowed (`deductionAllowed`: `tax_doc_status ∈ {full, simplified, foreign}`, no open deduction-blocking check, `deduction_pct > 0`; the caller computes it). `neplatce` → `[]` always.

XML attribute names (research/czech-tax-filings.md §2, [O] = official sample, [I] = inferred, to `[verify against XSD]` in Phase 3): 1 `obrat23/dan23` [O], 2 `obrat5/dan5` [O], 3 `p_zb23/dan_pzb23` [O], 4 `p_zb5/dan_pzb5` [O], 5 `p_sl23_e/dan_psl23_e` [O], 6 `p_sl5_e/dan_psl5_e` [O], 10 `rez_pren23/dan_rpren23` [O], 11 `rez_pren5/dan_rpren5` [O], 12 `p_sl23_z/dan_psl23_z` [O], 13 `p_sl5_z/dan_psl5_z` [O], 20 `dod_zb` [O], 21 `pln_sluzby` [O], 22 `pln_vyvoz` [O], 25 `pln_rez_pren` [O], 26 `pln_ost` [O], 40 `pln23/odp_tuz23_nar` [I], 41 `pln5/odp_tuz5_nar` [I], 42 `dov_cu/odp_cu_nar` [I], 43 `nar_zdp23/od_zdp23` [O], 44 `nar_zdp5/od_zdp5` [O]/[I], 50 `plnosv_nkf` [I]. `confirmed: true` only for [O].

M05 §4.2 step 8 KH routing (pasted; M05 wins over the M04 sketch):

```
docTotal = |documents.total_gross converted to CZK|   // whole document incl. VAT, all lines; credit notes: absolute value
iss_domestic_vat:  partner.dic startsWith 'CZ' && docTotal > kh_document_limit ? 'A4' : 'A5'
self-assessed (rcv_eu_service_*, rcv_non_eu_service_*, rcv_eu_goods_acquisition): 'A2'
rcv_domestic_vat:  partner.dic startsWith 'CZ' && docTotal > kh_document_limit && tax_doc_status = 'full_tax_document' ? 'B2' : 'B3'
rcv_domestic_reverse_charge: 'B1';  iss_domestic_reverse_charge: 'A1'
iss_eu_*, iss_non_eu_service, rcv_import_customs, every no-entry treatment: null
```
Only when `vat_status='platce'`; else `null`. Boundary: `> 10 000.00` strictly (`vat.kh_document_limit`, seeded 10 000).

Existing API: `Money` (`abs`, `compare`, `Money.parse(String(limit), 'CZK')`), enums `VatTreatment`, `VatRateType`, `VatStatus`, `TaxDocStatus`, `VAT_TREATMENT_VALUES`; `zod` (`z.enum(VAT_TREATMENT_VALUES)`), `Identifier` atom. Lint: no `Number()`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/law.ts` | edit | `attrs` optional on `Dphdp3Row` |
| `packages/domain/src/rules/cz/epo.ts` | create | schemas, seed constants, resolvers |
| `packages/domain/test/epo-rows.test.ts` | create | verbatim below |
| `packages/domain/test/kh-routing.test.ts` | create | verbatim below |

(`src/index.ts` export happens in brief 0310 together with the seeding.)

## 4. Steps

1. Edit `packages/domain/src/rules/law.ts`. Anchor:

```ts
const Dphdp3Row = z.looseObject({
  row: z.string().min(1),
  attrs: z.array(z.string().min(1)).min(1),
  treatment: Identifier,
  side: z.enum(['input', 'output']),
});
```

Replace with:

```ts
// The strict row shape (rate, statuses, deduction_row, confirmed) is `Dphdp3RowSchema` in cz/epo.ts;
// `attrs` is optional here because rows whose XML attribute names are unverified carry none yet.
const Dphdp3Row = z.looseObject({
  row: z.string().min(1),
  attrs: z.array(z.string().min(1)).min(1).optional(),
  treatment: Identifier,
  side: z.enum(['input', 'output']),
});
```

Command: `pnpm --filter @shoebox/domain test -- rules-law 2>&1 | tail -30`. Expected: green (the existing `bad` sample `attrs: []` still fails `.min(1)`).

2. Create `packages/domain/test/epo-rows.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import type { VatRateType, VatStatus, VatTreatment } from '../src/enums/index';
import {
  CZ_DPHDP3_ROW_MAP,
  Dphdp3RowMapSchema,
  parseDphdp3RowMap,
  resolveDphdp3Rows,
} from '../src/rules/cz/epo';

// M04 §4.10 table, one case per row for platce (P) and identifikovana_osoba (I), with deduction
// allowed unless stated. Row numbers appear here and in the seed only.
type Case = [VatTreatment, VatRateType, string[], string[]];
const CASES: Case[] = [
  ['rcv_domestic_vat', 'standard', ['40'], []],
  ['rcv_domestic_vat', 'reduced', ['41'], []],
  ['rcv_eu_service_reverse_charge', 'standard', ['5', '43'], ['5']],
  ['rcv_eu_service_reverse_charge', 'reduced', ['6', '44'], ['6']],
  ['rcv_non_eu_service_reverse_charge', 'standard', ['12', '43'], ['12']],
  ['rcv_non_eu_service_reverse_charge', 'reduced', ['13', '44'], ['13']],
  ['rcv_eu_goods_acquisition', 'standard', ['3', '43'], []],
  ['rcv_eu_goods_acquisition', 'reduced', ['4', '44'], []],
  ['rcv_domestic_reverse_charge', 'standard', ['10', '43'], []],
  ['rcv_domestic_reverse_charge', 'reduced', ['11', '44'], []],
  ['rcv_import_customs', 'standard', ['42'], []],
  ['rcv_import_customs', 'none', ['42'], []],
  ['iss_domestic_vat', 'standard', ['1'], []],
  ['iss_domestic_vat', 'reduced', ['2'], []],
  ['iss_eu_service', 'none', ['21'], []],
  ['iss_eu_goods', 'none', ['20'], []],
  ['iss_non_eu_service', 'none', ['26'], []],
  ['iss_export_goods', 'none', ['22'], []],
  ['iss_domestic_reverse_charge', 'none', ['25'], []],
  ['iss_exempt', 'none', ['50'], []],
  ['rcv_domestic_no_vat', 'none', [], []],
  ['rcv_foreign_vat_charged', 'standard', [], []],
  ['rcv_out_of_scope', 'none', [], []],
  ['iss_no_vat', 'none', [], []],
];

describe('resolveDphdp3Rows (M04 §4.10, M05 §4.6)', () => {
  it.each(CASES)('%s %s → P %j, I %j', (treatment, rate, p, i) => {
    expect(resolveDphdp3Rows(treatment, rate, 'platce', true, CZ_DPHDP3_ROW_MAP)).toEqual(p);
    expect(resolveDphdp3Rows(treatment, rate, 'identifikovana_osoba', true, CZ_DPHDP3_ROW_MAP)).toEqual(i);
    expect(resolveDphdp3Rows(treatment, rate, 'neplatce', true, CZ_DPHDP3_ROW_MAP)).toEqual([]);
  });

  it('a payer without the right to deduct gets no deduction row (and no 40/41/42 at all)', () => {
    expect(resolveDphdp3Rows('rcv_domestic_vat', 'standard', 'platce', false, CZ_DPHDP3_ROW_MAP)).toEqual([]);
    expect(resolveDphdp3Rows('rcv_import_customs', 'standard', 'platce', false, CZ_DPHDP3_ROW_MAP)).toEqual([]);
    expect(resolveDphdp3Rows('rcv_eu_service_reverse_charge', 'standard', 'platce', false, CZ_DPHDP3_ROW_MAP)).toEqual(['5']);
    expect(resolveDphdp3Rows('rcv_eu_goods_acquisition', 'reduced', 'platce', false, CZ_DPHDP3_ROW_MAP)).toEqual(['4']);
    expect(resolveDphdp3Rows('iss_domestic_vat', 'standard', 'platce', false, CZ_DPHDP3_ROW_MAP)).toEqual(['1']);
  });

  it('zero/none rates have no domestic row; a rate-specific row never fires on "any"', () => {
    expect(resolveDphdp3Rows('rcv_domestic_vat', 'zero', 'platce', true, CZ_DPHDP3_ROW_MAP)).toEqual([]);
    expect(resolveDphdp3Rows('rcv_eu_service_reverse_charge', 'none', 'platce', true, CZ_DPHDP3_ROW_MAP)).toEqual([]);
  });

  it('rows come only from the map: an empty map yields nothing; a map with another number yields that number', () => {
    expect(resolveDphdp3Rows('iss_domestic_vat', 'standard', 'platce', true, [])).toEqual([]);
    const custom = parseDphdp3RowMap([
      { row: '99', treatment: 'iss_domestic_vat', rate: 'standard', statuses: ['platce'], side: 'output', confirmed: false },
    ]);
    expect(resolveDphdp3Rows('iss_domestic_vat', 'standard', 'platce', true, custom)).toEqual(['99']);
  });

  it('seed integrity: strict schema, unique (row, rate), official attrs confirmed, derived rows absent', () => {
    expect(Dphdp3RowMapSchema.safeParse(CZ_DPHDP3_ROW_MAP).success).toBe(true);
    const keys = CZ_DPHDP3_ROW_MAP.map((r) => `${r.row}:${r.rate}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(CZ_DPHDP3_ROW_MAP.map((r) => r.row).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))).toEqual(
      ['1', '2', '3', '4', '5', '6', '10', '11', '12', '13', '20', '21', '22', '25', '26', '40', '41', '42', '50'],
    );
    for (const r of CZ_DPHDP3_ROW_MAP) {
      expect(r.statuses.length).toBeGreaterThan(0);
      if (r.confirmed) expect(r.attrs?.length ?? 0).toBeGreaterThan(0);
      if (r.deduction_row !== undefined) expect(['43', '44']).toContain(r.deduction_row);
    }
    expect(CZ_DPHDP3_ROW_MAP.filter((r) => !r.confirmed).map((r) => r.row)).toEqual(['40', '41', '42', '50']);
    expect(CZ_DPHDP3_ROW_MAP.filter((r) => r.statuses.includes('identifikovana_osoba')).map((r) => r.row)).toEqual(['5', '6', '12', '13']);
  });

  it('parseDphdp3RowMap rejects an unknown treatment or a missing status list', () => {
    expect(() => parseDphdp3RowMap([{ row: '1', treatment: 'nope', rate: 'standard', statuses: ['platce'], side: 'output', confirmed: true }])).toThrow();
    expect(() => parseDphdp3RowMap([{ row: '1', treatment: 'iss_domestic_vat', rate: 'standard', statuses: [], side: 'output', confirmed: true }])).toThrow();
  });

  it('the resolver is status-typed: every VatStatus value is handled', () => {
    const statuses: VatStatus[] = ['neplatce', 'identifikovana_osoba', 'platce'];
    for (const s of statuses) {
      expect(Array.isArray(resolveDphdp3Rows('iss_domestic_vat', 'standard', s, true, CZ_DPHDP3_ROW_MAP))).toBe(true);
    }
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- epo-rows 2>&1 | tail -30`. Expected: fails (module missing).

3. Create `packages/domain/test/kh-routing.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import type { VatTreatment } from '../src/enums/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { CZ_KH_ROUTING, type KhRoutingInput, KhRoutingSchema, parseKhRouting, resolveKhSection } from '../src/rules/cz/epo';

const czk = (s: string) => Money.parse(s, 'CZK');
const LIMIT = createCzRules().at('2026-10-26').get('vat.kh_document_limit');

function input(over: Partial<KhRoutingInput> = {}): KhRoutingInput {
  return { vatStatus: 'platce', treatment: 'rcv_domestic_vat', docTotalCzk: czk('12960.84'), counterpartyCzDic: true, taxDocStatus: 'full_tax_document', limitCzk: LIMIT, ...over };
}
const kh = (over: Partial<KhRoutingInput> = {}) => resolveKhSection(input(over), CZ_KH_ROUTING);

describe('resolveKhSection (M05 §4.2 step 8, CTF §1.3.1)', () => {
  it('received domestic: B2 above 10 000 Kč incl. VAT with CZ DIČ and a full tax document, else B3', () => {
    expect(kh()).toBe('B2');
    expect(kh({ docTotalCzk: czk('10000.00') })).toBe('B3');
    expect(kh({ docTotalCzk: czk('10000.01') })).toBe('B2');
    expect(kh({ docTotalCzk: czk('10000.01'), counterpartyCzDic: false })).toBe('B3');
    expect(kh({ docTotalCzk: czk('10000.01'), taxDocStatus: 'simplified_tax_document' })).toBe('B3');
    expect(kh({ docTotalCzk: czk('-10000.01') })).toBe('B2');
    expect(kh({ docTotalCzk: czk('-10000.00') })).toBe('B3');
  });

  it('issued domestic: A4 above the limit with a CZ DIČ customer, else A5 (B2C → A5)', () => {
    expect(kh({ treatment: 'iss_domestic_vat' })).toBe('A4');
    expect(kh({ treatment: 'iss_domestic_vat', docTotalCzk: czk('10000.00') })).toBe('A5');
    expect(kh({ treatment: 'iss_domestic_vat', counterpartyCzDic: false })).toBe('A5');
    expect(kh({ treatment: 'iss_domestic_vat', docTotalCzk: czk('10000.01'), taxDocStatus: 'simplified_tax_document' })).toBe('A4');
  });

  it('self-assessed → A2, reverse charge → B1 / A1, the rest null', () => {
    for (const t of ['rcv_eu_service_reverse_charge', 'rcv_non_eu_service_reverse_charge', 'rcv_eu_goods_acquisition'] as const) {
      expect(kh({ treatment: t, docTotalCzk: czk('1.00') })).toBe('A2');
    }
    expect(kh({ treatment: 'rcv_domestic_reverse_charge' })).toBe('B1');
    expect(kh({ treatment: 'iss_domestic_reverse_charge' })).toBe('A1');
    const none: VatTreatment[] = ['rcv_import_customs', 'iss_eu_service', 'iss_eu_goods', 'iss_non_eu_service', 'iss_export_goods', 'iss_exempt', 'rcv_domestic_no_vat', 'rcv_foreign_vat_charged', 'rcv_out_of_scope', 'iss_no_vat'];
    for (const t of none) expect(kh({ treatment: t }), t).toBeNull();
  });

  it('only payers file a control statement', () => {
    expect(kh({ vatStatus: 'identifikovana_osoba' })).toBeNull();
    expect(kh({ vatStatus: 'neplatce' })).toBeNull();
  });

  it('the limit is an input, not a constant', () => {
    expect(kh({ docTotalCzk: czk('15000.00'), limitCzk: 20_000 })).toBe('B3');
  });

  it('seed integrity and parsing', () => {
    expect(KhRoutingSchema.safeParse(CZ_KH_ROUTING).success).toBe(true);
    expect(parseKhRouting(CZ_KH_ROUTING)).toEqual(CZ_KH_ROUTING);
    expect(() => parseKhRouting({ version: 1, rules: [{ treatments: ['iss_domestic_vat'], section: 'C9' }] })).toThrow();
    expect(resolveKhSection(input(), parseKhRouting({ version: 1, rules: [] }))).toBeNull();
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- kh-routing 2>&1 | tail -30`. Expected: fails (module missing).

4. Create `packages/domain/src/rules/cz/epo.ts`. Exported names and signatures exactly:

```ts
import { z } from 'zod';
import { type TaxDocStatus, VAT_TREATMENT_VALUES, type VatRateType, type VatStatus, type VatTreatment } from '../../enums/index';
import { Money } from '../../money/index';

export const Dphdp3RowSchema = z.strictObject({
  row: z.string().regex(/^\d{1,2}$/),
  treatment: z.enum(VAT_TREATMENT_VALUES),
  rate: z.enum(['standard', 'reduced', 'any']),
  statuses: z.array(z.enum(['platce', 'identifikovana_osoba'])).min(1),
  side: z.enum(['input', 'output']),
  /** The deduction row a payer adds (43/44); absent for self-contained rows. */
  deduction_row: z.string().regex(/^\d{1,2}$/).optional(),
  /** 40/41/42: the row itself is a deduction and exists only when the deduction is allowed. */
  requires_deduction: z.boolean().optional(),
  /** EPO XML attribute names [base, tax]; optional until verified against the XSD (Phase 3). */
  attrs: z.array(z.string().min(1)).min(1).optional(),
  /** true only for rows whose attrs come from an official sample ([O]). */
  confirmed: z.boolean(),
});
export const Dphdp3RowMapSchema = z.array(Dphdp3RowSchema);
export type Dphdp3RowMapEntry = z.output<typeof Dphdp3RowSchema>;
export type Dphdp3RowMap = readonly Dphdp3RowMapEntry[];
export const CZ_DPHDP3_ROW_MAP: Dphdp3RowMap;              // 19 rows: 1,2,3,4,5,6,10,11,12,13,20,21,22,25,26,40,41,42,50
export function parseDphdp3RowMap(value: unknown): Dphdp3RowMap;   // Dphdp3RowMapSchema.parse
export function resolveDphdp3Rows(treatment: VatTreatment, rate: VatRateType, status: VatStatus, deductionAllowed: boolean, map: Dphdp3RowMap): string[];

export type KhSection = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B1' | 'B2' | 'B3';
export const KhRoutingSchema = z.strictObject({
  version: z.number().int().min(1),
  rules: z.array(z.strictObject({
    treatments: z.array(z.enum(VAT_TREATMENT_VALUES)).min(1),
    section: z.enum(['A1','A2','A3','A4','A5','B1','B2','B3']).optional(),
    over_limit: z.enum([...same...]).optional(),
    under_limit: z.enum([...same...]).optional(),
    over_limit_requires: z.array(z.enum(['counterparty_cz_dic', 'full_tax_document'])).optional(),
  })),
});
export type KhRouting = z.output<typeof KhRoutingSchema>;
export const CZ_KH_ROUTING: KhRouting;
export function parseKhRouting(value: unknown): KhRouting;
export interface KhRoutingInput { readonly vatStatus: VatStatus; readonly treatment: VatTreatment; readonly docTotalCzk: Money /* signed; the absolute value is tested */; readonly counterpartyCzDic: boolean; readonly taxDocStatus: TaxDocStatus; readonly limitCzk: number /* vat.kh_document_limit */; }
export function resolveKhSection(input: KhRoutingInput, routing: KhRouting): KhSection | null;
```

Seed `CZ_DPHDP3_ROW_MAP` (every row `side: 'output'` except 40/41/42 `input`):

```
row 1  iss_domestic_vat standard P attrs [obrat23,dan23] confirmed
row 2  iss_domestic_vat reduced  P attrs [obrat5,dan5] confirmed
row 3  rcv_eu_goods_acquisition standard P deduction_row 43 attrs [p_zb23,dan_pzb23] confirmed
row 4  rcv_eu_goods_acquisition reduced  P deduction_row 44 attrs [p_zb5,dan_pzb5] confirmed
row 5  rcv_eu_service_reverse_charge standard P,I deduction_row 43 attrs [p_sl23_e,dan_psl23_e] confirmed
row 6  rcv_eu_service_reverse_charge reduced  P,I deduction_row 44 attrs [p_sl5_e,dan_psl5_e] confirmed
row 10 rcv_domestic_reverse_charge standard P deduction_row 43 attrs [rez_pren23,dan_rpren23] confirmed
row 11 rcv_domestic_reverse_charge reduced  P deduction_row 44 attrs [rez_pren5,dan_rpren5] confirmed
row 12 rcv_non_eu_service_reverse_charge standard P,I deduction_row 43 attrs [p_sl23_z,dan_psl23_z] confirmed
row 13 rcv_non_eu_service_reverse_charge reduced  P,I deduction_row 44 attrs [p_sl5_z,dan_psl5_z] confirmed
row 20 iss_eu_goods any P attrs [dod_zb] confirmed
row 21 iss_eu_service any P attrs [pln_sluzby] confirmed
row 22 iss_export_goods any P attrs [pln_vyvoz] confirmed
row 25 iss_domestic_reverse_charge any P attrs [pln_rez_pren] confirmed
row 26 iss_non_eu_service any P attrs [pln_ost] confirmed
row 40 rcv_domestic_vat standard P input requires_deduction attrs [pln23,odp_tuz23_nar] confirmed:false  // [verify against XSD]
row 41 rcv_domestic_vat reduced  P input requires_deduction attrs [pln5,odp_tuz5_nar] confirmed:false
row 42 rcv_import_customs any P input requires_deduction attrs [dov_cu,odp_cu_nar] confirmed:false
row 50 iss_exempt any P attrs [plnosv_nkf] confirmed:false
```

`resolveDphdp3Rows`: `status === 'neplatce'` → `[]`. Select entries with `treatment` equal, `rate === 'any' || rate === input rate`, `statuses` includes `status`, and not (`requires_deduction && !deductionAllowed`). Rows = each entry's `row`, plus `deduction_row` when `status === 'platce' && deductionAllowed`. De-duplicate, sort numerically ascending (`Number.parseInt(a, 10) - Number.parseInt(b, 10)`).

Seed `CZ_KH_ROUTING`:

```ts
{ version: 1, rules: [
  { treatments: ['rcv_domestic_reverse_charge'], section: 'B1' },
  { treatments: ['rcv_eu_service_reverse_charge', 'rcv_non_eu_service_reverse_charge', 'rcv_eu_goods_acquisition'], section: 'A2' },
  { treatments: ['rcv_domestic_vat'], over_limit: 'B2', under_limit: 'B3', over_limit_requires: ['counterparty_cz_dic', 'full_tax_document'] },
  { treatments: ['iss_domestic_reverse_charge'], section: 'A1' },
  { treatments: ['iss_domestic_vat'], over_limit: 'A4', under_limit: 'A5', over_limit_requires: ['counterparty_cz_dic'] },
] }
```

`resolveKhSection`: `vatStatus !== 'platce'` → null. Find the first rule whose `treatments` includes the treatment; none → null. `section` set → return it. Else `over = docTotalCzk.abs().compare(Money.parse(String(limitCzk), 'CZK')) > 0` and every `over_limit_requires` holds (`counterparty_cz_dic` → `input.counterpartyCzDic`; `full_tax_document` → `input.taxDocStatus === 'full_tax_document'`) → `over_limit`, else `under_limit` (null if undefined).

Implement until both tests pass; `pnpm exec biome check --write packages/domain/src/rules/cz/epo.ts 2>&1 | tail -5`.

Command: `pnpm --filter @shoebox/domain test -- epo-rows kh-routing 2>&1 | tail -30`. Expected: green. Then `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.

## 5. Do not touch

`2025.ts`, `2026.ts`, `cz/index.ts`, `rules/index.ts`, `src/index.ts` (brief 0310), `product.ts`, `keys.ts`, other packages. Hard rule 1.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- rules-law epo-rows kh-routing 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] Both new test files green, unchanged; `rules-law.test.ts` still green.
- [ ] No row number or `10000` appears in `epo.ts` outside `CZ_DPHDP3_ROW_MAP`.
- [ ] Commits `0309 step 1..4`; no push.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0309-report.md`, `Status: review`, commit `0309 report`. List the `confirmed:false` rows as `[verify against XSD]` items for Phase 3.

## Spec notes for the reviewer

1. IO rows 3/4 (EU goods above `vat.io_eu_goods_threshold` in the calendar year) need a year-to-date input the resolver does not have; the seed lists `rcv_eu_goods_acquisition` for payers only, so an identified person's EU goods produce no row (safer than a wrong one). TODO(P3-VAT) adds the threshold gate.
2. 06 §2.1 shows `attrs` as an array; M05 §4.6 shows an object `{ base, tax }`. The array form (06, existing `law.ts`) is kept. Derived rows 43/44/46/62–65 are Phase 3 (`computeDphdp3`) and not in the map; the resolver only needs `deduction_row`.
3. Row 50 attribute `plnosv_nkf` is inferred ([I]); `confirmed: false`.
4. KH data has no `A3` rule (special regimes, not in scope); the section stays in the enum for 05 parity.

## Risk list (for the reviewer)

`packages/domain/src/rules/cz/epo.ts` (row map and routing data).

## Owner steps

None.
