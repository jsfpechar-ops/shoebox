import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney, MoneyText } from '../src/index';
import { cleanup, render } from './render';

afterEach(cleanup);

const NBSP = '\u00a0';

describe('formatMoney', () => {
  it('formats CZK the Czech way with NBSP', () => {
    expect(formatMoney('1234.56', 'CZK')).toBe(`1${NBSP}234,56${NBSP}Kč`);
    expect(formatMoney('0', 'CZK')).toBe(`0,00${NBSP}Kč`);
    expect(formatMoney('-1234.56', 'CZK')).toBe(`-1${NBSP}234,56${NBSP}Kč`);
  });

  it('shows a plus sign when signed', () => {
    expect(formatMoney('1234.56', 'CZK', true)).toBe(`+1${NBSP}234,56${NBSP}Kč`);
  });

  it('keeps every digit of a large amount (no float)', () => {
    expect(formatMoney('12345678901234567.89', 'CZK')).toBe(
      `12${NBSP}345${NBSP}678${NBSP}901${NBSP}234${NBSP}567,89${NBSP}Kč`,
    );
  });

  it('formats other currencies', () => {
    expect(formatMoney('12.5', 'EUR')).toBe(`12,50${NBSP}€`);
  });

  it('rejects anything that is not a decimal string', () => {
    for (const bad of ['1,5', '', '1e3', 'abc', '12.']) {
      expect(() => formatMoney(bad, 'CZK')).toThrow(RangeError);
    }
  });
});

describe('MoneyText', () => {
  it('renders 1 234,56 Kč with tabular numerals', () => {
    const { container } = render(<MoneyText value="1234.56" currency="CZK" />);
    const span = container.querySelector('[data-slot="money"]');
    expect(span?.textContent).toBe(`1${NBSP}234,56${NBSP}Kč`);
    expect(span?.className.split(' ')).toContain('num');
  });
});
