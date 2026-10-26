import { describe, expect, it } from 'vitest';
import { cleanPicked, isPickTarget, setPickTarget } from '../src/documents/pick';

describe('cleanPicked', () => {
  it('money from Czech and English formats', () => {
    expect(cleanPicked('money', '8 150,00 Kč')).toBe('8150.00');
    expect(cleanPicked('money', '1,210.5')).toBe('1210.50');
    expect(cleanPicked('money', '1.210,50')).toBe('1210.50');
    expect(cleanPicked('money', '350')).toBe('350');
    expect(cleanPicked('money', 'Celkem')).toBeNull();
  });
  it('dates to ISO', () => {
    expect(cleanPicked('date', '30. 9. 2026')).toBe('2026-09-30');
    expect(cleanPicked('date', 'Datum: 01.10.2026')).toBe('2026-10-01');
    expect(cleanPicked('date', '2026-10-01')).toBe('2026-10-01');
    expect(cleanPicked('date', 'zítra')).toBeNull();
  });
  it('text trimmed and collapsed', () => {
    expect(cleanPicked('text', '  FV   2026/0412 ')).toBe('FV 2026/0412');
    expect(cleanPicked('text', '   ')).toBeNull();
  });
});

describe('pick target', () => {
  it('only the last focused input receives picks', () => {
    setPickTarget('a');
    expect(isPickTarget('a')).toBe(true);
    setPickTarget('b');
    expect(isPickTarget('a')).toBe(false);
    setPickTarget(null);
    expect(isPickTarget('b')).toBe(false);
  });
});
