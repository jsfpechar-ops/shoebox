import { parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  DIC_CZ_RE,
  FOREIGN_VAT_ID_RE,
  icoChecksumValid,
  type ProtoCheckInput,
  type ProtoCheckResult,
  renderProtoChecks,
  runProtoChecks,
} from '../src/index';

// Synthetic values only (hard rule 4). IČO 25596641 and 00006947 are textbook valid checksums.
const TODAY = parseLegalDate('2026-10-18');

function input(overrides: Partial<ProtoCheckInput> = {}): ProtoCheckInput {
  return {
    supplier: { ico: '25596641', dic: 'CZ25596641' },
    dates: { issue_date: '2026-09-12', duzp: '2026-08-31', due_date: '2026-09-26' },
    currency: 'CZK',
    totals: { gross: '12960.84' },
    vat_recap: [{ rate_pct: '21', base: '10711.44', vat: '2249.40' }],
    ...overrides,
  };
}

function byId(
  results: readonly ProtoCheckResult[],
  id: ProtoCheckResult['id'],
): ProtoCheckResult[] {
  return results.filter((result) => result.id === id);
}

describe('icoChecksumValid (real cases)', () => {
  it('accepts Makro and rejects its misread', () => {
    expect(icoChecksumValid('26450691')).toBe(true);
    expect(icoChecksumValid('26465681')).toBe(false);
    expect(icoChecksumValid('62904965')).toBe(true);
    expect(icoChecksumValid('24771902')).toBe(true);
  });
});

describe('icoChecksumValid', () => {
  it('accepts valid check digits, including the remainder 0 and 1 cases', () => {
    expect(icoChecksumValid('25596641')).toBe(true);
    expect(icoChecksumValid('00006947')).toBe(true);
    expect(icoChecksumValid('27082440')).toBe(true);
    expect(icoChecksumValid('21737959')).toBe(true);
  });

  it('rejects a wrong digit, a wrong length and letters', () => {
    expect(icoChecksumValid('25596642')).toBe(false);
    expect(icoChecksumValid('2559664')).toBe(false);
    expect(icoChecksumValid('2559664A')).toBe(false);
  });
});

