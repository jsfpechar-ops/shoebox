import { describe, expect, it } from 'vitest';
import { detectStatementFormat } from '../src/detect';
import { parseStatement, StatementFormatNeededError } from '../src/parse';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('parseStatement', () => {
  it('dispatches MT940', () => {
    const b = bytes(':20:S\n:25:2400123455/2010\n:60F:C260914CZK0,00\n:61:260915C5,00NTRF//R1\n:62F:C260915CZK5,00\n');
    const s = parseStatement(b, detectStatementFormat(b, 'a.sta'));
    expect(s.format).toBe('mt940');
    expect(s.txs).toHaveLength(1);
  });

  it('dispatches GPC with the given profile', () => {
    const head = `0740000002400123455${'X'.padEnd(20)}140926${'0'.repeat(14)}+${'0'.repeat(14)}+${'0'.repeat(14)}-${'0'.repeat(14)}+001300926${' '.repeat(14)}`;
    const b = bytes(head);
    const s = parseStatement(b, detectStatementFormat(b), { gpcProfile: 'gpc_fio' });
    expect(s.format).toBe('gpc');
    expect(s.profile).toBe('gpc_fio');
  });

  it('asks for a format for CSV and PDF', () => {
    for (const text of ['a;b\n1;2\n', '%PDF-1.7']) {
      const b = bytes(text);
      expect(() => parseStatement(b, detectStatementFormat(b))).toThrow(StatementFormatNeededError);
    }
  });
});
