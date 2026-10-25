import { parseLegalDate } from '@shoebox/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { formatLegalDate, LegalDateText } from '../src/index';
import { cleanup, render } from './render';

afterEach(cleanup);

describe('formatLegalDate', () => {
  it('formats as 18. 10. 2026', () => {
    expect(formatLegalDate(parseLegalDate('2026-10-18'))).toBe('18. 10. 2026');
  });

  it('drops leading zeros', () => {
    expect(formatLegalDate(parseLegalDate('2026-01-05'))).toBe('5. 1. 2026');
  });
});

describe('LegalDateText', () => {
  it('renders a <time> with the ISO date and the Czech text', () => {
    const { container } = render(<LegalDateText date={parseLegalDate('2026-10-18')} />);
    const time = container.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-10-18');
    expect(time?.textContent).toBe('18. 10. 2026');
    expect(time?.className).toContain('tabular-nums');
  });
});
