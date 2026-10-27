import { describe, expect, it } from 'vitest';
import { CHECK_FIELDS, fieldsFlagged, trustOf } from '../src/documents/trust';

const none = new Set<string>();
const gross = new Set(['totals.gross']);

describe('trustOf', () => {
  it('a value the user typed is checked, whatever else holds', () => {
    expect(
      trustOf({
        source: 'user',
        value: '130.00',
        failedOrWarnedFields: gross,
        fieldKey: 'totals.gross',
      }),
    ).toBe('checked');
    expect(trustOf({ source: 'user', value: '', failedOrWarnedFields: none, fieldKey: 'x' })).toBe(
      'checked',
    );
  });

  it('a value read exactly from the file, and not flagged, is exact', () => {
    for (const source of ['isdoc', 'qr', 'pdf_text']) {
      expect(
        trustOf({ source, value: '130.00', failedOrWarnedFields: none, fieldKey: 'totals.gross' }),
      ).toBe('exact');
    }
  });

  it('a flagged value from the file is not exact any more', () => {
    expect(
      trustOf({
        source: 'isdoc',
        value: '130.00',
        failedOrWarnedFields: gross,
        fieldKey: 'totals.gross',
      }),
    ).toBe('check');
  });

  it('an empty value is to be checked', () => {
    expect(trustOf({ source: 'llm', value: '  ', failedOrWarnedFields: none, fieldKey: 'x' })).toBe(
      'check',
    );
  });

  it('a flagged AI value is to be checked', () => {
    expect(
      trustOf({
        source: 'llm',
        value: '130.00',
        failedOrWarnedFields: gross,
        fieldKey: 'totals.gross',
      }),
    ).toBe('check');
  });

  it('an unflagged AI value is checked', () => {
    expect(
      trustOf({
        source: 'llm',
        value: '130.00',
        failedOrWarnedFields: none,
        fieldKey: 'totals.gross',
      }),
    ).toBe('checked');
  });

  it('an unknown or missing source is checked when nothing else applies', () => {
    expect(
      trustOf({ source: 'mystery_source', value: '1', failedOrWarnedFields: none, fieldKey: 'x' }),
    ).toBe('checked');
    expect(trustOf({ source: null, value: '1', failedOrWarnedFields: none, fieldKey: 'x' })).toBe(
      'checked',
    );
  });
});

describe('fieldsFlagged', () => {
  it('maps open check rules to the fields they concern', () => {
    const flagged = fieldsFlagged([
      { rule_id: 'PROTO_VAT_SUM' },
      { rule_id: 'PROTO_ICO_CHECKSUM' },
    ]);
    expect([...flagged].sort()).toEqual(
      ['supplier.ico', 'totals.gross', 'totals.net', 'totals.vat'].sort(),
    );
  });

  it('flags nothing for a rule with no field, or an unknown rule', () => {
    expect(fieldsFlagged([{ rule_id: 'PROTO_PAID' }, { rule_id: 'PROTO_NOPE' }]).size).toBe(0);
    expect(fieldsFlagged([])).toEqual(new Set());
  });

  it('every mapped field key is one the detail page can show', () => {
    const keys = Object.values(CHECK_FIELDS).flat();
    expect(keys.every((key) => /^(totals|supplier|dates|document|payment)\./.test(key))).toBe(true);
  });
});
