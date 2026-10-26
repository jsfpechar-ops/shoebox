import { describe, expect, it } from 'vitest';
import { parseQrPayload, type QrInvoice, type QrPayment } from '../src/index';

// Synthetic values only (hard rule 4).
const SPAYD =
  'SPD*1.0*ACC:CZ6508000000192000145399*AM:1210.00*CC:CZK*DT:20260926*X-VS:2026001*MSG:FAKTURA 2026001*CRC32:DF2F8539';

function payment(text: string): QrPayment {
  const r = parseQrPayload(text);
  if (!r.ok || r.value.kind !== 'spayd') throw new Error(`not spayd: ${JSON.stringify(r)}`);
  return r.value;
}

describe('parseQrPayload: SPAYD', () => {
  it('reads a QR Platba with a valid CRC', () => {
    const p = payment(SPAYD);
    expect(p.iban).toBe('CZ6508000000192000145399');
    expect(p.amount).toBe('1210.00');
    expect(p.currency).toBe('CZK');
    expect(p.due_date).toBe('2026-09-26');
    expect(p.variable_symbol).toBe('2026001');
    expect(p.message).toBe('FAKTURA 2026001');
    expect(p.invoice).toBeNull();
  });

  it('rejects a wrong CRC', () => {
    expect(parseQrPayload(SPAYD.replace('AM:1210.00', 'AM:1250.00'))).toEqual({
      ok: false,
      reason: 'crc_invalid',
    });
  });

  it('works without CRC, normalizes the amount and splits IBAN+BIC', () => {
    const p = payment(
      'SPD*1.0*ACC:CZ65 0800 0000 1920 0014 5399+GIBACZPX*AM:99.5*X-KS:0308*RN:ACME*',
    );
    expect(p.iban).toBe('CZ6508000000192000145399');
    expect(p.bic).toBe('GIBACZPX');
    expect(p.amount).toBe('99.50');
    expect(p.constant_symbol).toBe('0308');
    expect(p.payee_name).toBe('ACME');
    expect(p.currency).toBeNull();
  });

  it('turns invalid single values into null', () => {
    const p = payment('SPD*1.0*AM:12,50*DT:20260231*CC:czk*X-VS:12345678901');
    expect(p.amount).toBeNull();
    expect(p.due_date).toBeNull();
    expect(p.currency).toBeNull();
    expect(p.variable_symbol).toBeNull();
  });

  it('URL-decodes values', () => {
    expect(payment('SPD*1.0*MSG:A%2AB').message).toBe('A*B');
  });

  it('reads X-INV as an invoice', () => {
    const inv =
      'SID%2A1.0%2AID:2026001%2ADD:20260912%2AAM:1210.00%2AINI:25596641%2AVII:CZ25596641%2AINR:00006947%2ATB0:1000.00%2AT0:210.00';
    const p = payment(`SPD*1.0*AM:1210.00*X-INV:${inv}`);
    expect(p.invoice?.number).toBe('2026001');
    expect(p.invoice?.supplier_ico).toBe('25596641');
    expect(p.invoice?.vat_rows).toEqual([{ slot: 'standard', base: '1000.00', vat: '210.00' }]);
  });
});

describe('parseQrPayload: SID', () => {
  it('reads a QR Faktura with all VAT slots', () => {
    const r = parseQrPayload(
      'SID*1.0*ID:FV-7*DD:20260912*DUZP:20260910*DT:20260926*AM:1386.00*CC:CZK*TD:9*VS:7*INI:25596641*VII:CZ25596641*INR:00006947*VIR:CZ00006947*TB0:1000*T0:210*TB1:100*T1:12*NTB:64*ACC:CZ6508000000192000145399',
    );
    expect(r.ok).toBe(true);
    const v = (r as { value: QrInvoice }).value;
    expect(v.kind).toBe('sid');
    expect(v.issue_date).toBe('2026-09-12');
    expect(v.duzp).toBe('2026-09-10');
    expect(v.due_date).toBe('2026-09-26');
    expect(v.tax_doc_type).toBe('9');
    expect(v.buyer_ico).toBe('00006947');
    expect(v.buyer_dic).toBe('CZ00006947');
    expect(v.vat_rows).toEqual([
      { slot: 'standard', base: '1000.00', vat: '210.00' },
      { slot: 'reduced1', base: '100.00', vat: '12.00' },
      { slot: 'none', base: '64.00', vat: '0.00' },
    ]);
    expect(v.iban).toBe('CZ6508000000192000145399');
  });

  it('drops a TB row that has no T value', () => {
    const r = parseQrPayload('SID*1.0*TB0:100');
    expect(r.ok && r.value.kind === 'sid' && r.value.vat_rows).toEqual([]);
  });
});

describe('parseQrPayload: not a payment code', () => {
  it.each([
    ['https://example.cz/x', 'not_payment_qr'],
    ['BCD\n002\n1\nSCT', 'not_payment_qr'],
    ['SPD*AM:10', 'bad_header'],
    ['', 'not_payment_qr'],
  ])('%s → %s', (text, reason) => {
    expect(parseQrPayload(text)).toEqual({ ok: false, reason });
  });
});
