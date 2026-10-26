# 0515: Free pre-check rules (no AI)

Status: todo
Ticket: owner request 2026-10-26 ("checks that cost nothing first, AI last") | Depends on: none | Base commit: 17a44f5 | Branch: claude/project-thread-jrsxk4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add a pure rule function that looks at a document's size, page count and PDF text layer and says "read it with the model" or "skip it": bank statement, government filing, marketing mail, too many pages, too large. Also drop images from bulk (newsletter) e-mails before they become documents. Wiring into the jobs is brief 0516.

## 2. Context

- `packages/extraction/src/scan/scan.ts` exports `DocumentScan { text: string | null; textGood: boolean; qrTexts: readonly string[] }`.
- `packages/extraction/src/index.ts` re-exports modules with `export * from './scan/scan';` lines.
- `apps/worker/src/email-received/triage.ts`: `export function triageAttachments(parts: readonly MailPart[], html: string | null): Candidate[]`, with the check `if (isImage && part.content.length < MIN_IMAGE_BYTES) return;`.
- `apps/worker/src/email-received/handler.ts`: `const headers = email.headers.map((h) => ({ key: h.key, value: h.value }));` and later `const candidates = triageAttachments(parts, email.html ?? null);`.
- Rule 4: tests use synthetic text only.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/precheck/precheck.ts` | new | code in step 1, verbatim |
| `packages/extraction/src/index.ts` | edit | `export * from './precheck/precheck';` after the scan line |
| `packages/extraction/test/precheck.test.ts` | new | test in step 2, verbatim |
| `apps/worker/src/email-received/triage.ts` | edit | `isBulkMail`, `bulk` option |
| `apps/worker/src/email-received/handler.ts` | edit | pass `{ bulk: isBulkMail(headers) }` |
| `apps/worker/test/email-received.test.ts` | edit | two tests (step 4) |

No other file may change.

## 4. Steps

1. Create `packages/extraction/src/precheck/precheck.ts`:

```ts
import type { DocumentScan } from '../scan/scan';

/**
 * Free pre-check (0515): rules that run before any model call. A skipped document costs no tokens.
 * Only clear cases are skipped; anything unsure is read by the model, which also classifies it.
 */
export const PRECHECK_VERSION = 'precheck-1';
/** One document longer than this is not read: invoices are short, statements and reports are long. */
export const PRECHECK_MAX_PAGES = 20;
/** An upload drop longer than this is not sorted by the model; each file is checked on its own. */
export const SPLIT_MAX_PAGES = 40;
export const PRECHECK_MAX_BYTES = 20 * 1024 * 1024;

export type PrecheckReason =
  | 'bank_statement'
  | 'government_filing'
  | 'not_invoice'
  | 'too_many_pages'
  | 'too_large';

export type PrecheckVerdict =
  | { readonly kind: 'read' }
  | {
      readonly kind: 'skip';
      readonly reason: PrecheckReason;
      readonly documentClass: 'bank_statement' | 'government_filing' | 'non_document' | 'unknown';
      readonly status: 'supporting' | 'needs_review';
    };

export interface PrecheckInput {
  readonly byteLength: number;
  /** Pages of this document; null when unknown (an image, or a PDF whose pages cannot be counted). */
  readonly pageCount: number | null;
  readonly scan: DocumentScan;
}

