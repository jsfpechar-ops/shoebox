# 0201: QR payment and invoice payload parser

Status: review
Ticket: P1-EXT-02 (QR part) | Depends on: none | Base commit: 496b1e9 | Branch: task/0201-qr-parser | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0201-report.md

## 1. Objective

A pure parser for the text inside Czech payment QR codes (QR Platba `SPD*`, QR Faktura `SID*`, and `X-INV` inside a QR Platba). Exact data from the QR lets the app check the amount, account and variable symbol without trusting the AI.

## 2. Context

M02 §4.3 (pasted): split on `*`; header + version; `KEY:VALUE` pairs; URL-decode values (`%2A` → `*`). If `CRC32` is present, recompute it over the header plus every attribute except CRC32, sorted, joined with `*`, as uppercase hex (8 chars); mismatch → discard the payload. Amounts use a dot decimal. Dates are `YYYYMMDD`. EPC (`BCD`) stays disabled. Anything else (URLs, loyalty codes) is ignored.

SPAYD keys: `ACC` (`IBAN` or `IBAN+BIC`), `AM`, `CC`, `DT` (due date), `X-VS`, `X-KS`, `X-SS`, `RN` (payee name), `MSG`, `X-INV` (a SID payload, URL-encoded).
SID keys: `ID` (invoice number), `DD` (issue date), `AM`, `CC`, `TD` (0 not a tax document, 1 credit note, 2 advance tax document, 9 tax document), `VS`, `VII`/`INI` (supplier DIČ/IČO), `VIR`/`INR` (buyer DIČ/IČO), `DUZP`, `DT`, `TB0`/`T0` (base/VAT at the standard rate), `TB1`/`T1` (first reduced), `TB2`/`T2` (second reduced), `NTB` (not taxed), `ACC`.

`crc32` is in `node:zlib` (Node 22). No new dependency.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/qr/payload.ts` | new | the parser |
| `packages/extraction/test/qr-payload.test.ts` | new | tests below, verbatim |
| `packages/extraction/src/index.ts` | edit | add `export * from './qr/payload';` |

No other file may change.

## 4. Steps

1. Create `packages/extraction/src/qr/payload.ts` with exactly these exports:

```ts
export type QrVatSlot = 'standard' | 'reduced1' | 'reduced2' | 'none';
export interface QrVatRow { readonly slot: QrVatSlot; readonly base: string; readonly vat: string }
export interface QrInvoice {
  readonly kind: 'sid';
  readonly number: string | null;
  readonly issue_date: string | null; // ISO YYYY-MM-DD
  readonly duzp: string | null;
  readonly due_date: string | null;
  readonly amount: string | null;     // "1210.00": always 2 decimals
  readonly currency: string | null;   // 3 uppercase letters
  readonly variable_symbol: string | null;
  readonly supplier_ico: string | null;
  readonly supplier_dic: string | null;
  readonly buyer_ico: string | null;
  readonly buyer_dic: string | null;
  readonly tax_doc_type: '0' | '1' | '2' | '9' | null;
  readonly iban: string | null;
  readonly vat_rows: readonly QrVatRow[]; // order: standard, reduced1, reduced2, none; a row only when its base is present (none: NTB, vat "0.00")
}
export interface QrPayment {
  readonly kind: 'spayd';
  readonly iban: string | null;
  readonly bic: string | null;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly due_date: string | null;
  readonly variable_symbol: string | null;
  readonly constant_symbol: string | null;
  readonly specific_symbol: string | null;
  readonly payee_name: string | null;
  readonly message: string | null;
  readonly invoice: QrInvoice | null; // from X-INV; null when absent or invalid
}
export type QrParseResult =
  | { readonly ok: true; readonly value: QrPayment | QrInvoice }
  | { readonly ok: false; readonly reason: 'not_payment_qr' | 'bad_header' | 'crc_invalid' };
export function parseQrPayload(text: string): QrParseResult;
```

Rules: trim the text and drop one trailing `*`. Header must be `SPD*<n.n>` or `SID*<n.n>`, else `not_payment_qr` when the prefix is neither, `bad_header` when the version is missing. An attribute without `:` is skipped. Keys are case-sensitive. An invalid single value (amount not `^\d+(\.\d{1,2})?$`, date not a real `YYYYMMDD` calendar date, currency not `^[A-Z]{3}$`, IČO not 8 digits, VS/KS/SS not 1-10 digits) becomes `null`; it does not fail the payload. IBAN: uppercase, spaces removed. DIČ: uppercase, spaces removed. CRC is checked on the raw (not URL-decoded) attribute strings. `X-INV` is URL-decoded first, then parsed as SID; if that fails, `invoice` is null.
   Run `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30` → no errors.

2. Create `packages/extraction/test/qr-payload.test.ts`, verbatim:

```ts
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
    const p = payment('SPD*1.0*ACC:CZ65 0800 0000 1920 0014 5399+GIBACZPX*AM:99.5*X-KS:0308*RN:ACME*');
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
    const inv = 'SID%2A1.0%2AID:2026001%2ADD:20260912%2AAM:1210.00%2AINI:25596641%2AVII:CZ25596641%2AINR:00006947%2ATB0:1000.00%2AT0:210.00';
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
```

   Implement until these tests pass; do not edit the test file. Run `pnpm --filter @shoebox/extraction test -- qr-payload 2>&1 | tail -30` → all pass.

3. Add the export line to `packages/extraction/src/index.ts`. Run `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30` and `pnpm exec biome check packages/extraction 2>&1 | tail -30` → clean (run `pnpm exec biome format --write packages/extraction` if only formatting fails).

## 5. Do not touch

Everything outside §3. Hard rules 4 (synthetic data only) and 7 (no new dependency).

## 6. Commands

As in steps 1–3.

## 7. Acceptance

- [ ] `qr-payload` tests pass, typecheck and biome clean.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0201-report.md`, 200 tokens at most: files, last line of each command, deviations. Set `Status: review`.

## Risk list (for the reviewer)

`payload.ts` amount normalization and CRC.
