# 0602: Proportional deduction (ZDPH § 75) in DPHDP3 and KH; ř. 62 / 43 / 44 / 46 from the row map

Status: todo
Ticket: accountant review 2026-10-26, findings V1–V3 | Depends on: — | Branch: claude/project-thread-owbjjp | PR base: phase/0
Executor: Sonnet 5.5 (money: changes the return and control statement amounts) | Fits one session: 22 tool calls, 60k tokens

## 1. Objective

1. `computeDphdp3` applies each entry's `deductionPct` to the deduction side: input rows 40/41/42 and the derived rows 43/44 carry `round2(amount × pct / 100)` per entry; output rows (1–13, 20–26, 50) stay full.
2. ř. 62, ř. 43/44 sources and ř. 46 come from the row map and the XSD formulas, not from constants: ř. 62 = Σ tax of the output rows 1–13 present for the status (payer: 1, 2, 3, 4, 5, 6, 10, 11, 12, 13; IO: 5, 6, 12, 13); ř. 43 = Σ over source rows whose `deduction_row` is `43` (3, 5, 10, 12), ř. 44 likewise (4, 6, 11, 13); ř. 46 = ř. 40 + 41 + 42 + 43 + 44.
3. `computeKh`: B.2 rows and the B.3 aggregate carry the proportional amounts; a B.2 row gets `pomer = 'A'` when any entry of the document has `deductionPct < 100`, else `'N'`.
4. The simple-period policy allows partial business shares (`allow_partial_business_share_on_deduction: true`, version `2026.2`), and `S_PARTIAL_SHARE_DEDUCTION` passes when the policy allows it.

## 2. Context (accountant review 2026-10-26, `reviews/accountant-review-2026-10-26.md` §2 V1–V3)

- ZDPH § 72 odst. 6 and § 75: a payer who uses a purchase partly for private purposes deducts only the proportional part (poměrný koeficient = the business share). `vat_ledger_entries.deduction_pct` (M04 §4.11.2, the smallest `business_share_pct` of the group) is stored by `buildVatLedgerEntries` but never applied: `computeDphdp3` sums full `baseCzk`/`vatCzk` into rows 40/41/42 and derives 43/44 from the full rounded output rows; `computeKh` writes full amounts with `pomer="N"`.
- XSD documentation (DPHDP3 03.01.04, `packages/tax-xml/xsd/DPHDP3/03.01.04/dphdp3_epo2.xsd`): `dan_zocelk` (ř. 62) "= 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12 + 13 − 61 + daň podle § 108"; `odp_sum_nar` (ř. 46) "součet řádků 40 až 45"; `nar_zdp23`/`od_zdp23` (ř. 43) "ze zdanitelných plnění vykázaných v řádcích 3 až 13". Today `PAYER_RETURN_ROWS` omits 10/11 (§ 92a, in the row map) and `tax46` omits ř. 42.
- KH (DPHKH1 03.01.15) VetaB2 `pomer`: "ANO/NE. Specifikace poměrného nároku na odpočet daně, pokud je takto vykazován podle § 75." The amounts of B.2/B.3 are the amounts claimed in the return (věta C `pln23` = ř. 40), so with `pomer=A` the row carries the proportional base and tax. **[verify]** by the licensed accountant (GFŘ pokyny k vyplnění KH, B.2); record in the report that this is the accountant-review reading.
- Rounding (`vat.return_rounding`, M05 §4.4): `sum_entries_then_round`: base = round0(Σ), tax = round0(Σ); `round_base_then_multiply`: tax = round0(base × rate / 100) with the rate of the row (`rowRate`). Per-row rounding first, then summing into 43/44, keeps ř. 43 ≤ ř. 3 + 5 + 10 + 12 (a deduction can never exceed the declared tax).
- Row map: `packages/domain/src/rules/cz/epo.ts` `CZ_DPHDP3_ROW_MAP` entries have `row`, `side: 'input' | 'output'`, `statuses`, `rate`, optional `deduction_row` ('43' or '44'), `requires_deduction`. Rows 40/41/42 are `side: 'input'`. `Dphdp3Computation.rows` holds the source rows with ≥ 1 entry plus derived 43/44/46 (payers, non-zero); `raw` holds the unrounded sums.
- Money: `round2`, `round0` from `../money/index`; `Money.multiply(string)`, `.divide(string)`, `.add`, `.isZero()`, `.compare`.
- Policy: `packages/domain/src/rules/cz/vat-phase3.ts` `CZ_SIMPLE_PERIOD_POLICY` (`version: '2026.1'`, `allow_partial_business_share_on_deduction: false`); check `partialShareDeduction` in `packages/domain/src/vat/checks-accountant.ts`; `SimpleCheckContext.policy` is the parsed policy.
- With every `deductionPct = '100'` the numbers must not change: the existing goldens in `packages/domain/test/dphdp3.test.ts`, `kh.test.ts`, `kh-dp3.property.test.ts` and the tax-xml golden XML stay byte-identical.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/dphdp3.ts` | edit | deduction share; map-driven 62/43/44/46 |
| `packages/domain/src/vat/kh.ts` | edit | proportional B.2/B.3, `pomer` |
| `packages/domain/test/dphdp3-deduction.test.ts` | create | below |
| `packages/domain/test/kh-deduction.test.ts` | create | below |
| `packages/domain/src/rules/cz/vat-phase3.ts` | edit | policy flag + version |
| `packages/domain/src/vat/checks-accountant.ts` | edit | check respects the flag |
| `packages/domain/test/classify-period.test.ts` | edit | expectation flips |

## 4. Steps

### Step 1: `packages/domain/test/dphdp3-deduction.test.ts` (create, verbatim)

```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3, dphdp3Row } from '../src/vat/dphdp3';
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
  vatTreatment: 'rcv_domestic_vat',
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
  counterpartyVatId: null,
  evidenceNumber: documentId,
  ...o,
});
const v = (c: ReturnType<typeof computeDphdp3>, row: string) => [
  dphdp3Row(c, row).base.toFixed2(),
  dphdp3Row(c, row).tax.toFixed2(),
];