const INVOICE_WORDS = [
  'faktur',
  'danovy doklad',
  'zjednoduseny doklad',
  'pokladni doklad',
  'uctenk',
  'paragon',
  'stvrzenk',
  'dobropis',
  'zalohov',
  'proforma',
  'invoice',
  'receipt',
  'credit note',
  'rechnung',
];
const BANK_WORDS = [
  'vypis z uctu',
  'vypis z bankovniho uctu',
  'bankovni vypis',
  'account statement',
  'bank statement',
  'kontoauszug',
];
const BANK_BALANCES: readonly (readonly [string, string])[] = [
  ['pocatecni zustatek', 'konecny zustatek'],
  ['opening balance', 'closing balance'],
];
const GOVERNMENT_WORDS = [
  'poplatek z pobytu',
  'poplatku z pobytu',
  'hlaseni k mistnimu poplatku',
  'danove priznani',
  'priznani k dani',
  'prehled o prijmech a vydajich',
  'kontrolni hlaseni',
  'souhrnne hlaseni',
  'platebni vymer',
];
const MARKETING_WORDS = [
  'unsubscribe',
  'odhlasit odber',
  'odhlaseni z odberu',
  'newsletter',
  'zobrazit v prohlizeci',
  'view in browser',
  'view this email',
];

const READ: PrecheckVerdict = { kind: 'read' };

function skip(
  reason: PrecheckReason,
  documentClass: Extract<PrecheckVerdict, { kind: 'skip' }>['documentClass'],
  status: 'supporting' | 'needs_review',
): PrecheckVerdict {
  return { kind: 'skip', reason, documentClass, status };
}

/** Lower case, no diacritics, single spaces: "VÝPIS Z ÚČTU" becomes "vypis z uctu". */
export function normalizeForPrecheck(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
}

const hasAny = (text: string, words: readonly string[]): boolean =>
  words.some((w) => text.includes(w));

export function precheckDocument(input: PrecheckInput): PrecheckVerdict {
  if (input.byteLength > PRECHECK_MAX_BYTES) return skip('too_large', 'unknown', 'needs_review');
  if (input.pageCount !== null && input.pageCount > PRECHECK_MAX_PAGES) {
    return skip('too_many_pages', 'unknown', 'needs_review');
  }
  const { text, textGood, qrTexts } = input.scan;
  // A payment QR code is a strong invoice sign; no reliable text layer means only the model can tell.
  if (qrTexts.length > 0 || text === null || !textGood) return READ;
  const t = normalizeForPrecheck(text);
  // Before the invoice words: statement lines often say "faktura 2026001".
  if (hasAny(t, BANK_WORDS) || BANK_BALANCES.some(([a, b]) => t.includes(a) && t.includes(b))) {
    return skip('bank_statement', 'bank_statement', 'supporting');
  }
  if (hasAny(t, INVOICE_WORDS)) return READ;
  if (hasAny(t, GOVERNMENT_WORDS)) return skip('government_filing', 'government_filing', 'supporting');
  if (hasAny(t, MARKETING_WORDS)) return skip('not_invoice', 'non_document', 'supporting');
  return READ;
}
```

2. Create `packages/extraction/test/precheck.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type DocumentScan, PRECHECK_MAX_BYTES, precheckDocument } from '../src/index';

const scan = (text: string | null, qrTexts: string[] = []): DocumentScan => ({
  text,
  textGood: text !== null,
  qrTexts,
});
const check = (text: string | null, more: { pageCount?: number | null; bytes?: number; qr?: string[] } = {}) =>
  precheckDocument({
    byteLength: more.bytes ?? 50_000,
    pageCount: more.pageCount ?? 1,
    scan: scan(text, more.qr),
  });

