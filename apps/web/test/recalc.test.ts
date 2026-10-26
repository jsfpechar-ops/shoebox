import { describe, expect, it } from 'vitest';
import { recalcSuggestion } from '../src/documents/recalc';

const base = { 'totals.net': '1000.00', 'totals.vat': '210.00', 'totals.gross': '1210.00' };

describe('recalcSuggestion', () => {
  it('suggests gross when net is edited and no longer adds up', () => {
    expect(recalcSuggestion({ ...base, 'totals.net': '1100.00' }, 'totals.net')).toEqual({
      editKey: 'totals.gross',
      value: '1310.00',
    });
  });

  it('suggests gross when VAT is edited and no longer adds up', () => {
    expect(recalcSuggestion({ ...base, 'totals.vat': '150.00' }, 'totals.vat')).toEqual({
      editKey: 'totals.gross',
      value: '1150.00',
    });
  });

  it('suggests net when gross is edited and no longer adds up', () => {
    expect(recalcSuggestion({ ...base, 'totals.gross': '1500.00' }, 'totals.gross')).toEqual({
      editKey: 'totals.net',
      value: '1290.00',
    });
  });

  it('returns null when the three already add up', () => {
    expect(recalcSuggestion(base, 'totals.net')).toBeNull();
    expect(recalcSuggestion(base, 'totals.gross')).toBeNull();
  });

  it('returns null when a value is missing', () => {
    expect(recalcSuggestion({ ...base, 'totals.vat': undefined } as never, 'totals.net')).toBeNull();
    expect(recalcSuggestion({ ...base, 'totals.gross': '' }, 'totals.net')).toBeNull();
  });

  it('returns null when a value is an invalid decimal', () => {
    expect(recalcSuggestion({ ...base, 'totals.vat': 'abc' }, 'totals.net')).toBeNull();
    expect(recalcSuggestion({ ...base, 'totals.net': '1,5' }, 'totals.net')).toBeNull();
  });

  it('keeps 2-decimal precision', () => {
    expect(
      recalcSuggestion({ 'totals.net': '100.10', 'totals.vat': '21.02', 'totals.gross': '1' }, 'totals.net'),
    ).toEqual({ editKey: 'totals.gross', value: '121.12' });
  });

  it('allows negatives for a credit note with a negative gross', () => {
    const credit = { 'totals.net': '-1000.00', 'totals.vat': '-210.00', 'totals.gross': '-1200.00' };
    expect(recalcSuggestion({ ...credit, 'totals.net': '-1000.00' }, 'totals.net')).toEqual({
      editKey: 'totals.gross',
      value: '-1210.00',
    });
  });

  it('never suggests a negative value for a document with a positive gross', () => {
    expect(recalcSuggestion({ ...base, 'totals.net': '-300.00' }, 'totals.net')).toBeNull();
  });

  it('returns null for a field that is not a total', () => {
    expect(recalcSuggestion(base, 'dates.issue_date')).toBeNull();
  });
});
