// Lines of a read document (M02 §6 step 5): one `item` line per VAT-recap row, one line from the
// totals when the document prints no recap, and a `rounding` line when `documents.rounding` ≠ 0.
// Pure: no I/O. Money stays a decimal string (ADR-007).
import { Money } from '@shoebox/domain';

export type ReadingVatRateType = 'standard' | 'reduced' | 'zero' | 'none';

export interface LinesOfReadingInput {
  readonly currency: string;
  readonly vatSummary: readonly {
    readonly vatRateType: ReadingVatRateType;
    readonly vatRatePct: string;
    readonly base: string;
    readonly vat: string;
  }[];
  readonly totalNet: string | null;
  readonly totalVat: string | null;
  readonly totalGross: string | null;
  /** `documents.rounding` as stored; `'0'` when there is none. */
  readonly rounding: string;
}

export interface LineOfReading {
  readonly position: number;
  readonly lineType: 'item' | 'rounding';
  readonly net: string | null;
  readonly vat: string | null;
  readonly gross: string;
  readonly vatRateType: ReadingVatRateType;
  readonly vatRatePct: string | null;
}

function money(text: string | null, currency: string): string | null {
  return text === null ? null : Money.parse(text, currency).toString();
}

/**
 * Rules: (1) one `item` line per recap row, in recap order, `gross = base + vat`; (2) no recap row
 * and a `totalGross`: one `item` line from the totals with rate `none`; (3) no recap and no total:
 * no lines; (4) `rounding` ≠ 0 and at least one line: a final `rounding` line (`net = gross = rounding`,
 * `vat = 0`, rate `none`).
 */
export function linesOfReading(input: LinesOfReadingInput): LineOfReading[] {
  const { currency } = input;
  const lines: LineOfReading[] = input.vatSummary.map((row, i) => {
    const base = Money.parse(row.base, currency);
    const vat = Money.parse(row.vat, currency);
    return {
      position: i + 1,
      lineType: 'item',
      net: base.toString(),
      vat: vat.toString(),
      gross: base.add(vat).toString(),
      vatRateType: row.vatRateType,
      vatRatePct: row.vatRatePct,
    };
  });
  if (lines.length === 0 && input.totalGross !== null) {
    lines.push({
      position: 1,
      lineType: 'item',
      net: money(input.totalNet, currency),
      vat: money(input.totalVat, currency),
      gross: Money.parse(input.totalGross, currency).toString(),
      vatRateType: 'none',
      vatRatePct: null,
    });
  }
  const rounding = Money.parse(input.rounding, currency);
  if (lines.length > 0 && !rounding.isZero()) {
    lines.push({
      position: lines.length + 1,
      lineType: 'rounding',
      net: rounding.toString(),
      vat: '0',
      gross: rounding.toString(),
      vatRateType: 'none',
      vatRatePct: null,
    });
  }
  return lines;
}