describe('precheckDocument', () => {
  it('reads an invoice', () => {
    expect(check('FAKTURA - DAŇOVÝ DOKLAD č. 2026001 Celkem 1 210,00 Kč')).toEqual({ kind: 'read' });
  });

  it('skips a bank statement, even when a line says faktura', () => {
    expect(check('VÝPIS Z ÚČTU 1. 9. 2026 - 30. 9. 2026 úhrada faktura 2026001')).toMatchObject({
      kind: 'skip',
      reason: 'bank_statement',
      documentClass: 'bank_statement',
      status: 'supporting',
    });
    expect(check('Počáteční zůstatek 1 000,00 Konečný zůstatek 2 000,00')).toMatchObject({
      reason: 'bank_statement',
    });
  });

  it('skips a local fee report', () => {
    expect(check('Měsíční hlášení k místnímu poplatku z pobytu za období Leden 2026')).toMatchObject({
      kind: 'skip',
      reason: 'government_filing',
      status: 'supporting',
    });
  });

  it('skips a newsletter but reads an invoice e-mail with an unsubscribe line', () => {
    expect(check('Novinky tohoto týdne -50 % Odhlásit odběr')).toMatchObject({
      reason: 'not_invoice',
      documentClass: 'non_document',
    });
    expect(check('Faktura 2026001 je v příloze. Odhlásit odběr')).toEqual({ kind: 'read' });
  });

  it('reads whenever a payment QR code is found', () => {
    expect(check('VÝPIS Z ÚČTU', { qr: ['SPD*1.0*ACC:CZ0000000000000000000000'] })).toEqual({ kind: 'read' });
  });

  it('reads images and scans without a text layer (the model decides)', () => {
    expect(check(null, { pageCount: null })).toEqual({ kind: 'read' });
  });

  it('reads unknown text', () => {
    expect(check('Předávací protokol 12 34 56 78 90')).toEqual({ kind: 'read' });
  });

  it('skips too many pages and too large files', () => {
    expect(check('Faktura', { pageCount: 21 })).toMatchObject({ reason: 'too_many_pages', status: 'needs_review' });
    expect(check('Faktura', { pageCount: 20 })).toEqual({ kind: 'read' });
    expect(check('Faktura', { bytes: PRECHECK_MAX_BYTES + 1 })).toMatchObject({ reason: 'too_large' });
  });
});
```

   Run `pnpm --filter @shoebox/extraction exec vitest run test/precheck.test.ts 2>&1 | tail -30`. Implement until it passes; do not edit the test except formatting (`pnpm exec biome format --write <file>` if the repo uses Biome).

3. `triage.ts`: add and export
   ```ts
   /** A newsletter or other bulk mail (List-Unsubscribe, or Precedence bulk/list): its images are marketing, not receipts. */
   export function isBulkMail(headers: readonly { key: string; value: string }[]): boolean {
     return headers.some((h) => {
       const key = h.key.toLowerCase();
       return key === 'list-unsubscribe' || (key === 'precedence' && /\b(bulk|list)\b/i.test(h.value));
     });
   }
   ```
   Change the signature to `triageAttachments(parts: readonly MailPart[], html: string | null, options: { readonly bulk?: boolean } = {})` and add after the `MIN_IMAGE_BYTES` line: `if (isImage && options.bulk === true) return;` (PDFs and ISDOC of a bulk mail are still kept). In `handler.ts` import `isBulkMail` and call `triageAttachments(parts, email.html ?? null, { bulk: isBulkMail(headers) })`.
4. `email-received.test.ts`, inside `describe('triageAttachments')`, copy the shape of an existing case and add: "drops images of a bulk mail but keeps its PDF" (a 20 000-byte `image/jpeg` and a `application/pdf` part with `{ bulk: true }` → only the PDF), and a `describe('isBulkMail')` with `List-Unsubscribe` → true, `Precedence: bulk` → true, `Subject` only → false.

## 5. Do not touch

`apps/worker/src/doc-extract/**`, `apps/worker/src/doc-split/**`, `packages/pipeline/**`, `packages/db/**`, `apps/web/**`.

## 6. Commands

```
pnpm --filter @shoebox/extraction exec vitest run test/precheck.test.ts 2>&1 | tail -30
pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30
pnpm --filter @shoebox/worker exec vitest run test/email-received.test.ts 2>&1 | tail -30
pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30
```

## 7. Acceptance

- [ ] All four commands pass.

## 8. Stop and ask

As TEMPLATE.md §8.

## 9. Report

Write `docs/tasks/0515-report.md` (600 tokens at most), set `Status: review`, commit on the current branch with message `0515: free pre-check rules and bulk-mail image filter`. Do not push.
