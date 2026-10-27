import { describe, expect, it } from 'vitest';
import { linesOfReading } from '../src/document-lines-of-reading';

describe('linesOfReading', () => {
  it('writes one item line per recap row, gross = base + vat', () => {
    expect(
      linesOfReading({
        currency: 'CZK',
        vatSummary: [
          { vatRateType: 'standard', vatRatePct: '21', base: '1000.00', vat: '210.00' },
          { vatRateType: 'reduced', vatRatePct: '12', base: '50.50', vat: '6.06' },
        ],
        totalNet: '1050.50',
        totalVat: '216.06',
        totalGross: '1266.56',
        rounding: '0',
      }),
    ).toEqual([
      {
        position: 1,
        lineType: 'item',
        net: '1000',
        vat: '210',
        gross: '1210',
        vatRateType: 'standard',
        vatRatePct: '21',
      },
      {
        position: 2,
        lineType: 'item',
        net: '50.5',
        vat: '6.06',
        gross: '56.56',
        vatRateType: 'reduced',
        vatRatePct: '12',
      },
    ]);
  });

  it('falls back to one line from the totals when there is no recap', () => {
    expect(
      linesOfReading({
        currency: 'CZK',
        vatSummary: [],
        totalNet: null,
        totalVat: null,
        totalGross: '249.00',
        rounding: '0',
      }),
    ).toEqual([
      {
        position: 1,
        lineType: 'item',
        net: null,
        vat: null,
        gross: '249',
        vatRateType: 'none',
        vatRatePct: null,
      },
    ]);
  });

  it('writes nothing without a recap and without a total, even with a rounding', () => {
    expect(
      linesOfReading({
        currency: 'CZK',
        vatSummary: [],
        totalNet: null,
        totalVat: null,
        totalGross: null,
        rounding: '-0.40',
      }),
    ).toEqual([]);
  });

  it('adds a rounding line with the printed sign after the items', () => {
    const lines = linesOfReading({
      currency: 'CZK',
      vatSummary: [{ vatRateType: 'standard', vatRatePct: '21', base: '13654.05', vat: '2868.35' }],
      totalNet: '13654.05',
      totalVat: '2868.35',
      totalGross: '16522.00',
      rounding: '-0.40',
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({
      position: 2,
      lineType: 'rounding',
      net: '-0.4',
      vat: '0',
      gross: '-0.4',
      vatRateType: 'none',
      vatRatePct: null,
    });
  });

  it('keeps credit-note lines negative', () => {
    const [line] = linesOfReading({
      currency: 'CZK',
      vatSummary: [{ vatRateType: 'standard', vatRatePct: '21', base: '-100.00', vat: '-21.00' }],
      totalNet: '-100.00',
      totalVat: '-21.00',
      totalGross: '-121.00',
      rounding: '0',
    });
    expect(line?.gross).toBe('-121');
  });
});
