import { describe, expect, it } from 'vitest';
import {
  decodeText,
  detectEncoding,
  detectStatementFormat,
  MAX_STATEMENT_BYTES,
  StatementTooLargeError,
} from '../src/detect';

const bytes = (text: string) => new TextEncoder().encode(text);
const GPC_074 = `074${'0'.repeat(6)}2400123455${'SYSEL TEST'.padEnd(20)}${'0'.repeat(79)}`;

describe('detectEncoding / decodeText', () => {
  it('reads plain ASCII and UTF-8 as utf-8', () => {
    expect(detectEncoding(bytes('hello'))).toBe('utf-8');
    expect(detectEncoding(bytes('Žluťoučký'))).toBe('utf-8');
  });

  it('falls back to windows-1250 and decodes it', () => {
    const cp1250 = new Uint8Array([0x8e, 0x4c, 0x55, 0x9d, 0x4f, 0x55, 0xc8, 0x4b, 0xdd]);
    expect(detectEncoding(cp1250)).toBe('windows-1250');
    expect(decodeText(cp1250, 'windows-1250')).toBe('ŽLUŤOUČKÝ');
  });

  it('drops a UTF-8 BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('074')]);
    expect(detectEncoding(withBom)).toBe('utf-8');
    expect(decodeText(withBom, 'utf-8')).toBe('074');
  });
});

describe('detectStatementFormat', () => {
  it('finds GPC by its 128-char 074 header', () => {
    expect(GPC_074).toHaveLength(128);
    expect(detectStatementFormat(bytes(`\r\n${GPC_074}\r\n`))).toEqual({
      format: 'gpc',
      confidence: 1,
      encoding: 'utf-8',
    });
  });

  it('does not take a short 074 line for GPC', () => {
    expect(detectStatementFormat(bytes('074 short line')).format).toBe('csv_generic');
  });

  it('finds CAMT.053 and its version', () => {
    const xml =
      '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt/></Document>';
    expect(detectStatementFormat(bytes(xml))).toEqual({
      format: 'camt053',
      confidence: 1,
      encoding: 'utf-8',
      camtVersion: '08',
    });
  });

  it('finds MT940, surer with a .sta name', () => {
    const sta =
      ':20:STMT\n:25:2400123455/2010\n:28C:1\n:60F:C260914CZK10000,00\n:61:2609150915C12100,00NTRFNONREF//123\n:62F:C260915CZK22100,00\n';
    expect(detectStatementFormat(bytes(sta), 'vypis.STA').confidence).toBe(1);
    expect(detectStatementFormat(bytes(sta), 'vypis.txt')).toEqual({
      format: 'mt940',
      confidence: 0.9,
      encoding: 'utf-8',
    });
  });

  it('marks a PDF as unsupported', () => {
    expect(detectStatementFormat(bytes('%PDF-1.7\n...')).format).toBe('unsupported_pdf');
  });

  it('leaves anything else to the CSV wizard', () => {
    expect(detectStatementFormat(bytes('a;b;c\n1;2;3\n'))).toEqual({
      format: 'csv_generic',
      confidence: 0,
      encoding: 'utf-8',
    });
  });

  it('rejects files over 10 MB', () => {
    expect(() => detectStatementFormat(new Uint8Array(MAX_STATEMENT_BYTES + 1))).toThrow(
      StatementTooLargeError,
    );
  });
});
