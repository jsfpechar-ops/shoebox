import { CZK, Money } from '../money/index';
import { type Dphdp3Computation, dphdp3Row } from './dphdp3';
import type { KhAmounts, KhComputation } from './kh';

export type ReconciliationCode =
  | 'P1_VETAC_MISMATCH'
  | 'P2_OUTPUT_SUM'
  | 'P2_INPUT_SUM'
  | 'P3_A2_SUM'
  | 'P5_DERIVED_ROWS'
  | 'P5_RESULT_ROWS'
  | 'P6_IO_SHAPE';

/** `detail` is short; numbers as toFixed2(); never document content. */
export interface ReconciliationIssue {
  readonly code: ReconciliationCode;
  readonly detail: string;
}

export interface ReconciliationResult {
  readonly ok: boolean;
  readonly issues: readonly ReconciliationIssue[];
}

const ZERO = Money.zero(CZK);
const VETA_C_TOLERANCE = Money.parse('0.50', CZK);
const A2_SOURCE_ROWS: readonly string[] = ['3', '4', '5', '6', '12', '13'];

const sumKh = (rows: readonly KhAmounts[], key: 'zaklDane1' | 'zaklDane2'): Money =>
  rows.reduce((acc, row) => acc.add(row[key]), ZERO);

const withinTolerance = (a: Money, b: Money, tolerance: Money): boolean =>
  a.subtract(b).abs().compare(tolerance) <= 0;

const issue = (code: ReconciliationCode, detail: string): ReconciliationIssue => ({ code, detail });

