# 0207: Use QR and PDF text to correct the AI reading

Status: todo
Ticket: P1-EXT-04 (merge, proto subset) | Depends on: 0201, 0203, 0205, 0206 | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0207-report.md

## 1. Objective

Before saving a reading, the worker scans the file (0205), and exact data wins over the AI: the payment QR sets the IBAN, variable symbol and the amount to check against the total; a good PDF text layer replaces a misread supplier IČO or DIČ. Each replaced field is stored with its real source (`qr`, `pdf_text`), and the QR amount is checked by the math gate (0203, blocking on mismatch).

## 2. Context

Precedence (M02 §4.7.2): ISDOC > QR > PDF text > LLM; `user` always wins (corrections re-run checks from `document_fields`, so the stored `qr.amount` field keeps the QR check alive after edits). `field_source` enum already has `'qr'` and `'pdf_text'`.

Available: `scanDocument(bytes, mediaType): Promise<DocumentScan>` and `parseQrPayload(text)` and `findIdentifiers(text, org)` from `@shoebox/extraction`; `icoChecksumValid`, `czDicValid`, `ibanValid` from `@shoebox/validation`. `ProtoExtraction` is in `packages/extraction/src/proto/schema.ts` (readonly fields; build a new object, never mutate).

Excerpts (verbatim):
- `packages/db/src/document-reading.ts`: `  readonly fields: readonly { fieldKey: string; valueText: string; source: 'llm' | 'isdoc' }[];`
- `apps/worker/src/doc-extract/rows.ts`: `  readonly source: 'llm' | 'isdoc';` (in `FieldRow`)
- `apps/worker/src/doc-extract/handler.ts`: `      const checks = runProtoChecks(extraction, org === undefined ? { today } : { today, org });` and `        fields: fieldsOf(extraction, source),` and `  readonly store?: ReadingStore; // default dbReadingStore`

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/exact/apply.ts` | new | `applyExactData` |
| `packages/extraction/test/exact-apply.test.ts` | new | tests below, verbatim |
| `packages/extraction/src/index.ts` | edit | export |
| `packages/db/src/document-reading.ts` | edit | widen field source union |
| `apps/worker/src/doc-extract/rows.ts` | edit | widen `FieldRow.source` |
| `apps/worker/src/doc-extract/handler.ts` | edit | scan, apply, checks, fields |
| `apps/worker/test/doc-extract-handler.test.ts` | edit | add 2 tests (step 4) |

## 4. Steps

1. `apply.ts`:

```ts
export type ExactSource = 'qr' | 'pdf_text';
export interface ExactDataResult {
  readonly extraction: ProtoExtraction;
  /** field key (M02 grammar, e.g. 'supplier.ico') → source, for every value set from exact data. */
  readonly sources: Readonly<Record<string, ExactSource>>;
  /** QR amount (2 decimals) to check against the total; null when no QR or QRs disagree. */
  readonly qrAmount: string | null;
}
export function applyExactData(
  x: ProtoExtraction,
  scan: DocumentScan,
  org: { readonly ico: string | null; readonly dic: string | null },
  options?: { readonly keepIdentifiers?: boolean }, // true for ISDOC readings: only qrAmount is computed
): ExactDataResult;
```
   Rules, in order:
   - QR: parse every `scan.qrTexts`; payments = ok `spayd` results; invoices = ok `sid` results plus every payment's `invoice`. Distinct non-null payment amounts: exactly one → `qrAmount`, else null (also null with no payment; then a lone SID `amount` may be used).
   - From the first payment: `payment.iban` ← its iban when `ibanValid`; `document.variable_symbol` ← its VS when non-null; `dates.due_date` ← its due date only when `x` has none. Source `qr`.
   - From the first invoice: `supplier.ico` ← INI when `icoChecksumValid` and ≠ org IČO; `supplier.dic` ← VII when `czDicValid` and ≠ org DIČ; `document.number` ← ID only when `x` has none. Source `qr`.
   - Text, only when `scan.textGood && scan.text !== null`: `ids = findIdentifiers(scan.text, org)`. `supplier.ico` (unless set from QR) ← `ids.supplierIco` when non-null and (`x.supplier.ico` is null, fails `icoChecksumValid`, or is not in `ids.icos`). Same for `supplier.dic` with `ids.supplierDic`/`ids.dics`/`czDicValid`. `document.variable_symbol` (unless from QR) ← the only `ids.variableSymbols` value when `x` has none. `payment.iban` (unless from QR) ← the only `ids.ibans` value when `x` has none. Source `pdf_text`.
   - A value equal to what `x` already has is not recorded in `sources`.
   - `keepIdentifiers: true` → return `x` unchanged with empty `sources`, only `qrAmount`.

2. Test file `packages/extraction/test/exact-apply.test.ts`, verbatim:

```ts
import { describe, expect, it } from 'vitest';
import { applyExactData, type DocumentScan, type ProtoExtraction } from '../src/index';

