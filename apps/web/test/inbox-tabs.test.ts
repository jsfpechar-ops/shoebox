import { describe, expect, it } from 'vitest';
import { inboxHref, inboxTabOf, registerDownloadHref } from '../src/documents/inbox-tabs';

describe('inboxTabOf', () => {
  it('opens To review only when something needs the user', () => {
    expect(inboxTabOf(undefined, true)).toBe('review');
    expect(inboxTabOf(undefined, false)).toBe('all');
    expect(inboxTabOf('bogus', false)).toBe('all');
  });
  it('keeps a valid tab from the URL', () => {
    expect(inboxTabOf('all', true)).toBe('all');
    expect(inboxTabOf('trash', true)).toBe('trash');
    expect(inboxTabOf('review', false)).toBe('review');
  });
});

describe('hrefs', () => {
  it('builds tab links, keeping set filters only', () => {
    expect(inboxHref('review')).toBe('/inbox?tab=review');
    expect(inboxHref('all', { year: 2026, paid: 'all', q: '' })).toBe('/inbox?tab=all&year=2026');
    expect(inboxHref('all', { year: null, paid: 'unpaid', q: 'alza a.s.' })).toBe(
      '/inbox?tab=all&paid=unpaid&q=alza+a.s.',
    );
  });
  it('builds the download link', () => {
    expect(registerDownloadHref({ year: null, paid: 'all', q: '' })).toBe('/api/register');
    expect(registerDownloadHref({ year: 2026, paid: 'paid', q: '' })).toBe(
      '/api/register?year=2026&paid=paid',
    );
  });
});
