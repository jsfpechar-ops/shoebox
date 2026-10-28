import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { readBarcodes, writeBarcode } from 'zxing-wasm/full';
import { bicForBankCode } from '../src/pay/bic';
import { buildSpayd, spaydCrc32, spaydFold, spaydSymbol } from '../src/pay/spayd';

const czk = (s: string) => Money.parse(s, CZK);
const D = parseLegalDate;
const FIO = 'CZ8720100000002400123455';
const EXAMPLE = {
  iban: 'CZ6508000000192000145399',
  bic: 'GIBACZPX',
  amount: czk('480.50'),
  vs: '1234567890',
  message: 'Faktura 2026001',
};
const FULL = {
  iban: FIO,
  bic: 'FIOBCZPP',
  amount: czk('1210.00'),
  vs: '2026001',
  ks: '0308',
  ss: '55',
  dueDate: D('2026-03-15'),
  message: 'Úhrada FV2026001',
  recipientName: 'ACME s.r.o.',
};

describe('spaydCrc32', () => {
  it('signs header + sorted attributes joined by * (same as the reader)', () => {
    expect(
      spaydCrc32([
        'ACC:CZ6508000000192000145399+GIBACZPX',
        'AM:480.50',
        'CC:CZK',
        'X-VS:1234567890',
        'MSG:Faktura 2026001',
      ]),
    ).toBe('A479C1F2');
  });
});

describe('spaydFold / spaydSymbol / bic', () => {
  it('folds diacritics, encodes * and keeps case', () => {
    expect(spaydFold('Úhrada  A*B ')).toBe('Uhrada A%2AB');
  });
  it('picks the VS, then the document number, else nothing', () => {
    expect(spaydSymbol('VS 2026001', null)).toBe('2026001');
    expect(spaydSymbol(null, 'FV-2026/001')).toBe('2026001');
    expect(spaydSymbol('12345678901', 'FV-2026/001')).toBe('2026001');
    expect(spaydSymbol(null, 'FV-20260001234')).toBeUndefined();
    expect(spaydSymbol('', null)).toBeUndefined();
  });
  it('knows the listed bank codes only', () => {
    expect([bicForBankCode('0800'), bicForBankCode('2010'), bicForBankCode('9999')]).toEqual([
      'GIBACZPX',
      'FIOBCZPP',
      undefined,
    ]);
  });
});

describe('buildSpayd', () => {
  it('research §5.1 example: keys alphabetical, CRC32 last (A13)', () => {
    expect(buildSpayd(EXAMPLE)).toBe(
      'SPD*1.0*ACC:CZ6508000000192000145399+GIBACZPX*AM:480.50*CC:CZK*MSG:Faktura 2026001*X-VS:1234567890*CRC32:A479C1F2',
    );
  });
  it('full set with due date and symbols', () => {
    expect(buildSpayd(FULL, D('2026-03-01'))).toBe(
      `SPD*1.0*ACC:${FIO}+FIOBCZPP*AM:1210.00*CC:CZK*DT:20260315*MSG:Uhrada FV2026001*RN:ACME s.r.o.*X-KS:0308*X-SS:55*X-VS:2026001*CRC32:05A85966`,
    );
  });
  it('omits DT when the due date is in the past', () => {
    expect(buildSpayd(FULL, D('2026-04-01'))).toBe(
      `SPD*1.0*ACC:${FIO}+FIOBCZPP*AM:1210.00*CC:CZK*MSG:Uhrada FV2026001*RN:ACME s.r.o.*X-KS:0308*X-SS:55*X-VS:2026001*CRC32:E29071C2`,
    );
  });
  it('encodes * in the message, drops an over-long VS, no BIC when none is given', () => {
    expect(
      buildSpayd({
        iban: FIO,
        bic: 'FIOBCZPP',
        amount: czk('5.00'),
        vs: '12345',
        message: 'Uhrada A*B',
      }),
    ).toBe(`SPD*1.0*ACC:${FIO}+FIOBCZPP*AM:5.00*CC:CZK*MSG:Uhrada A%2AB*X-VS:12345*CRC32:CEF7024D`);
    expect(
      buildSpayd({
        iban: FIO,
        bic: 'FIOBCZPP',
        amount: czk('5.00'),
        vs: '12345678901',
        message: 'Uhrada A*B',
      }),
    ).not.toContain('X-VS');
    expect(
      buildSpayd({ iban: 'CZ6508000000192000145399', amount: czk('100.00'), message: 'Uhrada X' }),
    ).toBe('SPD*1.0*ACC:CZ6508000000192000145399*AM:100.00*CC:CZK*MSG:Uhrada X*CRC32:2A807489');
  });
  it('truncates MSG to 60 and RN to 35', () => {
    expect(
      buildSpayd({
        iban: FIO,
        bic: 'FIOBCZPP',
        amount: czk('1.00'),
        message: 'a'.repeat(70),
        recipientName: 'b'.repeat(40),
      }),
    ).toBe(
      `SPD*1.0*ACC:${FIO}+FIOBCZPP*AM:1.00*CC:CZK*MSG:${'a'.repeat(60)}*RN:${'b'.repeat(35)}*CRC32:79345A68`,
    );
  });
  it('refuses a non-CZK amount', () => {
    expect(() => buildSpayd({ iban: FIO, amount: Money.parse('10.00', 'EUR') })).toThrow(
      RangeError,
    );
  });
  it('A13: survives a QR write and read with zxing-wasm', async () => {
    const s = buildSpayd(EXAMPLE);
    const w = await writeBarcode(s, { format: 'QRCode', ecLevel: 'M', scale: 4 });
    if (w.image === null) throw new Error(w.error);
    const r = await readBarcodes(new Uint8Array(await w.image.arrayBuffer()), {
      formats: ['QRCode'],
    });
    expect(r[0]?.text).toBe(s);
  });
});
