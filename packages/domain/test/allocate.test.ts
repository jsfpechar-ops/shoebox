import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AllocationError, allocateProRata } from '../src/ledgers/allocate';
import { CurrencyMismatchError, Money, round2 } from '../src/money/index';

const czk = (s: string) => Money.parse(s, 'CZK');
const w = (...xs: string[]) => xs.map(czk);
const out = (ms: readonly Money[]) => ms.map((m) => m.toFixed2());

/** Integer cents → decimal literal without floats (`-1234` → `'-12.34'`). */
function centsToLiteral(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${frac < 10 ? '0' : ''}${frac}`;
}
const centsArb = (min: number, max: number) => fc.integer({ min, max }).map((c) => czk(centsToLiteral(c)));

describe('allocateProRata (M04 §4.11.3, AC-4)', () => {
  it('hand-checked cases', () => {
    expect(out(allocateProRata(czk('100.00'), w('1', '1', '1')))).toEqual(['33.34', '33.33', '33.33']);
    expect(out(allocateProRata(czk('0.10'), w('1', '1', '1')))).toEqual(['0.04', '0.03', '0.03']);
    expect(out(allocateProRata(czk('-100.00'), w('1', '1', '1')))).toEqual(['-33.34', '-33.33', '-33.33']);
    expect(out(allocateProRata(czk('1.00'), w('1', '1', '1', '1', '1', '1')))).toEqual(['0.15', '0.17', '0.17', '0.17', '0.17', '0.17']);
    expect(out(allocateProRata(czk('100.00'), w('150', '-50')))).toEqual(['150.00', '-50.00']);
    expect(out(allocateProRata(czk('1.00'), w('1', '2')))).toEqual(['0.33', '0.67']);
    expect(out(allocateProRata(czk('7.00'), w('5', '-3', '10')))).toEqual(['2.92', '-1.75', '5.83']);
    expect(out(allocateProRata(czk('10.00'), w('0', '5')))).toEqual(['0.00', '10.00']);
    expect(out(allocateProRata(czk('12960.84'), w('9680.00', '3280.84')))).toEqual(['9680.00', '3280.84']);
    expect(out(allocateProRata(czk('5000.00'), w('9680.00', '3280.84')))).toEqual(['3734.33', '1265.67']);
  });

  it('residual goes to the largest |weight|, tie → lowest index', () => {
    expect(out(allocateProRata(czk('0.10'), w('1', '3', '3')))).toEqual(['0.01', '0.05', '0.04']);
    expect(out(allocateProRata(czk('0.10'), w('-1', '-1', '1', '1', '1', '1', '1')))).toEqual(['-0.02', '-0.03', '0.03', '0.03', '0.03', '0.03', '0.03']);
    expect(out(allocateProRata(czk('0.10'), w('-5', '1', '1')))).toEqual(['0.16', '-0.03', '-0.03']);
  });

  it('result currency is the total’s; weights may be in another currency', () => {
    const r = allocateProRata(czk('245.35'), [Money.parse('7.46', 'USD'), Money.parse('3.00', 'USD')]);
    expect(r.every((m) => m.currency === 'CZK')).toBe(true);
    expect(Money.sum(r, 'CZK').toFixed2()).toBe('245.35');
  });

  it('degenerate inputs', () => {
    expect(out(allocateProRata(czk('0.00'), w('0', '0')))).toEqual(['0.00', '0.00']);
    expect(allocateProRata(czk('0.00'), [])).toEqual([]);
    expect(() => allocateProRata(czk('1.00'), [])).toThrow(AllocationError);
    expect(() => allocateProRata(czk('1.00'), w('5', '-5'))).toThrow(AllocationError);
    expect(() => allocateProRata(czk('1.00'), [czk('1'), Money.parse('1', 'EUR')])).toThrow(CurrencyMismatchError);
  });

  it('property: Σ allocations = total exactly, two decimals, deterministic (10 000 runs, negative weights included)', () => {
    fc.assert(
      fc.property(
        centsArb(-1_000_000_000, 1_000_000_000),
        fc.array(centsArb(-10_000_000, 10_000_000), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          fc.pre(!Money.sum(weights, 'CZK').isZero());
          const a = allocateProRata(total, weights);
          const b = allocateProRata(total, weights);
          expect(a).toHaveLength(weights.length);
          expect(Money.sum(a, 'CZK').equals(total)).toBe(true);
          for (const [i, m] of a.entries()) {
            expect(round2(m).equals(m)).toBe(true);
            expect(m.equals(b[i] as Money)).toBe(true);
          }
        },
      ),
      { numRuns: 10_000 },
    );
  });

});
