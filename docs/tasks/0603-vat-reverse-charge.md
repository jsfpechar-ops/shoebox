# 0603: Domestic reverse charge (ZDPH § 92a) in the simple VAT return: treatment guard, KH A.1/B.1, věta C

Status: todo
Ticket: accountant review 2026-10-26, findings V4–V5 | Depends on: 0602 (merged on this branch) | Branch: claude/project-thread-owbjjp | PR base: phase/0
Executor: Sonnet 5.5 (money: new control-statement sections) | Fits one session: 24 tool calls, 65k tokens

## 1. Objective

1. `deriveVatTreatment` gives a § 92a treatment only between two payers: received → `rcv_domestic_reverse_charge` needs the supplier's CZ DIČ; issued → `iss_domestic_reverse_charge` needs the customer's CZ DIČ (else `iss_domestic_vat`).
2. `computeKh` produces A.1 rows (issued § 92a, per document) and B.1 rows (received § 92a, per document) with the commodity code, and věta C carries `pln_rez_pren` (ř. 25 base), `rez_pren23` (ř. 10 base), `rez_pren5` (ř. 11 base).
3. `serializeKh` writes `VetaA1` and `VetaB1` and the three věta C attributes; the XML validates against DPHKH1 03.01.15.
4. The worker's `khLookup` passes each document's distinct commodity codes; the policy allows both § 92a treatments for a payer; `S_RC_COMMODITY` now fails only when a § 92a document has no code or more than one distinct code, or when a code sits on a line whose treatment is not § 92a.

## 2. Context (accountant review 2026-10-26 §2 V4–V5)

- ZDPH § 92a odst. 1: the recipient, a payer, declares the tax on a supply listed in § 92b–§ 92g (construction and assembly work § 92e, selected goods § 92f) received from another payer. Rows 10/11 (recipient) and 25 (supplier) of DPHDP3; KH A.1 (supplier) and B.1 (recipient), ZDPH § 101c. Since 0602 the return already counts rows 10/11 in ř. 62 and ř. 43/44; the ledger already self-assesses the tax for `rcv_domestic_reverse_charge` (`SELF_ASSESSED_TREATMENTS`) and books zero VAT for `iss_domestic_reverse_charge` (`ZERO_VAT_ISSUED_TREATMENTS`).
- KH XSD (`packages/tax-xml/xsd/DPHKH1/03.01.15/dphkh1_epo2.xsd`), element order VetaD, VetaP, VetaA1, VetaA2, VetaA3, VetaA4, VetaA5, VetaB1, VetaB2, VetaB3, VetaC:
  - `VetaA1` attributes: `c_radku`, `dic_odb`, `c_evid_dd`, `duzp`, `zakl_dane1`, `kod_pred_pl` (required, string, max 3 chars; the GFŘ code list "Kód předmětu plnění", e.g. `4` = stavební a montážní práce). No tax attribute (the supplier declares no tax).
  - `VetaB1` attributes: `c_radku`, `dic_dod`, `c_evid_dd`, `duzp`, `zakl_dane1`, `dan1`, `zakl_dane2`, `dan2`, `zakl_dane3`, `dan3`, `kod_pred_pl` (required). `zakl_dane3`/`dan3` (the former second reduced rate) are never written.
  - `VetaC` attributes: `obrat23`, `obrat5`, `pln23`, `pln5`, `pln_rez_pren`, `rez_pren23`, `rez_pren5` (`celk_zd_a2` is written today; keep it).
  - A document with several commodity codes needs one row per code with the same evidence number (XSD documentation of `kod_pred_pl`). The ledger has one entry per document × treatment × rate, with no line id, so a document with more than one distinct code goes to the accountant (`S_RC_COMMODITY`).
