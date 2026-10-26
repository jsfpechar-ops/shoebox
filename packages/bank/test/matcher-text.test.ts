import { parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { dateFactor, daysBetween, windowKindOf } from '../src/matcher/dates';
import {
  docKeys,
  foldText,
  levenshtein,
  messageHasDocKey,
  normMerchant,
  tokenSetRatio,
} from '../src/matcher/text';

const D = parseLegalDate;

describe('foldText / normMerchant', () => {
  it('folds diacritics and case', () => {
    expect(foldText('  Česká spořitelna ')).toBe('CESKA SPORITELNA');
  });
  it.each([
    ['PAYPAL *SPOTIFY 40293577 LU', 'SPOTIFY'],
    ['SumUp  *Kavarna U Lipy', 'KAVARNA U LIPY'],
    ['Alza.cz a.s., Praha', 'ALZA'],
    ['IKEA Zlicin CZ', 'IKEA ZLICIN'],
    ['www.rohlik.cz', 'ROHLIK'],
    ['AMZN Mktp DE', 'AMAZON'],
    ['APPLE.COM/BILL', 'APPLE'],
    ['Alfa Servis s.r.o.', 'ALFA SERVIS'],
    ['Česká spořitelna, a.s.', 'CESKA SPORITELNA'],
    ['', ''],
  ])('normMerchant(%j) = %j', (input, expected) => {
    expect(normMerchant(input)).toBe(expected);
  });
});

describe('levenshtein / tokenSetRatio', () => {
  it('counts edits', () => {
    expect(levenshtein('KITTEN', 'SITTING')).toBe(3);
    expect(levenshtein('', 'ALFA')).toBe(4);
    expect(levenshtein('ALFA', 'ALFA')).toBe(0);
  });
  it('is 1 for equal token sets and subsets', () => {
    expect(tokenSetRatio('ALFA SERVIS', 'ALFA SERVIS')).toBe(1);
    expect(tokenSetRatio('ALFA SERVIS', 'SERVIS ALFA')).toBe(1);
    expect(tokenSetRatio('ALFA', 'ALFA SERVIS')).toBe(1);
  });
  it('is partial for near names and 0 for empty input', () => {
    expect(tokenSetRatio('ALFA', 'BETA')).toBeCloseTo(0.25, 6);
    expect(tokenSetRatio('ALFA SERVIS', 'ALFA SERVICE')).toBeCloseTo(0.8333, 3);
    expect(tokenSetRatio('', 'ALFA')).toBe(0);
    expect(tokenSetRatio('', '')).toBe(0);
  });
});

describe('docKeys / messageHasDocKey', () => {
  it('builds keys from VS and document number', () => {
    expect(docKeys({ documentNumber: 'FV2026001', variableSymbol: '2026001' })).toEqual([
      '2026001',
    ]);
    expect(docKeys({ documentNumber: '2026-0000123456' })).toEqual(['123456']);
    expect(docKeys({ variableSymbol: '0000123' })).toEqual(['123']);
    expect(docKeys({ documentNumber: 'F-7' })).toEqual(['7']);
    expect(docKeys({})).toEqual([]);
  });
  it('finds keys as whole tokens in the message', () => {
    const d = { documentNumber: 'FV2026001', variableSymbol: '2026001' };
    expect(messageHasDocKey('Faktura FV2026001 dekujeme', d)).toBe(true);
    expect(messageHasDocKey('uhrada 2026001', d)).toBe(true);
    expect(messageHasDocKey('platba 0002026001', d)).toBe(true);
    expect(messageHasDocKey('uhrada 12026001', d)).toBe(false);
    expect(messageHasDocKey(undefined, d)).toBe(false);
    expect(
      messageHasDocKey('faktura 2026-0000123456 ', { documentNumber: '2026-0000123456' }),
    ).toBe(true);
  });
});

describe('dates', () => {
  const doc = { issueDate: D('2026-03-01'), dueDate: D('2026-03-15') };
  it('daysBetween', () => {
    expect(daysBetween(D('2026-03-01'), D('2026-03-10'))).toBe(9);
    expect(daysBetween(D('2026-03-10'), D('2026-03-01'))).toBe(-9);
  });
  it('windowKindOf', () => {
    expect(windowKindOf({}, { cls: 'received_invoice' })).toBe('transfer');
    expect(windowKindOf({ cardMerchant: 'IKEA' }, { cls: 'received_invoice' })).toBe('card');
    expect(windowKindOf({}, { cls: 'received_receipt', paymentMethod: 'card' })).toBe('card');
    expect(windowKindOf({}, { cls: 'platform_statement' })).toBe('payout');
    expect(windowKindOf({}, { cls: 'government_filing' })).toBe('filing');
  });
  it.each([
    ['2026-03-10', 1, false, 0],
    ['2026-03-20', 1, false, 0],
    ['2026-02-27', 1 / 3, false, 2],
    ['2026-02-26', 0, false, 3],
    ['2026-04-09', 0.5, false, 20],
    ['2026-04-29', 0, false, 40],
    ['2026-04-30', 0, true, 41],
    ['2026-02-25', 0, true, 4],
  ])('transfer %s → f %d outside %s dist %d', (x, f, outside, dist) => {
    const r = dateFactor('transfer', D(x), doc);
    expect(r.f).toBeCloseTo(f, 6);
    expect(r.outside).toBe(outside);
    expect(r.anchorDistanceDays).toBe(dist);
  });
  it('transfer without due date uses issue + 30', () => {
    const d = { issueDate: D('2026-03-01') };
    expect(dateFactor('transfer', D('2026-04-05'), d).f).toBe(1);
    expect(dateFactor('transfer', D('2026-04-06'), d).f).toBeCloseTo(0.975, 6);
  });
  it('missing issue date is neutral', () => {
    expect(dateFactor('transfer', D('2026-03-10'), {})).toEqual({
      f: 0,
      outside: false,
      anchorDistanceDays: 0,
    });
  });
  it.each([
    ['2026-03-02', 1, false, 1],
    ['2026-02-27', 0.5, false, 2],
    ['2026-03-05', 0.5, false, 4],
    ['2026-03-09', 0, true, 8],
  ])('card %s → f %d outside %s', (x, f, outside, dist) => {
    const r = dateFactor('card', D(x), doc);
    expect(r.f).toBeCloseTo(f, 6);
    expect(r.outside).toBe(outside);
    expect(r.anchorDistanceDays).toBe(dist);
  });
  it('payout anchors on due date, else service period end', () => {
    expect(dateFactor('payout', D('2026-03-17'), doc).f).toBeCloseTo(0.6, 6);
    expect(dateFactor('payout', D('2026-03-21'), doc).outside).toBe(true);
    expect(dateFactor('payout', D('2026-03-31'), { servicePeriodTo: D('2026-03-31') }).f).toBe(1);
  });
  it('filing plateau from period end to due + 30', () => {
    const f = { servicePeriodTo: D('2026-03-31'), dueDate: D('2026-04-25') };
    expect(dateFactor('filing', D('2026-04-10'), f)).toMatchObject({ f: 1, outside: false });
    expect(dateFactor('filing', D('2026-05-25'), f)).toMatchObject({ f: 1, outside: false });
    expect(dateFactor('filing', D('2026-05-26'), f)).toMatchObject({
      f: 0,
      outside: true,
      anchorDistanceDays: 1,
    });
    expect(dateFactor('filing', D('2026-03-30'), f)).toMatchObject({
      f: 0,
      outside: true,
      anchorDistanceDays: 1,
    });
  });
});