// Synthetic values only (hard rule 4).
const ORG = { ico: '00006947', dic: 'CZ00006947' };
const NO_SCAN: DocumentScan = { text: null, textGood: false, qrTexts: [] };

function x(over: { ico?: string | null; dic?: string | null; vs?: string | null; iban?: string | null } = {}): ProtoExtraction {
  return {
    schema_version: 'm02-proto-v3',
    kind_hint: 'invoice',
    document_class: 'received_invoice',
    supplier: { name: 'Test s.r.o.', ico: over.ico === undefined ? '25596641' : over.ico, dic: over.dic === undefined ? 'CZ25596641' : over.dic, vat_id: null, country: 'CZ' },
    buyer: { name: null, ico: '00006947', dic: 'CZ00006947' },
    document: { number: '2026001', variable_symbol: over.vs === undefined ? null : over.vs },
    dates: { issue_date: '2026-09-12', duzp: '2026-09-12', due_date: null },
    currency: 'CZK',
    vat_recap: [{ rate_pct: '21', base: '1000.00', vat: '210.00' }],
    totals: { net: '1000.00', vat: '210.00', gross: '1210.00' },
    payment: { account_number: null, bank_code: null, iban: over.iban === undefined ? null : over.iban, method: 'bank_transfer' },
    flags: { not_tax_document_text: false, non_vat_payer_text: false, reverse_charge_text: false, paid_text: false },
    not_tax_document: false,
    issues: [],
  } as ProtoExtraction;
}

const QR = 'SPD*1.0*ACC:CZ6508000000192000145399*AM:1210.00*CC:CZK*DT:20260926*X-VS:2026001';

