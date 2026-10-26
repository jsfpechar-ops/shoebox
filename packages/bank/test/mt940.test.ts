import { describe, expect, it } from 'vitest';
import { parseMt940 } from '../src/parsers/mt940';

const STA = [
  ':20:STMT7',
  ':25:2400123455/2010',
  ':28C:7',
  ':60F:C260914CZK10000,00',
  ':61:2609150915C12100,00NTRF12345678//12345678',
  ':86:?20/VS/2026001/KS/0308?32ODBERATEL SRO',
  '?31CZ4608000010031234567899',
  ':61:2609160916D1210,50NMSC//12345679',
  ':86:NAKUP: KAVARNA PRAHA',
  ':61:2609170917RD100,00NTRF//12345680',
  ':61:nonsense',
  ':62F:C260930CZK20989,50',
].join('\r\n');

describe('parseMt940', () => {
  const s = parseMt940(STA);

  it('reads header and balances', () => {
    expect(s.format).toBe('mt940');
    expect(s.statementNumber).toBe('7');
    expect(s.account).toEqual({
      account: '2400123455',
      bankCode: '2010',
      iban: 'CZ8720100000002400123455',
      currency: 'CZK',
    });
    expect(s.periodFrom).toBe('2026-09-14');
    expect(s.periodTo).toBe('2026-09-30');
    expect(s.openingBalance?.toString()).toBe('10000');
    expect(s.closingBalance?.toString()).toBe('20989.5');
    expect(s.balanceCheck).toBe('ok');
  });

  it('reads the same transactions as the GPC file of the period', () => {
    expect(s.txs.map((t) => t.amount.toString())).toEqual(['12100', '-1210.5', '100']);
    expect(s.txs.map((t) => t.externalId)).toEqual([
      'mt940:12345678',
      'mt940:12345679',
      'mt940:12345680',
    ]);
    const [inc, out, storno] = s.txs;
    expect(inc?.bookedOn).toBe('2026-09-15');
    expect(inc?.vs).toBe('2026001');
    expect(inc?.ks).toBe('308');
    expect(inc?.counterparty).toEqual({
      account: '1003-1234567899',
      bankCode: '0800',
      iban: 'CZ4608000010031234567899',
      name: 'ODBERATEL SRO',
    });
    expect(out?.message).toBe('NAKUP: KAVARNA PRAHA');
    expect(storno?.isReversal).toBe(true);
  });

  it('warns on a bad :61: line', () => {
    expect(s.warnings.map((w) => [w.line, w.code])).toEqual([[11, 'mt940.bad_line']]);
  });

  it('rolls the entry date over the year end', () => {
    const y = parseMt940(
      [
        ':25:2400123455/2010',
        ':60F:C261231CZK0,00',
        ':61:2612310102C5,00NTRF//X1',
        ':62F:C270102CZK5,00',
      ].join('\n'),
    );
    expect(y.txs[0]?.valueDate).toBe('2026-12-31');
    expect(y.txs[0]?.bookedOn).toBe('2027-01-02');
  });
});
