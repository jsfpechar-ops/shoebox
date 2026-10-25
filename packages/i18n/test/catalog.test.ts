import { describe, expect, it } from 'vitest';
import cs from '../messages/cs.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import { createT, parse, t } from '../src/index';

const catalogs: Record<string, Record<string, string>> = { cs, en };

function invalidMessages(): string[] {
  const failures: string[] = [];
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const [key, message] of Object.entries(catalog)) {
      try {
        parse(message);
      } catch (error) {
        failures.push(`${locale} ${key}: ${String(error)}`);
      }
    }
  }
  return failures;
}

describe('catalogs', () => {
  it('cs has no key that en lacks', () => {
    const extra = Object.keys(cs).filter((k) => !(k in en));
    expect(extra).toEqual([]);
  });

  it('keys follow <area>.<screen|object>.<element>', () => {
    const bad = Object.keys(en).filter((key) => !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(key));
    expect(bad).toEqual([]);
  });

  it('every message is valid ICU and not empty', () => {
    expect(invalidMessages()).toEqual([]);
    const empty = Object.entries(catalogs).flatMap(([locale, catalog]) =>
      Object.entries(catalog)
        .filter(([, message]) => message.trim() === '')
        .map(([key]) => `${locale} ${key}`),
    );
    expect(empty).toEqual([]);
  });
});

describe('t', () => {
  it('renders English source strings', () => {
    expect(t('inbox.upload.cta')).toBe('Upload documents');
    expect(t('review.progress', { n: 2, total: 5 })).toBe('Question 2 of 5');
  });

  it('renders English plurals for 1 and 5', () => {
    expect(t('common.documents.count', { n: 1 })).toBe('1 document');
    expect(t('common.documents.count', { n: 5 })).toBe('5 documents');
  });

  it('renders Czech through createT, falling back to English', () => {
    expect(createT('cs')('inbox.upload.cta')).toBe('Nahrát doklady');
    expect(createT('en')('inbox.upload.cta')).toBe('Upload documents');
  });
});