describe('applyExactData', () => {
  it('does nothing without exact data', () => {
    const r = applyExactData(x(), NO_SCAN, ORG);
    expect(r.extraction).toEqual(x());
    expect(r.sources).toEqual({});
    expect(r.qrAmount).toBeNull();
  });

  it('takes IBAN, VS, due date and amount from the payment QR', () => {
    const r = applyExactData(x(), { ...NO_SCAN, qrTexts: [QR] }, ORG);
    expect(r.extraction.payment.iban).toBe('CZ6508000000192000145399');
    expect(r.extraction.document.variable_symbol).toBe('2026001');
    expect(r.extraction.dates.due_date).toBe('2026-09-26');
    expect(r.qrAmount).toBe('1210.00');
    expect(r.sources).toEqual({ 'payment.iban': 'qr', 'document.variable_symbol': 'qr', 'dates.due_date': 'qr' });
  });

  it('ignores QR amounts that disagree', () => {
    const other = QR.replace('AM:1210.00', 'AM:99.00');
    expect(applyExactData(x(), { ...NO_SCAN, qrTexts: [QR, other] }, ORG).qrAmount).toBeNull();
  });

  it('fixes a misread IČO and DIČ from a good text layer', () => {
    const scan: DocumentScan = { text: 'Dodavatel IČ: 25596641 DIČ: CZ25596641\nOdběratel IČ: 00006947', textGood: true, qrTexts: [] };
    const r = applyExactData(x({ ico: '25596614', dic: 'CZ25596614' }), scan, ORG);
    expect(r.extraction.supplier.ico).toBe('25596641');
    expect(r.extraction.supplier.dic).toBe('CZ25596641');
    expect(r.sources).toEqual({ 'supplier.ico': 'pdf_text', 'supplier.dic': 'pdf_text' });
  });

  it('does not trust a text layer that is not good', () => {
    const scan: DocumentScan = { text: 'IČ: 25596641', textGood: false, qrTexts: [] };
    expect(applyExactData(x({ ico: '25596614' }), scan, ORG).extraction.supplier.ico).toBe('25596614');
  });

  it('keeps ISDOC identifiers and only reads the QR amount', () => {
    const r = applyExactData(x({ ico: '25596614' }), { text: 'IČ: 25596641', textGood: true, qrTexts: [QR] }, ORG, { keepIdentifiers: true });
    expect(r.extraction.supplier.ico).toBe('25596614');
    expect(r.sources).toEqual({});
    expect(r.qrAmount).toBe('1210.00');
  });
});
```

   Implement until it passes; do not edit the test file (biome formatting allowed).

3. Wiring:
   - `document-reading.ts` and `rows.ts`: source union becomes `'llm' | 'isdoc' | 'qr' | 'pdf_text'`.
   - `handler.ts`: add `readonly scan?: (bytes: Uint8Array, mediaType: string) => Promise<DocumentScan>; // default scanDocument` to `DocExtractDeps`. After the bytes are loaded and before Step 1, when the type is PDF or an image (`modelType !== null`): `scan = await (deps.scan ?? scanDocument)(bytes, mediaType)` inside try/catch (a throw → `{ text: null, textGood: false, qrTexts: [] }`); other types use that empty scan. In `toWrite`: `const exact = applyExactData(extraction, scan, { ico: doc.orgIco, dic: doc.orgDic }, { keepIdentifiers: source === 'isdoc' })`, then use `exact.extraction` everywhere `extraction` was used; checks get `{ ...exact.extraction, qr: { amount: exact.qrAmount } }`; fields = `fieldsOf(exact.extraction, source)` mapped so a row whose key is in `exact.sources` takes that source, plus a row `{ fieldKey: 'qr.amount', valueText: exact.qrAmount, source: 'qr' }` when `qrAmount` is non-null.
4. `doc-extract-handler.test.ts`: copy the shape of the first existing test and add (a) with `scan: async () => ({ text: null, textGood: false, qrTexts: ['SPD*1.0*AM:999.00'] })` and the default `wire()` reading: the saved write has `status: 'needs_review'`, a validation `ruleId: 'PROTO_QR_AMOUNT'` `severity: 'blocking'`, and a field `qr.amount` = `999.00` with source `qr`; (b) with `scan: async () => { throw new Error('x'); }`: the document still saves as before. Pass `scan` into every existing `createDocExtractHandler` call? No: only the new tests; existing tests use the default and must still pass.

## 5. Do not touch

Everything outside §3. Hard rule 1 (Money/strings only), hard rule 4 (never log scan text).

## 6. Commands

```
pnpm --filter @shoebox/extraction test 2>&1 | tail -30
pnpm --filter @shoebox/worker test -- doc-extract 2>&1 | tail -30
pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30
pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30
pnpm --filter @shoebox/web typecheck 2>&1 | tail -30
pnpm exec biome check --write packages/extraction packages/db apps/worker 2>&1 | tail -30
```

## 7. Acceptance

- [ ] §6 passes.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0207-report.md`, 200 tokens at most. Set `Status: review`.

## Risk list (for the reviewer)

`apply.ts` precedence; `handler.ts` (what is saved).
