import { describe, expect, it } from 'vitest';
import { findMatch, normaliseForMatch, type TextItem } from '../src/documents/locate';

const item = (str: string, x: number, y = 10, page = 1): TextItem => ({
  str,
  page,
  x,
  y,
  w: str.length * 5,
  h: 10,
});

describe('normaliseForMatch', () => {
  it('treats money written differently as equal', () => {
    expect(normaliseForMatch('money', '1 210,00')).toBe(normaliseForMatch('money', '1210.00'));
    expect(normaliseForMatch('money', '1 210,00 Kč')).toBe('1210');
    expect(normaliseForMatch('money', '8 150,50')).toBe('8150.5');
  });
  it('treats three date formats as equal', () => {
    const iso = normaliseForMatch('date', '2026-10-01');
    expect(normaliseForMatch('date', '1. 10. 2026')).toBe(iso);
    expect(normaliseForMatch('date', '01.10.2026')).toBe(iso);
  });
  it('ignores spaces in text', () => {
    expect(normaliseForMatch('text', '270 82 440')).toBe('27082440');
  });
});

describe('findMatch', () => {
  it('finds money by a single item', () => {
    const m = findMatch([item('Total', 0), item('1 210,00', 40)], 'money', '1210.00');
    expect(m?.rect.x).toBe(40);
  });
  it('finds an IČO written with spaces', () => {
    expect(findMatch([item('270 82 440', 5)], 'text', '27082440')?.page).toBe(1);
  });
  it('finds a date in any format', () => {
    expect(findMatch([item('01.10.2026', 5)], 'date', '2026-10-01')).not.toBeNull();
    expect(findMatch([item('1. 10. 2026', 5)], 'date', '2026-10-01')).not.toBeNull();
  });
  it('joins a value split over two adjacent items on one line', () => {
    const m = findMatch([item('1 2', 10), item('10,00', 25)], 'money', '1210');
    expect(m).toEqual({ page: 1, rect: { x: 10, y: 10, w: 40, h: 10 } });
  });
  it('does not join items on different lines', () => {
    expect(findMatch([item('1 2', 10, 10), item('10,00', 25, 40)], 'money', '1210')).toBeNull();
  });
  it('finds a value inside a longer item', () => {
    expect(findMatch([item('Total 1 210,00', 0)], 'money', '1210.00')).not.toBeNull();
  });
  it('returns null when nothing matches or the value is empty', () => {
    expect(findMatch([item('abc', 0)], 'text', 'xyz')).toBeNull();
    expect(findMatch([item('abc', 0)], 'text', '')).toBeNull();
  });
});