describe('runProtoChecks', () => {
  it('passes a consistent domestic invoice', () => {
    const results = runProtoChecks(input(), { today: TODAY });
    expect(results.map((result) => [result.id, result.severity])).toEqual([
      ['vat_rate_math', 'pass'],
      ['vat_sum', 'pass'],
      ['ico_checksum', 'pass'],
      ['dic_format', 'pass'],
      ['date_issue', 'pass'],
      ['date_duzp', 'pass'],
      ['date_due', 'pass'],
    ]);
    expect(byId(results, 'vat_sum')[0]?.params).toEqual({
      total: '12960.84',
      sum: '12960.84',
      diff: '0.00',
    });
  });

  it('notes rounding within the 1.00 tolerance and fails beyond it', () => {
    const warn = runProtoChecks(input({ totals: { gross: '12961.00' } }), { today: TODAY });
    expect(byId(warn, 'vat_sum')[0]).toMatchObject({ severity: 'info', params: { diff: '0.16' } });
    const fail = runProtoChecks(input({ totals: { gross: '13000.00' } }), { today: TODAY });
    expect(byId(fail, 'vat_sum')[0]).toMatchObject({ severity: 'fail', params: { diff: '39.16' } });
  });

  it('checks VAT per rate with round2(base × rate / 100), 0.01 warn band, unknown rates', () => {
    const results = runProtoChecks(
      input({
        totals: { gross: '0.00' },
        vat_recap: [
          { rate_pct: '21', base: '96.66', vat: '20.29' },
          { rate_pct: '21', base: '96.66', vat: '20.30' },
          { rate_pct: '12', base: '100.00', vat: '21.00' },
          { rate_pct: '15', base: '100.00', vat: '15.00' },
          { rate_pct: '0', base: '90.00', vat: '0.00' },
        ],
      }),
      { today: TODAY },
    );
    const math = byId(results, 'vat_rate_math');
    expect(math.map((result) => [result.severity, result.key])).toEqual([
      ['warn', 'proto.check.vat_rate_math.warn'],
      ['pass', 'proto.check.vat_rate_math.pass'],
      ['fail', 'proto.check.vat_rate_math.fail'],
      ['warn', 'proto.check.vat_rate_math.unknown_rate'],
      ['pass', 'proto.check.vat_rate_math.pass'],
    ]);
    expect(math[0]?.params).toEqual({ rate: '21', base: '96.66', vat: '20.29', expected: '20.30' });
    expect(math[3]?.params).toEqual({ rate: '15', date: '2026-09-12' });
    expect(byId(results, 'vat_sum')[0]?.severity).toBe('fail');
  });

  it('skips VAT checks without lines, and flags an unreadable line without a total check', () => {
    const none = runProtoChecks(input({ vat_recap: [] }), { today: TODAY });
    expect(byId(none, 'vat_sum')).toEqual([]);
    expect(byId(none, 'vat_rate_math')).toEqual([]);
    const broken = runProtoChecks(
      input({ vat_recap: [{ rate_pct: 'x', base: '1.00', vat: '0.21' }] }),
      { today: TODAY },
    );
    expect(byId(broken, 'vat_rate_math')[0]).toMatchObject({
      severity: 'fail',
      key: 'proto.check.vat_rate_math.invalid',
    });
    expect(byId(broken, 'vat_sum')).toEqual([]);
    const noGross = runProtoChecks(input({ totals: { gross: null } }), { today: TODAY });
    expect(byId(noGross, 'vat_sum')).toEqual([]);
  });

  it('falls back to CZK math for an unknown currency and uses the rules for the issue date', () => {
    const results = runProtoChecks(
      input({ currency: 'ZZZZ', dates: { issue_date: '2024-01-01', duzp: null, due_date: null } }),
      { today: TODAY },
    );
    expect(byId(results, 'vat_sum')[0]?.severity).toBe('pass');
    expect(byId(results, 'date_issue')[0]?.severity).toBe('pass');
  });

  it('checks IČO and DIČ only when present; foreign VAT IDs warn', () => {
    const missing = runProtoChecks(input({ supplier: { ico: null, dic: null } }), { today: TODAY });
    expect(byId(missing, 'ico_checksum')).toEqual([]);
    expect(byId(missing, 'dic_format')).toEqual([]);
    const bad = runProtoChecks(input({ supplier: { ico: '25596642', dic: 'CZ123' } }), {
      today: TODAY,
    });
    expect(byId(bad, 'ico_checksum')[0]).toMatchObject({
      severity: 'fail',
      params: { ico: '25596642' },
    });
    expect(byId(bad, 'dic_format')[0]).toMatchObject({
      severity: 'fail',
      params: { dic: 'CZ123' },
    });
    const foreign = runProtoChecks(input({ supplier: { ico: null, dic: 'IE4276970QH' } }), {
      today: TODAY,
    });
    expect(byId(foreign, 'dic_format')[0]?.severity).toBe('warn');
    expect(DIC_CZ_RE.test('CZ27082440')).toBe(true);
    expect(FOREIGN_VAT_ID_RE.test('NL805734958B01')).toBe(true);
  });

  it('fails future issue and DUZP dates, a due date before issue, and invalid dates', () => {
    const results = runProtoChecks(
      input({ dates: { issue_date: '2026-10-19', duzp: '2026-13-01', due_date: '2026-10-01' } }),
      { today: TODAY },
    );
    expect(byId(results, 'date_issue')[0]).toMatchObject({
      severity: 'fail',
      key: 'proto.check.date.fail_future',
      params: { field: 'date_issue', date: '2026-10-19', today: '2026-10-18' },
    });
    expect(byId(results, 'date_duzp')[0]).toMatchObject({
      severity: 'fail',
      key: 'proto.check.date.fail_invalid',
    });
    expect(byId(results, 'date_due')[0]).toMatchObject({
      severity: 'fail',
      key: 'proto.check.date.fail_due',
      params: { due: '2026-10-01', issue: '2026-10-19' },
    });
    const absent = runProtoChecks(
      input({ dates: { issue_date: null, duzp: null, due_date: null } }),
      {
        today: TODAY,
      },
    );
    expect(absent.filter((result) => result.id.startsWith('date_'))).toEqual([]);
  });
});

describe('renderProtoChecks', () => {
  it('renders Czech by default and English on request, translating the field label', () => {
    const results = runProtoChecks(
      input({ dates: { issue_date: '2026-10-19', duzp: null, due_date: null } }),
      { today: TODAY },
    );
    const cs = renderProtoChecks(results);
    expect(cs.find((result) => result.id === 'date_issue')?.message).toBe(
      'Datum vystavení 2026-10-19 je v budoucnosti (dnes 2026-10-18).',
    );
    expect(cs.find((result) => result.id === 'vat_sum')?.message).toBe(
      'Součet základů a DPH odpovídá celkové částce 12960.84.',
    );
    const en = renderProtoChecks(results, 'en');
    expect(en.find((result) => result.id === 'ico_checksum')?.message).toBe(
      'IČO 25596641 has a valid check digit.',
    );
    expect(en.find((result) => result.id === 'date_issue')?.message).toBe(
      'Issue date 2026-10-19 is in the future (today 2026-10-18).',
    );
  });
});
