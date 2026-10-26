import { inflateRawSync, inflateSync } from 'node:zlib';

/** ISDOC 6.x invoice namespace (M01 §4.2, M02 §4.2). */
export const ISDOC_NS = 'http://isdoc.cz/namespace/2013';
/** Largest XML we inflate or decode (M01 §4.2: 10 MiB). */
export const ISDOC_MAX_XML_BYTES = 10 * 1024 * 1024;

export type IsdocContainer = 'xml' | 'isdocx' | 'pdf';

export interface FoundIsdoc {
  readonly xml: string;
  readonly container: IsdocContainer;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });

/** True when the text looks like an ISDOC invoice: an `Invoice` root in the ISDOC namespace. */
export function looksLikeIsdoc(text: string): boolean {
  const head = text.slice(0, 4096);
  return /<(?:[\w.-]+:)?Invoice[\s>]/.test(head) && head.includes(ISDOC_NS);
}

function startsWith(bytes: Uint8Array, ascii: string): boolean {
  if (bytes.length < ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) if (bytes[i] !== ascii.charCodeAt(i)) return false;
  return true;
}

function decodeXml(bytes: Uint8Array): string | null {
  if (bytes.byteLength > ISDOC_MAX_XML_BYTES) return null;
  const text = utf8.decode(bytes);
  return looksLikeIsdoc(text) ? text : null;
}

/**
 * Finds ISDOC data in an uploaded file: a plain `.isdoc`/`.xml` file, an `.isdocx` ZIP, or an
 * ISDOC embedded in a PDF. Returns null when there is none (the caller then reads with the LLM).
 * Never throws on malformed input.
 */
export function findIsdoc(bytes: Uint8Array): FoundIsdoc | null {
  try {
    if (startsWith(bytes, 'PK\u0003\u0004')) {
      const xml = isdocFromZip(bytes);
      return xml === null ? null : { xml, container: 'isdocx' };
    }
    if (startsWith(bytes, '%PDF-')) {
      const xml = isdocFromPdf(bytes);
      return xml === null ? null : { xml, container: 'pdf' };
    }
    const xml = decodeXml(bytes);
    return xml === null ? null : { xml, container: 'xml' };
  } catch {
    return null;
  }
}

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

/** Reads the central directory of a ZIP (no ZIP64, no encryption). */
function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) break;
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if ((flags & 1) === 0) {
      entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function zipRead(bytes: Uint8Array, entry: ZipEntry): Uint8Array | null {
  if (entry.uncompressedSize > ISDOC_MAX_XML_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = entry.localOffset;
  if (p + 30 > bytes.length || view.getUint32(p, true) !== 0x04034b50) return null;
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: ISDOC_MAX_XML_BYTES });
  return null;
}

/** `.isdocx`: the manifest's main document, else the first root-level `*.isdoc`. */
function isdocFromZip(bytes: Uint8Array): string | null {
  const entries = zipEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const manifest = byName.get('manifest.xml');
  const candidates: ZipEntry[] = [];
  if (manifest) {
    const raw = zipRead(bytes, manifest);
    const main = raw
      ? /<(?:[\w.-]+:)?maindocument[^>]*\sfilename\s*=\s*["']([^"']+)["']/.exec(utf8.decode(raw))
      : null;
    const entry = main?.[1] ? byName.get(main[1]) : undefined;
    if (entry) candidates.push(entry);
  }
  for (const e of entries) {
    if (!e.name.includes('/') && /\.isdoc$/i.test(e.name)) candidates.push(e);
  }
  for (const e of candidates) {
    const raw = zipRead(bytes, e);
    const xml = raw ? decodeXml(raw) : null;
    if (xml !== null) return xml;
  }
  return null;
}

const latin1 = new TextDecoder('latin1');

/**
 * Embedded files in a PDF are always stored as their own stream objects (never inside an object
 * stream), so scanning every `stream … endstream` and inflating FlateDecode ones finds an ISDOC
 * attachment without a full PDF parser. Encrypted PDFs yield nothing (the caller falls back).
 */
function isdocFromPdf(bytes: Uint8Array): string | null {
  const text = latin1.decode(bytes);
  if (/\/Encrypt\b/.test(text)) return null;
  const re = /stream\r?\n/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const keyword = m.index;
    // Skip the `stream` inside `endstream`.
    if (text.slice(Math.max(0, keyword - 3), keyword) === 'end') continue;
    const dictStart = text.lastIndexOf('<<', keyword);
    const dict = dictStart < 0 ? '' : text.slice(dictStart, keyword);
    const start = keyword + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    re.lastIndex = end + 9;
    const filters = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1] ?? '';
    const filterNames = filters.match(/\/\w+/g) ?? [];
    let data = bytes.subarray(start, end);
    if (filterNames.length === 1 && filterNames[0] === '/FlateDecode') {
      try {
        data = inflateSync(data, { maxOutputLength: ISDOC_MAX_XML_BYTES, finishFlush: 2 });
      } catch {
        continue;
      }
    } else if (filterNames.length > 0) {
      continue;
    }
    const head = latin1.decode(data.subarray(0, 4096));
    if (!head.includes(ISDOC_NS)) continue;
    const xml = decodeXml(data);
    if (xml !== null) return xml;
  }
  return null;
}
