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
