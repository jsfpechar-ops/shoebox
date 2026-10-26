import type { LegalDate } from '../dates/index';
import { CZK, Money, round0, round2 } from '../money/index';
import { type Dphdp3RowMap, parseDphdp3RowMap } from '../rules/cz/epo';
import type { createCzRules } from '../rules/index';
import type { VatLedgerEntryDraft } from './ledger';

export type Dphdp3Status = 'platce' | 'identifikovana_osoba';
export type Dphdp3Rounding = 'sum_entries_then_round' | 'round_base_then_multiply';

/** Whole CZK (scale 2, e.g. '13700.00'). */
export interface Dphdp3RowValue {
  readonly base: Money;
  readonly tax: Money;
}

export interface Dphdp3Computation {
  readonly status: Dphdp3Status;
  readonly rounding: Dphdp3Rounding;
  readonly periodStart: LegalDate;
  /**
   * Source rows with >= 1 entry + derived rows 43/44/46 (payer, when non-zero); input rows and
   * 43/44 carry the deductible share (§ 75); never 62–65.
   */
  readonly rows: Readonly<Record<string, Dphdp3RowValue>>;
  /** Unrounded sums of the source rows present in `rows`. */
  readonly raw: Readonly<Record<string, Dphdp3RowValue>>;
  readonly row62: Money;
  readonly row63: Money;
  readonly row64: Money;
  readonly row65: Money;
  readonly trans: 'A' | 'N';
  /** Sorted unique. */
  readonly documentIds: readonly string[];
  readonly entryCount: number;
}

/** Output rows 1–13 of the return (ř. 62 sources), by status; see the row map. */
export const IO_RETURN_ROWS: readonly string[] = ['5', '6', '12', '13'];
export const PAYER_RETURN_ROWS: readonly string[] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '10',
  '11',
  '12',
  '13',
];

/** Deduction rows listed on entries; derived from rounded values instead (step 4). */
const DEDUCTION_ROWS: readonly string[] = ['43', '44'];
const TRANS_ROWS: readonly string[] = ['20', '21', '26'];

type CzRules = ReturnType<typeof createCzRules>;

const zeroValue = (): Dphdp3RowValue => ({ base: Money.zero(CZK), tax: Money.zero(CZK) });

const isZeroValue = (v: Dphdp3RowValue): boolean => v.base.isZero() && v.tax.isZero();

export function dphdp3Row(c: Dphdp3Computation, row: string): Dphdp3RowValue {
  return c.rows[row] ?? zeroValue();
}