/** P1, P2, P3, P5 for a payer (kh given); P5, P6 for an IO (kh null). Pure, never throws on shape. */
export function reconcileKhDp3(
  dp3: Dphdp3Computation,
  kh: KhComputation | null,
): ReconciliationResult {
  const issues: ReconciliationIssue[] = [];
  const row = (code: string) => dphdp3Row(dp3, code);
  const isIo = dp3.status === 'identifikovana_osoba';

  if (isIo) {
    // P6: an identifikovaná osoba has no KH, no Věta 4 rows and ř.64 = ř.62.
    if (kh !== null) issues.push(issue('P6_IO_SHAPE', 'kh present for identifikovana osoba'));
    const deductionRows = Object.keys(dp3.rows).filter((code) => {
      const n = Number.parseInt(code, 10);
      return n >= 40 && n <= 46;
    });
    if (deductionRows.length > 0) {
      issues.push(issue('P6_IO_SHAPE', `rows present: ${deductionRows.join(',')}`));
    }
    // ř.64 = max(ř.62 − ř.63, 0), ř.65 = max(ř.63 − ř.62, 0): a refund period carries ř.65.
    const nonNeg = (m: Money) => (m.isNegative() ? ZERO : m);
    const expect64 = nonNeg(dp3.row62.subtract(dp3.row63));
    const expect65 = nonNeg(dp3.row63.subtract(dp3.row62));
    if (!dp3.row64.equals(expect64) || !dp3.row65.equals(expect65)) {
      issues.push(
        issue(
          'P6_IO_SHAPE',
          `row64 ${dp3.row64.toFixed2()} vs ${expect64.toFixed2()}, row65 ${dp3.row65.toFixed2()} vs ${expect65.toFixed2()}`,
        ),
      );
    }
  } else if (kh === null) {
    issues.push(issue('P1_VETAC_MISMATCH', 'kh missing'));
  } else {
    // P1: Věta C mirrors the DP3 rows exactly.
    const mirrors: readonly [string, Money, Money][] = [
      ['obrat23', kh.c.obrat23, row('1').base],
      ['obrat5', kh.c.obrat5, row('2').base],
      ['pln23', kh.c.pln23, row('40').base],
      ['pln5', kh.c.pln5, row('41').base],
      [
        'celkZdA2',
        kh.c.celkZdA2,
        Money.sum(
          A2_SOURCE_ROWS.map((code) => row(code).base),
          CZK,
        ),
      ],
    ];
    for (const [name, veta, dp3Value] of mirrors) {
      if (!veta.equals(dp3Value)) {
        issues.push(
          issue('P1_VETAC_MISMATCH', `${name} ${veta.toFixed2()} vs dp3 ${dp3Value.toFixed2()}`),
        );
      }
    }

    // P2: Věta C output and input totals against the A4/A5 and B2/B3 rows.
    const outputRows = [...kh.a4, ...(kh.a5 ? [kh.a5] : [])];
    const inputRows = [...kh.b2, ...(kh.b3 ? [kh.b3] : [])];
    const outputChecks: readonly [string, Money, Money][] = [
      ['obrat23', kh.c.obrat23, sumKh(outputRows, 'zaklDane1')],
      ['obrat5', kh.c.obrat5, sumKh(outputRows, 'zaklDane2')],
    ];
    for (const [name, veta, khSum] of outputChecks) {
      if (!withinTolerance(veta, khSum, VETA_C_TOLERANCE)) {
        issues.push(issue('P2_OUTPUT_SUM', `${name} ${veta.toFixed2()} vs KH ${khSum.toFixed2()}`));
      }
    }
    const inputChecks: readonly [string, Money, Money][] = [
      ['pln23', kh.c.pln23, sumKh(inputRows, 'zaklDane1')],
      ['pln5', kh.c.pln5, sumKh(inputRows, 'zaklDane2')],
    ];
    for (const [name, veta, khSum] of inputChecks) {
      if (!withinTolerance(veta, khSum, VETA_C_TOLERANCE)) {
        issues.push(issue('P2_INPUT_SUM', `${name} ${veta.toFixed2()} vs KH ${khSum.toFixed2()}`));
      }
    }

    // P3: Věta C celkZdA2 against the A2 rows, tolerance 0.50 per source row that has entries.
    const sourceRows = A2_SOURCE_ROWS.filter((code) => dp3.raw[code] !== undefined).length;
    const a2Tolerance = Money.parse(((sourceRows * 50) / 100).toFixed(2), CZK);
    const a2Sum = sumKh(kh.a2, 'zaklDane1').add(sumKh(kh.a2, 'zaklDane2'));
    if (!withinTolerance(kh.c.celkZdA2, a2Sum, a2Tolerance)) {
      issues.push(
        issue('P3_A2_SUM', `celkZdA2 ${kh.c.celkZdA2.toFixed2()} vs A2 ${a2Sum.toFixed2()}`),
      );
    }

    // P5: derived deduction rows are the sums of their sources.
    for (const [target, sources] of [
      ['43', ['3', '5', '12']],
      ['44', ['4', '6', '13']],
    ] as const) {
      const base = Money.sum(
        sources.map((code) => row(code).base),
        CZK,
      );
      const tax = Money.sum(
        sources.map((code) => row(code).tax),
        CZK,
      );
      if (!row(target).base.equals(base) || !row(target).tax.equals(tax)) {
        issues.push(
          issue(
            'P5_DERIVED_ROWS',
            `row${target} ${row(target).base.toFixed2()} vs sources ${base.toFixed2()}`,
          ),
        );
      }
    }
  }

  // P5 result rows: apply to both payer and IO.
  const lhs = dp3.row64.subtract(dp3.row65);
  const rhs = dp3.row62.subtract(dp3.row63);
  if (!lhs.equals(rhs)) {
    issues.push(
      issue('P5_RESULT_ROWS', `row64-65 ${lhs.toFixed2()} vs row62-63 ${rhs.toFixed2()}`),
    );
  }
  if (!dp3.row64.isZero() && !dp3.row65.isZero()) {
    issues.push(issue('P5_RESULT_ROWS', 'row64 and row65 both non-zero'));
  }

  return { ok: issues.length === 0, issues };
}