- Existing shapes: `KhDocumentInfo { duzp, partnerCountry }` and `KhDocumentLookup` in `packages/domain/src/vat/kh.ts`; the worker builds it in `apps/worker/src/vat/map.ts` `khLookup(ledger)` from `ledger.documents` (each has `lines` with `rcCommodityCode: string | null`). `dicDigits(vatId)` strips the `CZ` prefix (`./header`). B.2 rows use `dppd = lookup(doc).duzp ?? entry.vatPointDate`; A.1/B.1 use the same date under the attribute name `duzp`. Rows sort by (date, `c_evid_dd`, dic) and get `c_radku` 1-based. `bucketsOf(entries, proportional)` (0602) sums standard/zero/none into bucket 1 and reduced into bucket 2; for B.1 use `proportional = true` (the recipient deducts the proportional share, § 75) and for A.1 `false`.
- KH routing is already in place: `CZ_KH_ROUTING` maps `iss_domestic_reverse_charge` → `A1`, `rcv_domestic_reverse_charge` → `B1` (`packages/domain/src/rules/cz/epo.ts`), and `kh-routing.test.ts` asserts it. `computeKh` today ignores sections A1/B1 (`scoped` lists A2, A4, A5, B2, B3 only).
- Policy (`packages/domain/src/rules/cz/vat-phase3.ts`, version `2026.2` after 0602): the `platce` list lacks both § 92a treatments; `rcCommodity` in `checks-accountant.ts` fails on any line with a code. `PeriodDocument.lines[].rcCommodityCode` and `.vatTreatment` are available to the check.
- `deriveVatTreatment` (`packages/domain/src/vat/treatment.ts`): received branch `if (line.rcCommodityCode !== null || (flags.reverseCharge92a && supplier.czDic !== null)) return { treatment: 'rcv_domestic_reverse_charge' };` and issued branch `treatment: line.rcCommodityCode !== null ? 'iss_domestic_reverse_charge' : 'iss_domestic_vat'` inside `if (isB2c)`. `isB2c` is true for a null customer, a customer with a CZ DIČ, a CZ customer, or an EU customer without a valid VAT ID.
- Tests: `packages/domain/test/vat-treatment.test.ts` (fixtures `CZ_PAYER` with `czDic: 'CZ12345678'`, `CZ_NONPAYER`, `IE`, `US`, `DE_B2C`; `tin(over)` builds a received input, the issued block builds with `line: { ...noVat, categoryCode: 'income_services' }`), `packages/domain/test/classify-period.test.ts` (`line({ rcCommodityCode: '4' })`, `io(...)`, `payer(...)`, `check(result, code).outcome`), `packages/tax-xml/test/kh-shv.test.ts` (`PROFILE`, `header('DPHKH1')`, `validateXml(xml, 'DPHKH1', '03.01.15')`, golden `dphkh1-payer-2026-09.xml` which must stay byte-identical: entries without A1/B1 and zero věta C extras produce the same XML).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/treatment.ts` | edit | payer-to-payer guard |
| `packages/domain/test/vat-treatment.test.ts` | edit | 3 cases |
| `packages/domain/src/vat/kh.ts` | edit | A1/B1 rows, codes, věta C |
| `packages/domain/test/kh-reverse-charge.test.ts` | create | below |
| `packages/tax-xml/src/kh.ts` | edit | VetaA1, VetaB1, věta C attrs |
| `packages/tax-xml/test/kh-reverse-charge.test.ts` | create | below |
| `apps/worker/src/vat/map.ts` | edit | codes in `khLookup` |
| `packages/domain/src/rules/cz/vat-phase3.ts` | edit | allow both treatments |
| `packages/domain/src/vat/checks-accountant.ts` | edit | `rcCommodity` semantics |
| `packages/domain/test/classify-period.test.ts` | edit | expectations |

## 4. Steps

### Step 1: `packages/domain/src/vat/treatment.ts`

Anchor: `  if (line.rcCommodityCode !== null || (flags.reverseCharge92a && supplier.czDic !== null)) {`
→ `  if ((line.rcCommodityCode !== null || flags.reverseCharge92a) && supplier.czDic !== null) {`
(a § 92a supply exists only between two payers, ZDPH § 92a odst. 1; a code without a CZ supplier DIČ falls through to the ordinary rules).

Anchor:

```ts
    return {
      treatment: line.rcCommodityCode !== null ? 'iss_domestic_reverse_charge' : 'iss_domestic_vat',
    };
```

Replace with:

```ts
    // ZDPH § 92a: the customer must be a payer (CZ DIČ); B2C or no DIČ → ordinary output VAT.
    const reverseCharge = line.rcCommodityCode !== null && customer?.czDic !== null && customer?.czDic !== undefined;
    return { treatment: reverseCharge ? 'iss_domestic_reverse_charge' : 'iss_domestic_vat' };
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.

### Step 2: `packages/domain/test/vat-treatment.test.ts`

2a. Received cases. Anchor:

```ts
    [
      '§92a commodity code with CZ DIČ',
      { line: { ...noVat, rcCommodityCode: '12' } },
      'rcv_domestic_reverse_charge',
    ],
```

Add right after it:

```ts
    [
      '§92a commodity code but the supplier has no CZ DIČ → ordinary domestic, no VAT',
      { supplier: CZ_NONPAYER, line: { ...noVat, rcCommodityCode: '12' } },
      'rcv_domestic_no_vat',
    ],
```

(If `CZ_NONPAYER` has `czDic: null` and `country: 'CZ'`, the expected treatment is `rcv_domestic_no_vat`; read its definition near the top of the file; if its `czDic` is not null, use a literal party `{ country: 'CZ', czDic: null, vatId: null, vatIdValid: null, isVatPayer: false }` instead.)

2b. Issued cases. Anchor: `    ['payer, B2C (no customer)', { vatStatus: 'platce' }, 'iss_domestic_vat'],`
Add right after it:

```ts
    [
      'payer, B2C with a §92a code → ordinary output VAT (no payer customer)',
      {
        vatStatus: 'platce',
        line: { ...noVat, categoryCode: 'income_services', rcCommodityCode: '4' },
      },
      'iss_domestic_vat',
    ],
```

Command: `pnpm --filter @shoebox/domain test -- vat-treatment 2>&1 | tail -30` → green.

### Step 3: `packages/domain/test/kh-reverse-charge.test.ts` (create, verbatim)

```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3 } from '../src/vat/dphdp3';
import { computeKh, type KhDocumentInfo } from '../src/vat/kh';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const e = (
  documentId: string,
  rows: string[],
  base: string,
  vat: string,
  o: Partial<VatLedgerEntryDraft> = {},
): VatLedgerEntryDraft => ({
  periodStart: d('2026-09-01'),
  periodEnd: d('2026-09-30'),
  vatPointDate: d('2026-09-03'),
  vatPointRule: 'issue_date',
  lineId: null,
  documentId,
  vatTreatment: 'rcv_domestic_reverse_charge',
  vatRateType: 'standard',
  vatRatePct: 21,
  baseCzk: czk(base),
  vatCzk: czk(vat),
  deductionPct: '100',
  currency: 'CZK',
  baseForeign: null,
  fxRate: null,
  fxAmount: null,
  fxRateDate: null,
  dphdp3Rows: rows,
  khSection: null,
  khDocumentTotalCzk: null,
  shvCode: null,
  counterpartyVatId: 'CZ27082440',
  evidenceNumber: documentId,
  ...o,
});
const DOCS: Record<string, KhDocumentInfo> = {
  'sub-1': { duzp: d('2026-09-10'), partnerCountry: 'CZ', rcCommodityCodes: ['4'] },
  'sub-2': { duzp: d('2026-09-05'), partnerCountry: 'CZ', rcCommodityCodes: ['4'] },
  'out-1': { duzp: d('2026-09-20'), partnerCountry: 'CZ', rcCommodityCodes: ['4'] },
};
const lookup = (id: string) => DOCS[id];

// Accountant review 2026-10-26 V4: § 92a (stavební práce, code 4) in KH A.1 / B.1 and věta C.
const ENTRIES: VatLedgerEntryDraft[] = [
  // Subcontractor invoices received (rows 10 + 43), one at 80 % business share.
  e('sub-1', ['10', '43'], '100000.00', '21000.00', {
    khSection: 'B1',
    khDocumentTotalCzk: czk('100000.00'),
    evidenceNumber: 'S-1',
  }),
  e('sub-2', ['10', '43'], '10000.00', '2100.00', {
    khSection: 'B1',
    khDocumentTotalCzk: czk('10000.00'),
    evidenceNumber: 'S-2',
    deductionPct: '80',
  }),
  // Own invoice issued to a payer under § 92a (row 25, no tax).
  e('out-1', ['25'], '250000.00', '0.00', {
    vatTreatment: 'iss_domestic_reverse_charge',
    vatRateType: 'none',
    vatRatePct: 0,
    khSection: 'A1',
    khDocumentTotalCzk: czk('250000.00'),
    counterpartyVatId: 'CZ12345678',
    evidenceNumber: 'F-9',
  }),
];

describe('computeKh § 92a sections', () => {
  const dp3 = computeDphdp3(ENTRIES, 'platce', rules, d('2026-09-01'));
  const kh = computeKh(ENTRIES, dp3, lookup);
  it('B.1: one row per document sorted by duzp, dic without CZ, kod_pred_pl 4, proportional amounts', () => {
    expect(kh.b1.map((r) => [r.cRadku, r.cEvidDd, r.dicDod, String(r.duzp), r.kodPredPl])).toEqual([
      [1, 'S-2', '27082440', '2026-09-05', '4'],
      [2, 'S-1', '27082440', '2026-09-10', '4'],
    ]);
    expect(kh.b1[0]?.zaklDane1.toFixed2()).toBe('8000.00');
    expect(kh.b1[0]?.dan1.toFixed2()).toBe('1680.00');
    expect(kh.b1[1]?.zaklDane1.toFixed2()).toBe('100000.00');
    expect(kh.b1[1]?.dan1.toFixed2()).toBe('21000.00');
  });
  it('A.1: the issued document with its base only', () => {
    expect(kh.a1.map((r) => [r.cRadku, r.cEvidDd, r.dicOdb, String(r.duzp), r.kodPredPl])).toEqual([
      [1, 'F-9', '12345678', '2026-09-20', '4'],
    ]);
    expect(kh.a1[0]?.zaklDane1.toFixed2()).toBe('250000.00');
  });
  it('věta C: rez_pren23 = ř. 10 base 110 000, pln_rez_pren = ř. 25 base 250 000, rez_pren5 = 0', () => {
    expect(kh.c.rezPren23.toFixed2()).toBe('110000.00');
    expect(kh.c.rezPren5.toFixed2()).toBe('0.00');
    expect(kh.c.plnRezPren.toFixed2()).toBe('250000.00');
  });
  it('the return: ř. 62 = 23 100, ř. 43 = 108 000 / 22 680, ř. 25 = 250 000', () => {
    expect(dp3.row62.toFixed2()).toBe('23100.00');
    expect(dp3.rows['43']?.base.toFixed2()).toBe('108000.00');
    expect(dp3.rows['43']?.tax.toFixed2()).toBe('22680.00');
    expect(dp3.rows['25']?.base.toFixed2()).toBe('250000.00');
  });
  it('a § 92a document without a code throws (the classifier must have refused it)', () => {
    const noCode = (id: string): KhDocumentInfo | undefined =>
      id === 'sub-1' ? { duzp: d('2026-09-10'), partnerCountry: 'CZ', rcCommodityCodes: [] } : DOCS[id];
    expect(() => computeKh(ENTRIES, dp3, noCode)).toThrow(/kod_pred_pl/);
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- kh-reverse-charge 2>&1 | tail -30` → red before step 4.

### Step 4: `packages/domain/src/vat/kh.ts` (edit; implement until step 3 and `kh`, `kh-deduction` are green)

- `KhDocumentInfo` gains `readonly rcCommodityCodes: readonly string[];` (distinct non-null codes of the document's lines; `[]` when none).
- New row types:

```ts
export interface KhA1Row {
  readonly cRadku: number;
  readonly dicOdb: string;
  readonly cEvidDd: string;
  readonly duzp: LegalDate;
  readonly zaklDane1: Money;
  readonly kodPredPl: string;
  readonly documentId: string;
}
export interface KhB1Row extends KhAmounts {
  readonly cRadku: number;
  readonly dicDod: string;
  readonly cEvidDd: string;
  readonly duzp: LegalDate;
  readonly kodPredPl: string;
  readonly documentId: string;
}
```

- `KhVetaC` gains `plnRezPren`, `rezPren23`, `rezPren5` (`Money`); `KhComputation` gains `a1: readonly KhA1Row[]` and `b1: readonly KhB1Row[]`.
- `computeKh`: `scoped` includes `'A1'` and `'B1'`. A.1 rows: group section A1 by document; `dicOdb = dicDigits(first.counterpartyVatId) ?? ''`; `cEvidDd`; `duzp = lookup(doc)?.duzp ?? first.vatPointDate`; `zaklDane1 = Σ baseCzk` of all the document's A1 entries (every rate); `kodPredPl` = the single code of `lookup(doc)?.rcCommodityCodes`; when the lookup gives 0 or > 1 codes throw `new Error(\`kh: document ${documentId} needs exactly one kod_pred_pl\`)`. B.1 rows: same keys with `dicDod`, amounts `bucketsOf(docEntries, true)`. Sort both by (`duzp`, `cEvidDd`, dic) and number `cRadku` from 1. Věta C: `plnRezPren = row('25')`, `rezPren23 = row('10')`, `rezPren5 = row('11')`.
- `entryCount` counts the scoped entries (now including A1/B1).

Commands: `pnpm --filter @shoebox/domain test -- kh-reverse-charge 2>&1 | tail -30`, `pnpm --filter @shoebox/domain test -- kh 2>&1 | tail -30`, `pnpm --filter @shoebox/domain test -- kh-deduction 2>&1 | tail -30`, `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → green. If `kh.test.ts` or another test builds a `KhDocumentInfo` literal without `rcCommodityCodes`, add `rcCommodityCodes: []` to those literals (that is the only change allowed in existing tests; list them in the report).

### Step 5: `packages/tax-xml/test/kh-reverse-charge.test.ts` (create, verbatim)

```ts
import {
  buildEpoHeader,
  computeDphdp3,
  computeKh,
  createCzRules,
  type EpoTaxpayerProfile,
  type KhDocumentInfo,
  Money,
  parseLegalDate,
  type VatLedgerEntryDraft,
} from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { serializeKh, validateXml } from '../src/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const START = d('2026-09-01');
const PROFILE: EpoTaxpayerProfile = {
  vatStatus: 'platce',
  dic: 'CZ7801011229',
  firstName: 'Jan',
  lastName: 'Novák',
  title: null,
  address: {
    street: 'Vinohradská',
    house_number: '1',
    orientation_number: null,
    city: 'Praha',
    zip: '130 00',
  },
  fuCode: '451',
  ufoCode: '2003',
  mainActivityNace: '5520',
  filingEmail: 'jan@example.com',
  filingPhone: null,
};
function header() {
  const r = buildEpoHeader(PROFILE, {
    form: 'DPHKH1',
    kind: 'radne',
    period: { start: START, end: d('2026-09-30'), kind: 'month' },
    preparedOn: d('2026-10-20'),
    appVersion: '0.0.0',
  });
  if (!r.ok) throw new Error('header');
  return r.header;
}
const e = (
  documentId: string,
  rows: string[],
  base: string,
  vat: string,
  o: Partial<VatLedgerEntryDraft> = {},
): VatLedgerEntryDraft => ({
  periodStart: START,
  periodEnd: d('2026-09-30'),
  vatPointDate: d('2026-09-03'),
  vatPointRule: 'issue_date',
  lineId: null,
  documentId,
  vatTreatment: 'rcv_domestic_reverse_charge',
  vatRateType: 'standard',
  vatRatePct: 21,
  baseCzk: czk(base),
  vatCzk: czk(vat),
  deductionPct: '100',
  currency: 'CZK',
  baseForeign: null,
  fxRate: null,
  fxAmount: null,
  fxRateDate: null,
  dphdp3Rows: rows,
  khSection: null,
  khDocumentTotalCzk: null,
  shvCode: null,
  counterpartyVatId: 'CZ27082440',
  evidenceNumber: documentId,
  ...o,
});
const DOCS: Record<string, KhDocumentInfo> = {
  'sub-1': { duzp: d('2026-09-10'), partnerCountry: 'CZ', rcCommodityCodes: ['4'] },
  'out-1': { duzp: d('2026-09-20'), partnerCountry: 'CZ', rcCommodityCodes: ['4'] },
};
const ENTRIES: VatLedgerEntryDraft[] = [
  e('sub-1', ['10', '43'], '100000.00', '21000.00', {
    khSection: 'B1',
    khDocumentTotalCzk: czk('100000.00'),
    evidenceNumber: 'S-1',
  }),
  e('out-1', ['25'], '250000.00', '0.00', {
    vatTreatment: 'iss_domestic_reverse_charge',
    vatRateType: 'none',
    vatRatePct: 0,
    khSection: 'A1',
    khDocumentTotalCzk: czk('250000.00'),
    counterpartyVatId: 'CZ12345678',
    evidenceNumber: 'F-9',
  }),
];

describe('serializeKh § 92a', () => {
  it('writes VetaA1, VetaB1 and the věta C reverse-charge attributes; validates against DPHKH1 03.01.15', async () => {
    const kh = computeKh(ENTRIES, computeDphdp3(ENTRIES, 'platce', rules, START), (id) => DOCS[id]);
    const xml = serializeKh(kh, header(), { verzePis: '03.01' });
    expect(xml).toContain(
      '<VetaA1 c_radku="1" dic_odb="12345678" c_evid_dd="F-9" duzp="20.09.2026" zakl_dane1="250000.00" kod_pred_pl="4"',
    );
    expect(xml).toContain(
      '<VetaB1 c_radku="1" dic_dod="27082440" c_evid_dd="S-1" duzp="10.09.2026" zakl_dane1="100000.00" dan1="21000.00" kod_pred_pl="4"',
    );
    expect(xml).toMatch(/<VetaC [^>]*pln_rez_pren="250000.00"/);
    expect(xml).toMatch(/<VetaC [^>]*rez_pren23="100000.00"/);
    expect(xml).not.toContain('rez_pren5=');
    expect(xml.indexOf('<VetaA1')).toBeLessThan(xml.indexOf('<VetaB1'));
    expect(xml.indexOf('<VetaB1')).toBeLessThan(xml.indexOf('<VetaC'));
    const v = await validateXml(xml, 'DPHKH1', '03.01.15');
    expect(v.valid, JSON.stringify(v.errors)).toBe(true);
  });
});
```

If `dateAttr` formats dates differently from `DD.MM.YYYY`, keep the test's intent: read `dateAttr` in `packages/tax-xml/src/xml.ts` and STOP with a question if the format is not `DD.MM.YYYY` (do not edit this test; the orchestrator fixes the brief).

Command: `pnpm --filter @shoebox/tax-xml test -- kh-reverse-charge 2>&1 | tail -30` → red before step 6.

### Step 6: `packages/tax-xml/src/kh.ts` (edit)

- Import `KhA1Row`, `KhB1Row` from `@shoebox/domain`.
- `vetaA1(r)`: `VetaA1` with attrs `c_radku`, `dic_odb`, `c_evid_dd`, `duzp` (`dateAttr`), `zakl_dane1` (`dec2Attr`), `kod_pred_pl` (plain string).
- `vetaB1(r)`: `VetaB1` with attrs `c_radku`, `dic_dod`, `c_evid_dd`, `duzp`, `...amountAttrs(r)`, `kod_pred_pl`.
- `vetaC`: add `['pln_rez_pren', dec2Attr(c.plnRezPren)]`, `['rez_pren23', dec2Attr(c.rezPren23)]`, `['rez_pren5', dec2Attr(c.rezPren5)]` after `pln5` (zero → omitted by `dec2Attr`, keep `celk_zd_a2` last).
- `serializeKh`: push `...c.a1.map(vetaA1)` before the A2 rows and `...c.b1.map(vetaB1)` before the B2 rows.

Commands: `pnpm --filter @shoebox/tax-xml test -- kh-reverse-charge 2>&1 | tail -30`, `pnpm --filter @shoebox/tax-xml test -- kh-shv 2>&1 | tail -30` (golden byte-identical), `pnpm --filter @shoebox/tax-xml typecheck 2>&1 | tail -30` → green.

### Step 7: `apps/worker/src/vat/map.ts`

Anchor:

```ts
    return {
      duzp: optionalDate(doc.duzp ?? doc.vatPointDate, 'documents.duzp'),
      partnerCountry: doc.partner?.country ?? null,
    };
```

Replace with:

```ts
    return {
      duzp: optionalDate(doc.duzp ?? doc.vatPointDate, 'documents.duzp'),
      partnerCountry: doc.partner?.country ?? null,
      rcCommodityCodes: [
        ...new Set(doc.lines.map((l) => l.rcCommodityCode).filter((c): c is string => c !== null)),
      ],
    };
```

If `doc.lines` does not exist on that document type, STOP and ask (report the type name).

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → green (fix any other `KhDocumentInfo` literal the typecheck reports by adding `rcCommodityCodes: []`, and list it in the report).

### Step 8: `packages/domain/src/rules/cz/vat-phase3.ts`

Anchor (platce list end, unique):

```ts
      'rcv_eu_goods_acquisition',
      'rcv_foreign_vat_charged',
      'rcv_out_of_scope',
    ],
```

Replace with:

```ts
      'rcv_eu_goods_acquisition',
      'rcv_foreign_vat_charged',
      'rcv_out_of_scope',
      'rcv_domestic_reverse_charge',
      'iss_domestic_reverse_charge',
    ],
```

Anchor: `  version: '2026.2',` → `  version: '2026.3',`.

### Step 9: `packages/domain/src/vat/checks-accountant.ts`

Anchor:

```ts
const rcCommodity: SimpleCheckFn = (ctx) => {
  const docs = ctx.input.documents.filter((d) => d.lines.some((l) => l.rcCommodityCode !== null));
  return docs.length > 0 ? fail(docIds(docs)) : null;
};
```

Replace with:

```ts
// § 92a is in scope since 0603 (policy 2026.3): a reverse-charge document needs exactly one commodity
// code (one KH row per code), and a code never sits on a line with another treatment.
const RC_TREATMENTS: ReadonlySet<string> = new Set([
  'rcv_domestic_reverse_charge',
  'iss_domestic_reverse_charge',
]);
const rcCommodity: SimpleCheckFn = (ctx) => {
  const docs = ctx.input.documents.filter((d) => {
    const rcLines = d.lines.filter((l) => l.vatTreatment !== null && RC_TREATMENTS.has(l.vatTreatment));
    const codes = new Set(d.lines.map((l) => l.rcCommodityCode).filter((c) => c !== null));
    const codeOnOtherLine = d.lines.some(
      (l) => l.rcCommodityCode !== null && !(l.vatTreatment !== null && RC_TREATMENTS.has(l.vatTreatment)),
    );
    if (!ctx.isPayer) return codes.size > 0;
    if (rcLines.length === 0) return codes.size > 0;
    return codes.size !== 1 || codeOnOtherLine;
  });
  return docs.length > 0 ? fail(docIds(docs)) : null;
};
```

### Step 10: `packages/domain/test/classify-period.test.ts`

The first expectation of `it('S_RC_COMMODITY and S_FORBIDDEN_CLASS (class and line type)'` uses an IO document with a code and expects `'needs_accountant'`: unchanged (IO is never in § 92a). Add a new test right before that `it(`:

```ts
  it('S_RC_COMMODITY (policy 2026.3): payer § 92a document with one code passes; without a code or with two codes it needs the accountant', () => {
    const rc = (lines: ReturnType<typeof line>[]) =>
      payer({ documents: [doc({ documentId: 'r', lines })] });
    expect(
      check(
        classifyPeriod(
          rc([line({ vatTreatment: 'rcv_domestic_reverse_charge', rcCommodityCode: '4' })]),
          rules,
        ),
        'S_RC_COMMODITY',
      ).outcome,
    ).toBe('pass');
    expect(
      check(
        classifyPeriod(rc([line({ vatTreatment: 'rcv_domestic_reverse_charge' })]), rules),
        'S_RC_COMMODITY',
      ).outcome,
    ).toBe('needs_accountant');
    expect(
      check(
        classifyPeriod(
          rc([
            line({ vatTreatment: 'rcv_domestic_reverse_charge', rcCommodityCode: '4' }),
            line({ vatTreatment: 'rcv_domestic_reverse_charge', rcCommodityCode: '5' }),
          ]),
          rules,
        ),
        'S_RC_COMMODITY',
      ).outcome,
    ).toBe('needs_accountant');
  });
```

(`line(...)` defaults: read its helper at the top of the file; if `rcCommodityCode` defaults to a non-null value, pass `rcCommodityCode: null` explicitly in the "without a code" case.)

Commands: `pnpm --filter @shoebox/domain test -- classify-period 2>&1 | tail -30`, `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` (update a pinned `'2026.2'` to `'2026.3'` if one exists), `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → green.

## 5. Non-goals

- Pohoda, the VAT workbook, the web screens, the ledger builder, the amendment detector (its `khLookup` import keeps working). Multi-code documents stay with the accountant.

## 6. Commands

All commands of §4; plus `pnpm --filter @shoebox/domain test -- kh-dp3.property 2>&1 | tail -30` and `pnpm --filter @shoebox/domain test -- dphdp3-deduction 2>&1 | tail -30` at the end.

## 7. Acceptance

- [ ] Steps 3 and 5 test files pass unchanged; `kh-shv` golden byte-identical.
- [ ] A B2C invoice with a commodity code is `iss_domestic_vat`; a received code without a supplier CZ DIČ is not reverse charge.
- [ ] Policy `2026.3` allows both § 92a treatments; `S_RC_COMMODITY` passes for a one-code payer document.
- [ ] All typechecks green (domain, tax-xml, worker).

## 8. Report

`docs/tasks/0603-report.md` per `docs/context/executor.md`. Commit as `0603 step k`. Do not push and do not open a PR: the orchestrator merges this branch.