export function computeDphdp3(
  entries: readonly VatLedgerEntryDraft[],
  status: Dphdp3Status,
  rules: CzRules,
  periodStart: LegalDate,
  roundingOverride?: Dphdp3Rounding,
): Dphdp3Computation {
  const at = rules.at(periodStart);
  const map: Dphdp3RowMap = parseDphdp3RowMap(at.get('epo.dphdp3_row_map'));
  const rates = at.get('vat.rates');
  const rounding: Dphdp3Rounding = roundingOverride ?? at.get('vat.return_rounding');
  const knownRows = new Set(map.map((m) => m.row));
  const counted = entries.filter((e) => e.dphdp3Rows.length > 0);
  const deductible = (m: Money, pct: string): Money => round2(m.multiply(pct).divide('100'));
  const isInputRow = (row: string): boolean => map.some((m) => m.row === row && m.side === 'input');

  // 1–2. Source sums per row (deduction rows 43/44 on entries are ignored).
  const sums = new Map<string, Dphdp3RowValue>();
  for (const entry of counted) {
    for (const row of new Set(entry.dphdp3Rows)) {
      if (DEDUCTION_ROWS.includes(row)) continue;
      if (!knownRows.has(row)) throw new Error(`dphdp3: unknown row ${row}`);
      const prev = sums.get(row) ?? zeroValue();
      const input = isInputRow(row);
      sums.set(row, {
        base: prev.base.add(input ? deductible(entry.baseCzk, entry.deductionPct) : entry.baseCzk),
        tax: prev.tax.add(input ? deductible(entry.vatCzk, entry.deductionPct) : entry.vatCzk),
      });
    }
  }

  // The rate of a source row comes from the row map; a row with only `any` has no tax.
  const rowRate = (row: string): 'standard' | 'reduced' | null => {
    const found = new Set(map.filter((m) => m.row === row && m.rate !== 'any').map((m) => m.rate));
    if (found.size > 1) throw new Error(`dphdp3: row ${row} has more than one rate`);
    const [only] = found;
    return only === 'standard' || only === 'reduced' ? only : null;
  };

  // 3. Rounding per source row.
  const raw: Record<string, Dphdp3RowValue> = {};
  const rounded = new Map<string, Dphdp3RowValue>();
  for (const [row, sum] of sums) {
    raw[row] = { base: sum.base, tax: sum.tax };
    const base = round0(sum.base);
    let tax: Money;
    if (rounding === 'sum_entries_then_round') {
      tax = round0(sum.tax);
    } else {
      const rate = rowRate(row);
      tax =
        rate === null ? Money.zero(CZK) : round0(base.multiply(String(rates[rate])).divide('100'));
    }
    rounded.set(row, { base, tax });
  }

  const get = (row: string): Dphdp3RowValue => rounded.get(row) ?? zeroValue();

  const rows: Record<string, Dphdp3RowValue> = Object.fromEntries(rounded);

  // 4. Derived rows (payers only): 43/44 from the proportional share of their source rows.
  const derive = (target: '43' | '44'): Dphdp3RowValue => {
    const sources = [...new Set(map.filter((m) => m.deduction_row === target).map((m) => m.row))];
    let base = Money.zero(CZK);
    let tax = Money.zero(CZK);
    for (const row of sources) {
      let dBase = Money.zero(CZK);
      let dVat = Money.zero(CZK);
      for (const entry of counted) {
        if (!entry.dphdp3Rows.includes(row)) continue;
        dBase = dBase.add(deductible(entry.baseCzk, entry.deductionPct));
        dVat = dVat.add(deductible(entry.vatCzk, entry.deductionPct));
      }
      const rBase = round0(dBase);
      const rate = rowRate(row);
      const rTax =
        rounding === 'sum_entries_then_round'
          ? round0(dVat)
          : rate === null
            ? Money.zero(CZK)
            : round0(rBase.multiply(String(rates[rate])).divide('100'));
      base = base.add(rBase);
      tax = tax.add(rTax);
    }
    return { base, tax };
  };
  let tax46 = Money.zero(CZK);
  if (status === 'platce') {
    const r43 = derive('43');
    const r44 = derive('44');
    if (!isZeroValue(r43)) rows['43'] = r43;
    if (!isZeroValue(r44)) rows['44'] = r44;
    const inputRows = [...new Set(map.filter((m) => m.side === 'input').map((m) => m.row))];
    tax46 = inputRows
      .filter((row) => Number(row) >= 40 && Number(row) <= 42)
      .reduce((acc, row) => acc.add(get(row).tax), Money.zero(CZK))
      .add(r43.tax)
      .add(r44.tax);
    if (!tax46.isZero()) rows['46'] = { base: Money.zero(CZK), tax: tax46 };
  }

  const returnRows = [
    ...new Set(
      map
        .filter((m) => m.side === 'output' && Number(m.row) <= 13 && m.statuses.includes(status))
        .map((m) => m.row),
    ),
  ];
  const row62 = returnRows.reduce((acc, row) => acc.add(get(row).tax), Money.zero(CZK));
  const row63 = status === 'platce' ? tax46 : Money.zero(CZK);
  const diff64 = row62.subtract(row63);
  const diff65 = row63.subtract(row62);
  const row64 = diff64.isNegative() ? Money.zero(CZK) : diff64;
  const row65 = diff65.isNegative() ? Money.zero(CZK) : diff65;

  // 5. trans flag ([verify] semantics, T-02).
  const trans: 'A' | 'N' =
    !row62.isZero() || TRANS_ROWS.some((row) => !get(row).base.isZero()) ? 'A' : 'N';

  return {
    status,
    rounding,
    periodStart,
    rows,
    raw,
    row62,
    row63,
    row64,
    row65,
    trans,
    documentIds: [...new Set(counted.map((e) => e.documentId))].sort(),
    entryCount: counted.length,
  };
}