// Accountant review 2026-10-26 V1–V3 (ZDPH § 72 odst. 6, § 75; XSD dan_zocelk, odp_sum_nar).
const ENTRIES: VatLedgerEntryDraft[] = [
  // MacBook, 80 % business: row 40 carries the deductible 80 % (17 844,63 / 3 747,37).
  e('mac', ['40'], '22305.79', '4684.21', { deductionPct: '80' }),
  // EU ads, 50 % business: row 5 full (output), row 43 half.
  e('ads', ['5', '43'], '10000.00', '2100.00', {
    vatTreatment: 'rcv_eu_service_reverse_charge',
    deductionPct: '50',
  }),
  // § 92a construction work, 100 %: row 10 counts in ř. 62 and in ř. 43.
  e('rc', ['10', '43'], '50000.00', '10500.00', {
    vatTreatment: 'rcv_domestic_reverse_charge',
  }),
  // Import VAT assessed by customs: row 42 counts in ř. 46.
  e('cust', ['42'], '1000.00', '210.00', { vatTreatment: 'rcv_import_customs' }),
];

describe('computeDphdp3 with a proportional deduction (§ 75)', () => {
  const c = computeDphdp3(ENTRIES, 'platce', rules, d('2026-09-01'));
  it('row 40 = round2(amount × 80 %) summed, then whole Kč: 17 845 / 3 747; raw keeps haléře', () => {
    expect(v(c, '40')).toEqual(['17845.00', '3747.00']);
    expect(c.raw['40']?.base.toFixed2()).toBe('17844.63');
    expect(c.raw['40']?.tax.toFixed2()).toBe('3747.37');
  });
  it('output rows stay full: row 5 = 10 000 / 2 100, row 10 = 50 000 / 10 500, row 42 = 1 000 / 210', () => {
    expect(v(c, '5')).toEqual(['10000.00', '2100.00']);
    expect(v(c, '10')).toEqual(['50000.00', '10500.00']);
    expect(v(c, '42')).toEqual(['1000.00', '210.00']);
  });
  it('ř. 43 = half of row 5 + all of row 10 = 55 000 / 11 550; no ř. 44', () => {
    expect(v(c, '43')).toEqual(['55000.00', '11550.00']);
    expect(c.rows['44']).toBeUndefined();
  });
  it('ř. 62 = tax of rows 5 + 10 = 12 600; ř. 46 = 40 + 42 + 43 = 15 507; ř. 65 = 2 907', () => {
    expect(c.row62.toFixed2()).toBe('12600.00');
    expect(v(c, '46')).toEqual(['0.00', '15507.00']);
    expect(c.row63.toFixed2()).toBe('15507.00');
    expect(c.row64.toFixed2()).toBe('0.00');
    expect(c.row65.toFixed2()).toBe('2907.00');
    expect(c.trans).toBe('A');
  });
  it('round_base_then_multiply: row 40 tax = round0(17 845 × 21 %) = 3 747; ř. 43 unchanged', () => {
    const m = computeDphdp3(ENTRIES, 'platce', rules, d('2026-09-01'), 'round_base_then_multiply');
    expect(v(m, '40')).toEqual(['17845.00', '3747.00']);
    expect(v(m, '43')).toEqual(['55000.00', '11550.00']);
  });
  it('IO: ř. 62 counts rows 5/6/12/13 only, never a deduction', () => {
    const io = computeDphdp3(
      [e('ads', ['5'], '10000.00', '2100.00', { vatTreatment: 'rcv_eu_service_reverse_charge' })],
      'identifikovana_osoba',
      rules,
      d('2026-09-01'),
    );
    expect(io.row62.toFixed2()).toBe('2100.00');
    expect(io.row63.toFixed2()).toBe('0.00');
    expect(io.rows['43']).toBeUndefined();
  });
  it('100 % everywhere: identical to the old derivation (ř. 43 = ř. 3 + 5 + 12 rounded per row)', () => {
    const full = computeDphdp3(
      [
        e('a', ['3', '43'], '1000.49', '210.10', { vatTreatment: 'rcv_eu_goods_acquisition' }),
        e('b', ['5', '43'], '2000.49', '420.10', { vatTreatment: 'rcv_eu_service_reverse_charge' }),
        e('c', ['12', '43'], '3000.49', '630.10', {
          vatTreatment: 'rcv_non_eu_service_reverse_charge',
        }),
      ],
      'platce',
      rules,
      d('2026-09-01'),
    );
    expect(v(full, '43')).toEqual(['6000.00', '1260.00']);
    expect(full.row62.toFixed2()).toBe('1260.00');
    expect(full.row63.toFixed2()).toBe('1260.00');
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- dphdp3-deduction 2>&1 | tail -30` → fails (red) before step 2.

### Step 2: `packages/domain/src/vat/dphdp3.ts` (edit; implement until step 1 and `dphdp3` are green)

Keep every export and signature (`computeDphdp3`, `dphdp3Row`, `IO_RETURN_ROWS`, `PAYER_RETURN_ROWS`, types). Change the body of `computeDphdp3`:

1. Helpers: `const deductible = (m: Money, pct: string): Money => round2(m.multiply(pct).divide('100'));` and `const isInputRow = (row: string) => map.some((m) => m.row === row && m.side === 'input');`.
2. Steps 1–2 (source sums): for an entry row that is an input row, add `deductible(entry.baseCzk, entry.deductionPct)` / `deductible(entry.vatCzk, entry.deductionPct)`; otherwise add the full amounts. Rows 43/44 on entries are still skipped. `raw[row]` keeps these (for input rows: deductible) sums.
3. Step 3 (rounding): unchanged.
4. Step 4 (payers only), derived rows from the map instead of the constants `ROW_43_SOURCES`/`ROW_44_SOURCES`:
   - for each `D` of `['43', '44']`: `sources = unique rows r in map with deduction_row === D`; for each `r`: `dBase_r = Σ deductible(e.baseCzk)` and `dVat_r = Σ deductible(e.vatCzk)` over counted entries whose `dphdp3Rows` contains `r`; `base_r = round0(dBase_r)`; `tax_r = rounding === 'sum_entries_then_round' ? round0(dVat_r) : round0(base_r × rate_r / 100)` with `rate_r = rowRate(r)` (zero tax when null). `D = Σ_r (base_r, tax_r)`; set `rows[D]` when non-zero.
   - `tax46 = Σ tax of the input rows present in rounded (40, 41, 42) + tax43 + tax44`; `rows['46']` when non-zero.
5. `row62 = Σ get(row).tax` over `returnRows(status)` = unique rows of the map with `side === 'output'`, `Number(row) <= 13` and `statuses.includes(status)`. Replace the constants: `PAYER_RETURN_ROWS = ['1','2','3','4','5','6','10','11','12','13']`, `IO_RETURN_ROWS = ['5','6','12','13']` (keep them exported; derive from the map at runtime and keep the constants as documentation, or compute them from `CZ_DPHDP3_ROW_MAP` at module load). Remove `ROW_43_SOURCES`, `ROW_44_SOURCES`.
6. Update the doc comment of `rows` to "Source rows with >= 1 entry + derived rows 43/44/46 (payer, when non-zero); input rows and 43/44 carry the deductible share (§ 75)".

Commands: `pnpm --filter @shoebox/domain test -- dphdp3-deduction 2>&1 | tail -30` and `pnpm --filter @shoebox/domain test -- dphdp3 2>&1 | tail -30` and `pnpm --filter @shoebox/domain test -- kh-dp3.property 2>&1 | tail -30` → all green (the goldens with 100 % must not change).

### Step 3: `packages/domain/test/kh-deduction.test.ts` (create, verbatim)

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
  vatTreatment: 'rcv_domestic_vat',
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
  mac: { duzp: d('2026-09-03'), partnerCountry: 'CZ' },
  full: { duzp: d('2026-09-04'), partnerCountry: 'CZ' },
  pen: { duzp: d('2026-09-05'), partnerCountry: 'CZ' },
};
const lookup = (id: string) => DOCS[id];

// Accountant review 2026-10-26 V1: B.2/B.3 carry the amounts claimed (§ 75), pomer = A. [verify]
const ENTRIES: VatLedgerEntryDraft[] = [
  e('mac', ['40'], '22305.79', '4684.21', {
    deductionPct: '80',
    khSection: 'B2',
    khDocumentTotalCzk: czk('26990.00'),
  }),
  e('full', ['40'], '1000.00', '210.00', { khSection: 'B2', khDocumentTotalCzk: czk('1210.00') }),
  e('pen', ['40'], '100.00', '21.00', {
    deductionPct: '50',
    khSection: 'B3',
    khDocumentTotalCzk: czk('121.00'),
  }),
];

describe('computeKh with a proportional deduction (§ 75)', () => {
  const dp3 = computeDphdp3(ENTRIES, 'platce', rules, d('2026-09-01'));
  const kh = computeKh(ENTRIES, dp3, lookup);
  it('B.2: the 80 % document carries 17 844,63 / 3 747,37 with pomer A; the full one 1 000 / 210 with N', () => {
    const mac = kh.b2.find((r) => r.documentId === 'mac');
    const full = kh.b2.find((r) => r.documentId === 'full');
    expect(mac?.zaklDane1.toFixed2()).toBe('17844.63');
    expect(mac?.dan1.toFixed2()).toBe('3747.37');
    expect(mac?.pomer).toBe('A');
    expect(full?.zaklDane1.toFixed2()).toBe('1000.00');
    expect(full?.dan1.toFixed2()).toBe('210.00');
    expect(full?.pomer).toBe('N');
  });
  it('B.3 aggregate carries the 50 % part: 50,00 / 10,50', () => {
    expect(kh.b3?.zaklDane1.toFixed2()).toBe('50.00');
    expect(kh.b3?.dan1.toFixed2()).toBe('10.50');
  });
  it('věta C pln23 equals ř. 40 of the return: round0(17 844,63 + 1 000 + 50) = 18 895', () => {
    expect(kh.c.pln23.toFixed2()).toBe('18895.00');
    expect(dp3.rows['40']?.base.toFixed2()).toBe('18895.00');
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- kh-deduction 2>&1 | tail -30` → red before step 4.

### Step 4: `packages/domain/src/vat/kh.ts` (edit)

- `KhB2Row.pomer: 'N'` → `readonly pomer: 'A' | 'N';`.
- `bucketsOf(entries)` gets a second parameter `proportional: boolean`; when true every summed amount is `round2(amount × deductionPct / 100)` (import `round2` from `../money/index`). A.2/A.4/A.5 call it with `false`; B.2 rows and the B.3 aggregate with `true` (give `aggregate` the same flag).
- B.2 row: `pomer: docEntries.some((x) => Money.parse(x.deductionPct, CZK).compare(Money.parse('100', CZK)) < 0) ? 'A' : 'N'`.
- Spec line for the report: M05 §4.5 B2 `pomer="N"` becomes `pomer = A when § 75 applies` (the orchestrator edits the spec).

Commands: `pnpm --filter @shoebox/domain test -- kh-deduction 2>&1 | tail -30`, `pnpm --filter @shoebox/domain test -- kh 2>&1 | tail -30` → green. Then `pnpm --filter @shoebox/tax-xml test -- kh-shv 2>&1 | tail -30` → green (golden XML unchanged).

### Step 5: `packages/domain/src/rules/cz/vat-phase3.ts`

Anchor: `  version: '2026.1',` → `  version: '2026.2',`. Anchor: `  allow_partial_business_share_on_deduction: false,` → `  allow_partial_business_share_on_deduction: true,`.

Command: `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` → green (if a test pins `'2026.1'`, update that one expectation to `'2026.2'` and note it in the report).

### Step 6: `packages/domain/src/vat/checks-accountant.ts`

Anchor:

```ts
const partialShareDeduction: SimpleCheckFn = (ctx) => {
  if (!ctx.isPayer) return null;
```

Replace with:

```ts
const partialShareDeduction: SimpleCheckFn = (ctx) => {
  // § 75 proportional deduction is computed by computeDphdp3/computeKh since 0602 (policy 2026.2).
  if (!ctx.isPayer || ctx.policy.allow_partial_business_share_on_deduction) return null;
```

### Step 7: `packages/domain/test/classify-period.test.ts`

Anchor: `  it('S_PARTIAL_SHARE_DEDUCTION: payer 60 % share on a domestic purchase; IO ignores it', () => {` → `  it('S_PARTIAL_SHARE_DEDUCTION: allowed by policy 2026.2 (§ 75 computed); payer and IO pass', () => {`.

Anchor:

```ts
    expect(
      check(classifyPeriod(payer({ documents: docs }), rules), 'S_PARTIAL_SHARE_DEDUCTION').outcome,
    ).toBe('needs_accountant');
```

Replace `'needs_accountant'` with `'pass'` in that expectation only.

Command: `pnpm --filter @shoebox/domain test -- classify-period 2>&1 | tail -30` → green. Then `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.

## 5. Do not touch

- KH A.1/B.1 (brief 0603). The ledger (`ledger.ts`), the worker, the web app, the spec files.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- dphdp3-deduction 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain test -- dphdp3 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain test -- kh-dp3.property 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain test -- kh-deduction 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain test -- kh 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain test -- classify-period 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/tax-xml test -- kh-shv 2>&1 | tail -30`

## 7. Acceptance

- [ ] Step 1 and step 3 test files pass unchanged.
- [ ] Existing goldens (`dphdp3`, `kh`, `kh-dp3.property`, tax-xml `kh-shv`) pass unchanged.
- [ ] Policy version `2026.2`, flag true, `S_PARTIAL_SHARE_DEDUCTION` passes for a payer.

## 8. Stop and ask

An anchor is not found verbatim, a test the brief wrote seems wrong, or a step admits two readings: stop, write the report with `Status: blocked` and the question.

## 9. Report

`docs/tasks/0602-report.md` per `docs/context/executor.md`; include the `[verify]` line on KH B.2 amounts. Commit as `0602 step k`. Do not push and do not open a PR: the orchestrator merges this branch.
