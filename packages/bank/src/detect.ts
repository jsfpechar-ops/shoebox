import type { StatementFormat } from './types';

export type DetectedFormat = StatementFormat | 'unsupported_pdf';
export type TextEncoding = 'utf-8' | 'windows-1250';
export interface DetectionResult {
  format: DetectedFormat;
  /** 0..1 */
  confidence: number;
  encoding: TextEncoding;
  /** CAMT.053 only: the two-digit version, e.g. '08'. */
  camtVersion?: string;
}
export const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;
export class StatementTooLargeError extends Error {
  readonly code = 'bank.import.too_large';
}

const SAMPLE_CHARS = 65_536;

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

export function detectEncoding(bytes: Uint8Array): TextEncoding {
  if (hasUtf8Bom(bytes)) return 'utf-8';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'windows-1250';
  }
}

/** Decodes the whole file; drops a UTF-8 BOM. */
export function decodeText(bytes: Uint8Array, encoding: TextEncoding): string {
  const body = hasUtf8Bom(bytes) ? bytes.subarray(3) : bytes;
  return new TextDecoder(encoding).decode(body);
}

export function detectStatementFormat(bytes: Uint8Array, filename?: string): DetectionResult {
  if (bytes.length > MAX_STATEMENT_BYTES) {
    throw new StatementTooLargeError('bank.import.too_large');
  }
  const encoding = detectEncoding(bytes);
  const text = decodeText(bytes, encoding).slice(0, SAMPLE_CHARS);

  if (text.startsWith('%PDF')) {
    return { format: 'unsupported_pdf', confidence: 1, encoding };
  }

  const trimmed = text.trimStart();
  if (trimmed.startsWith('<') && (text.includes('camt.053') || text.includes('BkToCstmrStmt'))) {
    const camtVersion = /camt\.053\.001\.(\d{2})/.exec(text)?.[1];
    return camtVersion !== undefined
      ? { format: 'camt053', confidence: 1, encoding, camtVersion }
      : { format: 'camt053', confidence: 1, encoding };
  }

  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  if (
    lines.some((line) => line.startsWith(':20:')) &&
    text.includes(':25:') &&
    text.includes(':61:')
  ) {
    const confidence = filename && /\.sta$/i.test(filename) ? 1 : 0.9;
    return { format: 'mt940', confidence, encoding };
  }

  const first = lines.find((line) => line.trim() !== '');
  if (first?.startsWith('074') && first.length === 128) {
    return { format: 'gpc', confidence: 1, encoding };
  }

  return { format: 'csv_generic', confidence: 0, encoding };
}
