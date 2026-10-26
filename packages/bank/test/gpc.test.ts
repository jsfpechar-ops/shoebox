import { describe, expect, it } from 'vitest';
import { parseGpc } from '../src/parsers/gpc';

const z = (v: string, n: number) => v.padStart(n, '0');
const t = (v: string, n: number) => v.padEnd(n, ' ').slice(0, n);
const OWN = '0000002400123455';

function h074(o: { opening: string; closing: string; debit: string; credit: string }): string {
  return (
    `074${OWN}${t('SYSEL TEST', 20)}140926` +
    `${z(o.opening, 14)}+${z(o.closing, 14)}+${z(o.debit, 14)}-${z(o.credit, 14)}+` +
    `007300926${' '.repeat(14)}`
  );
}

function r075(o: {
  counter?: string;
  id?: string;
  halere: string;
  code: string;
  vs?: string;
  ks?: string;
  ss?: string;
  valuta?: string;
  name?: string;
  currency?: string;
  date?: string;
  account?: string;
}): string {
  return (
    `075${o.account ?? OWN}${z(o.counter ?? '', 16)}${z(o.id ?? '', 13)}${z(o.halere, 12)}${o.code}` +
    `${z(o.vs ?? '', 10)}${z(o.ks ?? '', 10)}${z(o.ss ?? '', 10)}${o.valuta ?? '000000'}` +
    `${t(o.name ?? '', 20)}0${o.currency ?? '0203'}${o.date ?? '000000'}`
  );
}

const IN = r075({
  counter: '0010031234567899',
  id: '12345678',
  halere: '1210000',
  code: '2',
  vs: '2026001',
  ks: '0008000308',
  valuta: '150926',
  name: 'ODBERATEL SRO',
  date: '150926',
});
const OUT = r075({ id: '12345679', halere: '121050', code: '1', name: 'Platba kartou', date: '160926' });
const STORNO = r075({ id: '12345680', halere: '10000', code: '4', valuta: '170926' });
const HEAD = h074({ opening: '1000000', closing: '2098950', debit: '121050', credit: '1220000' });
const FILE = [HEAD, IN, OUT, '078NAKUP: KAVARNA PRAHA', STORNO].join('\r\n');

describe('parseGpc', () => {
  it('builds 128-char records', () => {
    for (const line of [HEAD, IN, OUT, STORNO]) expect(line).toHaveLength(128);
  });

  it('reads the Fio profile: header, signs, symbols, reversal, message', () => {
    const s = parseGpc(FILE, { profile: 'gpc_fio' });
    expect(s.warnings).toEqual([]);
    expect(s.format).toBe('gpc');
    expect(s.profile).toBe('gpc_fio');
    expect(s.account).toEqual({ account: '2400123455', currency: 'CZK' });
    expect(s.periodFrom).toBe('2026-09-15');
    expect(s.periodTo).toBe('2026-09-30');
    expect(s.statementNumber).toBe('7');
    expect(s.openingBalance?.toString()).toBe('10000');
    expect(s.closingBalance?.toString()).toBe('20989.5');
    expect(s.balanceCheck).toBe('ok');
    expect(s.txs).toHaveLength(3);

    const [inc, out, storno] = s.txs;
    expect(inc?.amount.toString()).toBe('12100');
    expect(inc?.externalId).toBe('gpc:12345678');
    expect(inc?.bookedOn).toBe('2026-09-15');
    expect(inc?.valueDate).toBe('2026-09-15');
    expect(inc?.vs).toBe('2026001');
    expect(inc?.ks).toBe('308');
    expect(inc?.ss).toBeUndefined();
    expect(inc?.counterparty).toEqual({
      account: '1003-1234567899',
      bankCode: '0800',
      iban: 'CZ4608000010031234567899',
      name: 'ODBERATEL SRO',
    });

    expect(out?.amount.toString()).toBe('-1210.5');
    expect(out?.counterparty).toEqual({ name: 'Platba kartou' });
    expect(out?.vs).toBeUndefined();
    expect(out?.message).toBe('NAKUP: KAVARNA PRAHA');
    expect(out?.isReversal).toBeFalsy();

    expect(storno?.amount.toString()).toBe('100');
    expect(storno?.isReversal).toBe(true);
    expect(storno?.bookedOn).toBe('2026-09-17');
  });

  it('reads the generic profile: plain KS, no external id, period from the balance date', () => {
    const s = parseGpc(FILE);
    expect(s.profile).toBe('gpc_generic');
    expect(s.periodFrom).toBe('2026-09-14');
    expect(s.txs[0]?.ks).toBe('8000308');
    expect(s.txs[0]?.externalId).toBeUndefined();
    expect(s.txs[0]?.counterparty.bankCode).toBeUndefined();
  });

  it('flags a balance mismatch', () => {
    const bad = [h074({ opening: '1000000', closing: '2098951', debit: '121050', credit: '1220000' }), IN, OUT, STORNO];
    expect(parseGpc(bad.join('\n'), { profile: 'gpc_fio' }).balanceCheck).toBe('mismatch');
  });

  it('skips bad rows with a warning and keeps the rest', () => {
    const odd = r075({ id: '9', halere: '100', code: '9', date: '150926' });
    const other = r075({ id: '8', halere: '100', code: '1', date: '150926', account: '0000002400123463' });
    const s = parseGpc([HEAD, 'garbage', IN, odd, other].join('\n'), { profile: 'gpc_fio' });
    expect(s.txs).toHaveLength(1);
    expect(s.warnings.map((w) => [w.line, w.code])).toEqual([
      [2, 'gpc.bad_line'],
      [4, 'gpc.posting_code'],
      [5, 'gpc.account_mismatch'],
    ]);
  });

  it('warns on a foreign currency code but keeps the row', () => {
    const eur = r075({ id: '7', halere: '100', code: '2', date: '150926', currency: '0978' });
    const s = parseGpc([HEAD, eur].join('\n'), { profile: 'gpc_fio' });
    expect(s.txs).toHaveLength(1);
    expect(s.txs[0]?.amount.currency).toBe('CZK');
    expect(s.warnings.map((w) => w.code)).toEqual(['gpc.currency_mismatch']);
  });

  it('returns an empty statement without a header', () => {
    const s = parseGpc(IN);
    expect(s.txs).toEqual([]);
    expect(s.warnings.map((w) => w.code)).toContain('gpc.no_header');
  });
});
