import { describe, expect, it } from 'vitest';
import { ANALYTICS_VIEWS, toCsv } from '../src/analytics';

describe('toCsv', () => {
  it('writes a header and quotes only what needs quoting', () => {
    const csv = toCsv([
      { kind: 'read', code: 'needs_review', events: 3, rules: ['MATH_SUM', 'ICO_CHECK'] },
      { kind: 'user_edit', code: 'a "b", c', events: null, rules: [] },
    ]);
    expect(csv).toBe(
      'kind,code,events,rules\nread,needs_review,3,MATH_SUM;ICO_CHECK\nuser_edit,"a ""b"", c",,\n',
    );
  });

  it('writes dates as ISO and an empty input as an empty file', () => {
    expect(toCsv([{ at: new Date('2026-10-26T10:00:00Z') }])).toBe(
      'at\n2026-10-26T10:00:00.000Z\n',
    );
    expect(toCsv([])).toBe('');
  });

  it('lists the five views of 0064', () => {
    expect(ANALYTICS_VIEWS).toHaveLength(5);
  });
});
