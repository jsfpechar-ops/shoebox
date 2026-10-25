# 0075: Read ISDOC data without AI (reader in @shoebox/extraction)

Status: done
Ticket: P1-EXT-02 (trimmed: ISDOC only, for the Phase 1 core loop) | Depends on: none | Base commit: 1e90c0d (phase/0) | Branch: claude/project-thread-3666oz | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add a deterministic ISDOC reader: it finds ISDOC data in a plain `.isdoc`/`.xml` file, an `.isdocx` ZIP or a PDF attachment, and maps it into the same `ProtoExtraction` shape the Haiku reader returns. The worker (0076) uses it, so ISDOC invoices are read exactly, at no cost and with no misread IČO.

## 2. Context

- M02 §4 source order (ADR-006): ISDOC → QR → PDF text → LLM. "Use the cheapest *exact* source first and the LLM only for what remains." Stage A = ISDOC 6.0.2 from PDF attachments, standalone `.isdoc`, `.isdocx` (manifest `maindocument`, else the root-level `*.isdoc`).
- M02 §4.2 mapping, the rows used here: `ID` → document number; `IssueDate`; `TaxPointDate` → DUZP (absent → stays empty, **never** copied from the issue date); `VATApplicable` false → not a tax document; `ForeignCurrencyCode` present → currency and the `…Curr` amounts; `AccountingSupplierParty/Party/PartyIdentification/ID` → IČO if 8 digits and CZ; `PartyTaxScheme/CompanyID` → DIČ if `CZ…`, else foreign VAT ID; `TaxTotal/TaxSubTotal` → VAT recap; `LegalMonetaryTotal/TaxExclusiveAmount`, `TaxInclusiveAmount`; `PaymentMeansCode` 10 cash, 31/42/49 transfer, 48 card, 50 COD, other → other; `Details/{PaymentDueDate,ID,BankCode,IBAN,VariableSymbol}`; `PaidAmount` **never** marks the document paid.
- DocumentType: 1 invoice, 2/3/6 credit note, 4 proforma, 5 advance tax document, 7 simplified receipt.
- M12 V5.5: XML parsed with external entities and DTDs disabled; size cap 10 MiB. The reader refuses any `<!DOCTYPE` or `<!ENTITY`.
- Hard rule 7: no new dependency. ZIP and PDF streams use `node:zlib` (built in); the XML reader is a small strict parser in `src/isdoc/xml.ts` (no `fast-xml-parser`, `fflate` or `pdfjs-dist`).
- Hard rule 4: test fixtures are synthetic and built inside the test (IČO 12345679 / 11111119 are made up).
- Out of scope: Factur-X/ZUGFeRD and UBL (M02 §2: left to the LLM), XSD validation with `xmllint`, invoice lines.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/isdoc/xml.ts` | create | strict XML reader (`parseXml`, `XmlError`, `at`, `textAt`, `child`, `childrenNamed`) |
| `packages/extraction/src/isdoc/find.ts` | create | `findIsdoc(bytes)`: plain XML, `.isdocx`, PDF attachment |
| `packages/extraction/src/isdoc/map.ts` | create | `isdocToWire`, `readIsdoc`, `IsdocError`, `ISDOC_READER_VERSION` |
| `packages/extraction/src/index.ts` | edit | export the three modules |
| `packages/extraction/test/isdoc.test.ts` | create | 18 tests |

No other file may change. The whole change is the patch in §4; the orchestrator wrote it and checked that it applies to `phase/0` and passes §6.

## 4. Steps

1. Set `Status: in-progress` in this file. Apply the patch at the end of this section straight from this file (do not retype it):

```bash
awk '/^```diff$/{f=1;next} /^```$/{if(f)exit} f' docs/tasks/0075-isdoc-reader.md | git apply --whitespace=nowarn 2>&1 | tail -30
git status --short 2>&1 | tail -30
```

Expected: no output from `git apply`; `git status` lists exactly the §3 files and this brief. If `git apply` fails: STOP (§8), do not hand-edit.

2. Run the §6 commands in order; the expected results are given there. Commit `0075 step 2` (the patch plus this file).
3. Write the report (§9), set `Status: review`, commit `0075 report`. Do not push; the orchestrator pushes and opens the PR.

```diff
diff --git a/packages/extraction/src/index.ts b/packages/extraction/src/index.ts
index 63a949d..1289b4c 100644
--- a/packages/extraction/src/index.ts
+++ b/packages/extraction/src/index.ts
@@ -1,4 +1,7 @@
 export const packageName = '@shoebox/extraction' as const;
+export * from './isdoc/find';
+export * from './isdoc/map';
+export * from './isdoc/xml';
 export * from './llm/anthropic';
 export * from './llm/client';
 export * from './llm/gemini';
diff --git a/packages/extraction/src/isdoc/find.ts b/packages/extraction/src/isdoc/find.ts
new file mode 100644
index 0000000..b0f54a2
--- /dev/null
+++ b/packages/extraction/src/isdoc/find.ts
@@ -0,0 +1,174 @@
+import { inflateRawSync, inflateSync } from 'node:zlib';
+
+/** ISDOC 6.x invoice namespace (M01 §4.2, M02 §4.2). */
+export const ISDOC_NS = 'http://isdoc.cz/namespace/2013';
+/** Largest XML we inflate or decode (M01 §4.2: 10 MiB). */
+export const ISDOC_MAX_XML_BYTES = 10 * 1024 * 1024;
+
+export type IsdocContainer = 'xml' | 'isdocx' | 'pdf';
+
+export interface FoundIsdoc {
+  readonly xml: string;
+  readonly container: IsdocContainer;
+}
+
+const utf8 = new TextDecoder('utf-8', { fatal: false });
+
+/** True when the text looks like an ISDOC invoice: an `Invoice` root in the ISDOC namespace. */
+export function looksLikeIsdoc(text: string): boolean {
+  const head = text.slice(0, 4096);
+  return /<(?:[\w.-]+:)?Invoice[\s>]/.test(head) && head.includes(ISDOC_NS);
+}
+
+function startsWith(bytes: Uint8Array, ascii: string): boolean {
+  if (bytes.length < ascii.length) return false;
+  for (let i = 0; i < ascii.length; i++) if (bytes[i] !== ascii.charCodeAt(i)) return false;
+  return true;
+}
+
+function decodeXml(bytes: Uint8Array): string | null {
+  if (bytes.byteLength > ISDOC_MAX_XML_BYTES) return null;
+  const text = utf8.decode(bytes);
+  return looksLikeIsdoc(text) ? text : null;
+}
+
+/**
+ * Finds ISDOC data in an uploaded file: a plain `.isdoc`/`.xml` file, an `.isdocx` ZIP, or an
+ * ISDOC embedded in a PDF. Returns null when there is none (the caller then reads with the LLM).
+ * Never throws on malformed input.
+ */
+export function findIsdoc(bytes: Uint8Array): FoundIsdoc | null {
+  try {
+    if (startsWith(bytes, 'PK\u0003\u0004')) {
+      const xml = isdocFromZip(bytes);
+      return xml === null ? null : { xml, container: 'isdocx' };
+    }
+    if (startsWith(bytes, '%PDF-')) {
+      const xml = isdocFromPdf(bytes);
+      return xml === null ? null : { xml, container: 'pdf' };
+    }
+    const xml = decodeXml(bytes);
+    return xml === null ? null : { xml, container: 'xml' };
+  } catch {
+    return null;
+  }
+}
+
+interface ZipEntry {
+  readonly name: string;
+  readonly method: number;
+  readonly compressedSize: number;
+  readonly uncompressedSize: number;
+  readonly localOffset: number;
+}
+
+/** Reads the central directory of a ZIP (no ZIP64, no encryption). */
+function zipEntries(bytes: Uint8Array): ZipEntry[] {
+  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
+  let eocd = -1;
+  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
+    if (view.getUint32(i, true) === 0x06054b50) {
+      eocd = i;
+      break;
+    }
+  }
+  if (eocd < 0) return [];
+  const count = view.getUint16(eocd + 10, true);
+  let p = view.getUint32(eocd + 16, true);
+  const entries: ZipEntry[] = [];
+  for (let n = 0; n < count; n++) {
+    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) break;
+    const flags = view.getUint16(p + 8, true);
+    const method = view.getUint16(p + 10, true);
+    const compressedSize = view.getUint32(p + 20, true);
+    const uncompressedSize = view.getUint32(p + 24, true);
+    const nameLen = view.getUint16(p + 28, true);
+    const extraLen = view.getUint16(p + 30, true);
+    const commentLen = view.getUint16(p + 32, true);
+    const localOffset = view.getUint32(p + 42, true);
+    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
+    if ((flags & 1) === 0) {
+      entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
+    }
+    p += 46 + nameLen + extraLen + commentLen;
+  }
+  return entries;
+}
+
+function zipRead(bytes: Uint8Array, entry: ZipEntry): Uint8Array | null {
+  if (entry.uncompressedSize > ISDOC_MAX_XML_BYTES) return null;
+  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
+  const p = entry.localOffset;
+  if (p + 30 > bytes.length || view.getUint32(p, true) !== 0x04034b50) return null;
+  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
+  const data = bytes.subarray(start, start + entry.compressedSize);
+  if (entry.method === 0) return data;
+  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: ISDOC_MAX_XML_BYTES });
+  return null;
+}
+
+/** `.isdocx`: the manifest's main document, else the first root-level `*.isdoc`. */
+function isdocFromZip(bytes: Uint8Array): string | null {
+  const entries = zipEntries(bytes);
+  const byName = new Map(entries.map((e) => [e.name, e]));
+  const manifest = byName.get('manifest.xml');
+  const candidates: ZipEntry[] = [];
+  if (manifest) {
+    const raw = zipRead(bytes, manifest);
+    const main = raw
+      ? /<(?:[\w.-]+:)?maindocument[^>]*\sfilename\s*=\s*["']([^"']+)["']/.exec(utf8.decode(raw))
+      : null;
+    const entry = main?.[1] ? byName.get(main[1]) : undefined;
+    if (entry) candidates.push(entry);
+  }
+  for (const e of entries) {
+    if (!e.name.includes('/') && /\.isdoc$/i.test(e.name)) candidates.push(e);
+  }
+  for (const e of candidates) {
+    const raw = zipRead(bytes, e);
+    const xml = raw ? decodeXml(raw) : null;
+    if (xml !== null) return xml;
+  }
+  return null;
+}
+
+const latin1 = new TextDecoder('latin1');
+
+/**
+ * Embedded files in a PDF are always stored as their own stream objects (never inside an object
+ * stream), so scanning every `stream … endstream` and inflating FlateDecode ones finds an ISDOC
+ * attachment without a full PDF parser. Encrypted PDFs yield nothing (the caller falls back).
+ */
+function isdocFromPdf(bytes: Uint8Array): string | null {
+  const text = latin1.decode(bytes);
+  if (/\/Encrypt\b/.test(text)) return null;
+  const re = /stream\r?\n/g;
+  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
+    const keyword = m.index;
+    // Skip the `stream` inside `endstream`.
+    if (text.slice(Math.max(0, keyword - 3), keyword) === 'end') continue;
+    const dictStart = text.lastIndexOf('<<', keyword);
+    const dict = dictStart < 0 ? '' : text.slice(dictStart, keyword);
+    const start = keyword + m[0].length;
+    const end = text.indexOf('endstream', start);
+    if (end < 0) break;
+    re.lastIndex = end + 9;
+    const filters = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1] ?? '';
+    const filterNames = filters.match(/\/\w+/g) ?? [];
+    let data = bytes.subarray(start, end);
+    if (filterNames.length === 1 && filterNames[0] === '/FlateDecode') {
+      try {
+        data = inflateSync(data, { maxOutputLength: ISDOC_MAX_XML_BYTES, finishFlush: 2 });
+      } catch {
+        continue;
+      }
+    } else if (filterNames.length > 0) {
+      continue;
+    }
+    const head = latin1.decode(data.subarray(0, 4096));
+    if (!head.includes(ISDOC_NS)) continue;
+    const xml = decodeXml(data);
+    if (xml !== null) return xml;
+  }
+  return null;
+}
diff --git a/packages/extraction/src/isdoc/map.ts b/packages/extraction/src/isdoc/map.ts
new file mode 100644
index 0000000..a4f3065
--- /dev/null
+++ b/packages/extraction/src/isdoc/map.ts
@@ -0,0 +1,176 @@
+import {
+  type ProtoExtraction,
+  type ProtoKindHint,
+  type ProtoPaymentMethod,
+  parseProtoExtraction,
+} from '../proto/schema';
+import { findIsdoc, ISDOC_NS, type IsdocContainer } from './find';
+import { at, childrenNamed, parseXml, textAt, type XmlElement } from './xml';
+
+/** Recorded as the prompt version of an ISDOC reading, so runs can be told apart. */
+export const ISDOC_READER_VERSION = 'isdoc-6-v1';
+
+export class IsdocError extends Error {
+  constructor(detail: string) {
+    super(`isdoc: ${detail}`);
+    this.name = 'IsdocError';
+  }
+}
+
+export interface IsdocReading {
+  readonly extraction: ProtoExtraction;
+  readonly container: IsdocContainer;
+}
+
+/** "1210.500000" → "1210.50": same value, at least 2 and at most the needed decimals (wire format allows 4). */
+function dec(text: string): string {
+  const m = /^(-?\d+)\.(\d\d)(\d*?)0*$/.exec(text);
+  return m ? `${m[1]}.${m[2]}${m[3]}` : text;
+}
+
+/** xs:date may carry a zone ("2026-10-01+02:00"); the wire format wants YYYY-MM-DD. */
+function day(text: string): string {
+  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
+}
+
+/** ISDOC DocumentType (§7.2) → the prototype's kind hint. */
+function kindOf(documentType: string, vatApplicable: boolean): ProtoKindHint {
+  switch (documentType) {
+    case '1':
+      return vatApplicable ? 'tax_invoice' : 'invoice';
+    case '2':
+    case '3':
+    case '6':
+      return 'credit_note';
+    case '4':
+      return 'proforma';
+    case '5':
+      return 'advance_tax_document';
+    case '7':
+      return 'simplified_receipt';
+    default:
+      return 'other';
+  }
+}
+
+/** PaymentMeansCode → payment method (M02 §4.2). */
+function methodOf(code: string): ProtoPaymentMethod | '' {
+  switch (code) {
+    case '':
+      return '';
+    case '10':
+      return 'cash';
+    case '31':
+    case '42':
+    case '49':
+      return 'bank_transfer';
+    case '48':
+      return 'card';
+    case '50':
+      return 'cash_on_delivery';
+    default:
+      return 'other';
+  }
+}
+
+function party(root: XmlElement, role: 'AccountingSupplierParty' | 'AccountingCustomerParty') {
+  let p = at(root, role, 'Party');
+  if (p === null && role === 'AccountingSupplierParty')
+    p = at(root, 'SellerSupplierParty', 'Party');
+  const id = textAt(p, 'PartyIdentification', 'ID');
+  const country = textAt(p, 'PostalAddress', 'Country', 'IdentificationCode').toUpperCase();
+  const companyId = textAt(p, 'PartyTaxScheme', 'CompanyID').replace(/\s/g, '').toUpperCase();
+  const isCz = country === '' || country === 'CZ';
+  return {
+    name: textAt(p, 'PartyName', 'Name'),
+    ico: isCz && /^\d{8}$/.test(id) ? id : '',
+    dic: companyId.startsWith('CZ') ? companyId : '',
+    vat_id: companyId !== '' && !companyId.startsWith('CZ') ? companyId : '',
+    country,
+  };
+}
+
+/** Builds the wire JSON of the prototype schema (strings, "" = missing) from an ISDOC tree. */
+export function isdocToWire(root: XmlElement): Record<string, unknown> {
+  if (root.name !== 'Invoice' || root.ns !== ISDOC_NS) {
+    throw new IsdocError('root is not an ISDOC Invoice');
+  }
+  const foreign = textAt(root, 'ForeignCurrencyCode');
+  const local = textAt(root, 'LocalCurrencyCode');
+  // With a foreign currency the document's own amounts are the `…Curr` elements.
+  const amount = (el: XmlElement | null, name: string): string =>
+    dec(textAt(el, foreign !== '' ? `${name}Curr` : name));
+
+  const vatApplicable = textAt(root, 'VATApplicable').toLowerCase() !== 'false';
+  const supplier = party(root, 'AccountingSupplierParty');
+  const buyerFull = party(root, 'AccountingCustomerParty');
+  const buyer = {
+    name: buyerFull.name,
+    ico: buyerFull.ico,
+    dic: buyerFull.dic || buyerFull.vat_id,
+  };
+
+  const taxTotal = at(root, 'TaxTotal');
+  const vatRecap = childrenNamed(taxTotal, 'TaxSubTotal').map((sub) => ({
+    rate_pct: dec(textAt(sub, 'TaxCategory', 'Percent')),
+    base: amount(sub, 'TaxableAmount'),
+    vat: amount(sub, 'TaxAmount'),
+  }));
+  const totals = at(root, 'LegalMonetaryTotal');
+  const payment = at(root, 'PaymentMeans', 'Payment');
+  const details = at(payment, 'Details');
+
+  return {
+    kind_hint: kindOf(textAt(root, 'DocumentType'), vatApplicable),
+    supplier,
+    buyer,
+    document: {
+      number: textAt(root, 'ID'),
+      variable_symbol: textAt(details, 'VariableSymbol'),
+    },
+    dates: {
+      issue_date: day(textAt(root, 'IssueDate')),
+      // Absent on non-payer invoices: stays empty, never copied from the issue date.
+      duzp: day(textAt(root, 'TaxPointDate')),
+      due_date: day(textAt(details, 'PaymentDueDate')),
+    },
+    currency: foreign !== '' ? foreign : local,
+    vat_recap: vatApplicable ? vatRecap : [],
+    totals: {
+      net: amount(totals, 'TaxExclusiveAmount'),
+      // TaxTotal/TaxAmount has a Curr variant too (ISDOC 6.0.2 TaxTotal: TaxAmountCurr).
+      vat: amount(taxTotal, 'TaxAmount'),
+      gross: amount(totals, 'TaxInclusiveAmount'),
+    },
+    payment: {
+      account_number: textAt(details, 'ID'),
+      bank_code: textAt(details, 'BankCode'),
+      iban: textAt(details, 'IBAN').replace(/\s/g, ''),
+      method: methodOf(textAt(payment, 'PaymentMeansCode')),
+    },
+    flags: {
+      not_tax_document_text: textAt(root, 'DocumentType') === '4',
+      non_vat_payer_text: !vatApplicable,
+      reverse_charge_text: false,
+      // PaidAmount is never trusted as "paid": real files carry PaidAmount = PayableAmount on unpaid invoices.
+      paid_text: false,
+    },
+  };
+}
+
+/**
+ * Reads an uploaded file's ISDOC data, when it has any, into the same `ProtoExtraction` shape the
+ * LLM reader produces. Returns null when the file holds no ISDOC. Throws `IsdocError` when ISDOC
+ * is present but cannot be read (the caller then falls back to the LLM).
+ */
+export function readIsdoc(bytes: Uint8Array): IsdocReading | null {
+  const found = findIsdoc(bytes);
+  if (found === null) return null;
+  let root: XmlElement;
+  try {
+    root = parseXml(found.xml);
+  } catch (error) {
+    throw new IsdocError(error instanceof Error ? error.message : 'unreadable XML');
+  }
+  return { extraction: parseProtoExtraction(isdocToWire(root)), container: found.container };
+}
diff --git a/packages/extraction/src/isdoc/xml.ts b/packages/extraction/src/isdoc/xml.ts
new file mode 100644
index 0000000..be4d483
--- /dev/null
+++ b/packages/extraction/src/isdoc/xml.ts
@@ -0,0 +1,216 @@
+/**
+ * A small strict XML reader for ISDOC (M02 §4.2, M12 V5.5). Names are local (prefix dropped),
+ * values stay strings. A DOCTYPE or ENTITY declaration is refused, so no external entity is ever
+ * resolved. Throws `XmlError` on anything that is not well-formed.
+ */
+
+export interface XmlElement {
+  /** Local name, prefix dropped (`isdoc:Invoice` → `Invoice`). */
+  readonly name: string;
+  /** Namespace URI of the element, from the nearest matching `xmlns` / `xmlns:p`; '' if none. */
+  readonly ns: string;
+  /** Attributes by local name. */
+  readonly attrs: Readonly<Record<string, string>>;
+  readonly children: readonly XmlElement[];
+  /** Concatenated character data of this element (not of its children), entities decoded. */
+  readonly text: string;
+}
+
+export class XmlError extends Error {
+  constructor(detail: string) {
+    super(`xml: ${detail}`);
+    this.name = 'XmlError';
+  }
+}
+
+const NAMED_ENTITIES: Readonly<Record<string, string>> = {
+  lt: '<',
+  gt: '>',
+  amp: '&',
+  quot: '"',
+  apos: "'",
+};
+
+function decodeEntities(raw: string): string {
+  return raw.replace(/&([^;\s&]*);?/g, (match, body: string) => {
+    if (!match.endsWith(';')) throw new XmlError('bare ampersand');
+    if (body.startsWith('#x') || body.startsWith('#X')) {
+      const code = Number.parseInt(body.slice(2), 16);
+      if (!Number.isFinite(code)) throw new XmlError('bad character reference');
+      return String.fromCodePoint(code);
+    }
+    if (body.startsWith('#')) {
+      const code = Number.parseInt(body.slice(1), 10);
+      if (!Number.isFinite(code)) throw new XmlError('bad character reference');
+      return String.fromCodePoint(code);
+    }
+    const named = NAMED_ENTITIES[body];
+    if (named === undefined) throw new XmlError('unknown entity');
+    return named;
+  });
+}
+
+function localName(qname: string): string {
+  const colon = qname.indexOf(':');
+  return colon < 0 ? qname : qname.slice(colon + 1);
+}
+
+function prefixOf(qname: string): string {
+  const colon = qname.indexOf(':');
+  return colon < 0 ? '' : qname.slice(0, colon);
+}
+
+interface Building {
+  qname: string;
+  name: string;
+  ns: string;
+  attrs: Record<string, string>;
+  children: XmlElement[];
+  text: string;
+  scope: ReadonlyMap<string, string>;
+}
+
+const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
+
+/** Parses a whole XML document and returns its root element. */
+export function parseXml(input: string): XmlElement {
+  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
+  const stack: Building[] = [];
+  let root: XmlElement | null = null;
+  let i = 0;
+
+  const close = (b: Building): void => {
+    const done: XmlElement = {
+      name: b.name,
+      ns: b.ns,
+      attrs: b.attrs,
+      children: b.children,
+      text: b.text,
+    };
+    const parent = stack[stack.length - 1];
+    if (parent) parent.children.push(done);
+    else if (root === null) root = done;
+    else throw new XmlError('more than one root element');
+  };
+
+  while (i < src.length) {
+    const lt = src.indexOf('<', i);
+    const textEnd = lt < 0 ? src.length : lt;
+    if (textEnd > i) {
+      const chunk = src.slice(i, textEnd);
+      const top = stack[stack.length - 1];
+      if (top) top.text += decodeEntities(chunk);
+      else if (chunk.trim() !== '') throw new XmlError('text outside the root element');
+    }
+    if (lt < 0) break;
+
+    if (src.startsWith('<?', lt)) {
+      const end = src.indexOf('?>', lt + 2);
+      if (end < 0) throw new XmlError('unclosed processing instruction');
+      i = end + 2;
+    } else if (src.startsWith('<!--', lt)) {
+      const end = src.indexOf('-->', lt + 4);
+      if (end < 0) throw new XmlError('unclosed comment');
+      i = end + 3;
+    } else if (src.startsWith('<![CDATA[', lt)) {
+      const end = src.indexOf(']]>', lt + 9);
+      if (end < 0) throw new XmlError('unclosed CDATA');
+      const top = stack[stack.length - 1];
+      if (!top) throw new XmlError('CDATA outside the root element');
+      top.text += src.slice(lt + 9, end);
+      i = end + 3;
+    } else if (src.startsWith('<!', lt)) {
+      // DOCTYPE, ENTITY and friends: never needed by ISDOC, and the door to XXE.
+      throw new XmlError('declarations are not allowed');
+    } else if (src.startsWith('</', lt)) {
+      const end = src.indexOf('>', lt + 2);
+      if (end < 0) throw new XmlError('unclosed end tag');
+      const qname = src.slice(lt + 2, end).trim();
+      const top = stack.pop();
+      if (!top || top.qname !== qname) throw new XmlError('mismatched end tag');
+      close(top);
+      i = end + 1;
+    } else {
+      const end = findTagEnd(src, lt + 1);
+      const selfClosing = src[end - 1] === '/';
+      const inner = src.slice(lt + 1, selfClosing ? end - 1 : end);
+      const nameMatch = /^[^\s/>]+/.exec(inner);
+      if (!nameMatch) throw new XmlError('missing element name');
+      const qname = nameMatch[0];
+      const parentScope = stack[stack.length - 1]?.scope ?? new Map<string, string>();
+      const scope = new Map(parentScope);
+      const rawAttrs: [string, string][] = [];
+      const rest = inner.slice(qname.length);
+      ATTR_RE.lastIndex = 0;
+      for (let m = ATTR_RE.exec(rest); m !== null; m = ATTR_RE.exec(rest)) {
+        const key = m[1] as string;
+        const value = decodeEntities(m[3] ?? m[4] ?? '');
+        if (key === 'xmlns') scope.set('', value);
+        else if (key.startsWith('xmlns:')) scope.set(key.slice(6), value);
+        else rawAttrs.push([key, value]);
+      }
+      if (rest.replace(ATTR_RE, '').trim() !== '') throw new XmlError('malformed attributes');
+      const attrs: Record<string, string> = {};
+      for (const [key, value] of rawAttrs) attrs[localName(key)] = value;
+      const building: Building = {
+        qname,
+        name: localName(qname),
+        ns: scope.get(prefixOf(qname)) ?? '',
+        attrs,
+        children: [],
+        text: '',
+        scope,
+      };
+      if (stack.length === 0 && root !== null) throw new XmlError('more than one root element');
+      if (selfClosing) close(building);
+      else stack.push(building);
+      i = end + 1;
+    }
+  }
+
+  if (stack.length > 0) throw new XmlError('unclosed element');
+  if (root === null) throw new XmlError('no root element');
+  return root;
+}
+
+/** Index of the `>` that ends the start tag beginning at `from`, skipping quoted attribute values. */
+function findTagEnd(src: string, from: number): number {
+  let quote: string | null = null;
+  for (let j = from; j < src.length; j++) {
+    const c = src[j];
+    if (quote !== null) {
+      if (c === quote) quote = null;
+    } else if (c === '"' || c === "'") {
+      quote = c;
+    } else if (c === '>') {
+      return j;
+    } else if (c === '<') {
+      throw new XmlError('unexpected < in a tag');
+    }
+  }
+  throw new XmlError('unclosed start tag');
+}
+
+/** The first child with this local name, or null. */
+export function child(el: XmlElement | null, name: string): XmlElement | null {
+  if (el === null) return null;
+  return el.children.find((c) => c.name === name) ?? null;
+}
+
+/** All children with this local name. */
+export function childrenNamed(el: XmlElement | null, name: string): readonly XmlElement[] {
+  if (el === null) return [];
+  return el.children.filter((c) => c.name === name);
+}
+
+/** Follows a path of local names; null when any step is missing. */
+export function at(el: XmlElement | null, ...path: readonly string[]): XmlElement | null {
+  let cur = el;
+  for (const name of path) cur = child(cur, name);
+  return cur;
+}
+
+/** Trimmed text at a path; '' when the element is missing or empty. */
+export function textAt(el: XmlElement | null, ...path: readonly string[]): string {
+  return at(el, ...path)?.text.trim() ?? '';
+}
diff --git a/packages/extraction/test/isdoc.test.ts b/packages/extraction/test/isdoc.test.ts
new file mode 100644
index 0000000..bb2fd85
--- /dev/null
+++ b/packages/extraction/test/isdoc.test.ts
@@ -0,0 +1,312 @@
+import { deflateRawSync, deflateSync } from 'node:zlib';
+import { describe, expect, it } from 'vitest';
+import { findIsdoc, IsdocError, isdocToWire, parseXml, readIsdoc, XmlError } from '../src/index';
+
+// Synthetic data only (the repo is public): IČO 12345679 / 11111119 are made-up numbers with a valid check digit.
+const NS = 'http://isdoc.cz/namespace/2013';
+
+interface Opts {
+  readonly documentType?: string;
+  readonly vatApplicable?: boolean;
+  readonly foreign?: boolean;
+  readonly taxPointDate?: boolean;
+  readonly prefix?: string;
+}
+
+function isdocXml(o: Opts = {}): string {
+  const p = o.prefix ? `${o.prefix}:` : '';
+  const xmlns = o.prefix ? `xmlns:${o.prefix}="${NS}"` : `xmlns="${NS}"`;
+  const amt = (name: string, czk: string, eur: string) =>
+    o.foreign
+      ? `<${p}${name}>${czk}</${p}${name}><${p}${name}Curr>${eur}</${p}${name}Curr>`
+      : `<${p}${name}>${czk}</${p}${name}>`;
+  return `<?xml version="1.0" encoding="UTF-8"?>
+<!-- synthetic test invoice -->
+<${p}Invoice ${xmlns} version="6.0.2">
+  <${p}DocumentType>${o.documentType ?? '1'}</${p}DocumentType>
+  <${p}ID>FV-2026-0042</${p}ID>
+  <${p}UUID>3F2504E0-4F89-11D3-9A0C-0305E82C3301</${p}UUID>
+  <${p}IssueDate>2026-09-30</${p}IssueDate>
+  ${o.taxPointDate === false ? '' : `<${p}TaxPointDate>2026-09-30</${p}TaxPointDate>`}
+  <${p}VATApplicable>${o.vatApplicable === false ? 'false' : 'true'}</${p}VATApplicable>
+  <${p}Note>Test &amp; demo &lt;only&gt; &#x10C;&#353;</${p}Note>
+  <${p}LocalCurrencyCode>CZK</${p}LocalCurrencyCode>
+  ${o.foreign ? `<${p}ForeignCurrencyCode>EUR</${p}ForeignCurrencyCode><${p}CurrRate>25</${p}CurrRate><${p}RefCurrRate>1</${p}RefCurrRate>` : ''}
+  <${p}AccountingSupplierParty><${p}Party>
+    <${p}PartyIdentification><${p}ID>12345679</${p}ID></${p}PartyIdentification>
+    <${p}PartyName><${p}Name>Example Supplier s.r.o.</${p}Name></${p}PartyName>
+    <${p}PostalAddress><${p}StreetName>Testovací</${p}StreetName><${p}BuildingNumber>1</${p}BuildingNumber><${p}CityName>Praha</${p}CityName><${p}PostalZone>11000</${p}PostalZone><${p}Country><${p}IdentificationCode>CZ</${p}IdentificationCode><${p}Name>Česká republika</${p}Name></${p}Country></${p}PostalAddress>
+    <${p}PartyTaxScheme><${p}CompanyID>CZ12345679</${p}CompanyID><${p}TaxScheme>VAT</${p}TaxScheme></${p}PartyTaxScheme>
+  </${p}Party></${p}AccountingSupplierParty>
+  <${p}AccountingCustomerParty><${p}Party>
+    <${p}PartyIdentification><${p}ID>11111119</${p}ID></${p}PartyIdentification>
+    <${p}PartyName><${p}Name>Example Buyer</${p}Name></${p}PartyName>
+    <${p}PostalAddress><${p}Country><${p}IdentificationCode>CZ</${p}IdentificationCode></${p}Country></${p}PostalAddress>
+    <${p}PartyTaxScheme><${p}CompanyID/><${p}TaxScheme>VAT</${p}TaxScheme></${p}PartyTaxScheme>
+  </${p}Party></${p}AccountingCustomerParty>
+  <${p}InvoiceLines><${p}InvoiceLine><${p}ID>1</${p}ID><${p}LineExtensionAmount>1000.00</${p}LineExtensionAmount></${p}InvoiceLine></${p}InvoiceLines>
+  <${p}TaxTotal>
+    <${p}TaxSubTotal>
+      ${amt('TaxableAmount', '1000.000000', '40.00')}
+      ${amt('TaxAmount', '210.00', '8.40')}
+      <${p}TaxCategory><${p}Percent>21</${p}Percent></${p}TaxCategory>
+    </${p}TaxSubTotal>
+    ${amt('TaxAmount', '210.00', '8.40')}
+  </${p}TaxTotal>
+  <${p}LegalMonetaryTotal>
+    ${amt('TaxExclusiveAmount', '1000.00', '40.00')}
+    ${amt('TaxInclusiveAmount', '1210.00', '48.40')}
+    <${p}PayableRoundingAmount>0</${p}PayableRoundingAmount>
+    ${amt('PayableAmount', '1210.00', '48.40')}
+  </${p}LegalMonetaryTotal>
+  <${p}PaymentMeans><${p}Payment>
+    <${p}PaidAmount>1210.00</${p}PaidAmount>
+    <${p}PaymentMeansCode>42</${p}PaymentMeansCode>
+    <${p}Details><${p}PaymentDueDate>2026-10-14</${p}PaymentDueDate><${p}ID>123456789</${p}ID><${p}BankCode>0100</${p}BankCode><${p}IBAN>CZ6508000000192000145399</${p}IBAN><${p}VariableSymbol>20260042</${p}VariableSymbol></${p}Details>
+  </${p}Payment></${p}PaymentMeans>
+</${p}Invoice>`;
+}
+
+const enc = (s: string) => new TextEncoder().encode(s);
+
+/** A minimal ZIP (one entry per file, deflated), enough for the reader's central-directory walk. */
+function makeZip(files: Record<string, string>): Uint8Array {
+  const local: Buffer[] = [];
+  const central: Buffer[] = [];
+  let offset = 0;
+  for (const [name, content] of Object.entries(files)) {
+    const nameBytes = Buffer.from(name, 'utf8');
+    const raw = Buffer.from(content, 'utf8');
+    const data = deflateRawSync(raw);
+    const lh = Buffer.alloc(30);
+    lh.writeUInt32LE(0x04034b50, 0);
+    lh.writeUInt16LE(20, 4);
+    lh.writeUInt16LE(8, 8);
+    lh.writeUInt32LE(data.length, 18);
+    lh.writeUInt32LE(raw.length, 22);
+    lh.writeUInt16LE(nameBytes.length, 26);
+    local.push(lh, nameBytes, data);
+    const ch = Buffer.alloc(46);
+    ch.writeUInt32LE(0x02014b50, 0);
+    ch.writeUInt16LE(20, 4);
+    ch.writeUInt16LE(20, 6);
+    ch.writeUInt16LE(8, 10);
+    ch.writeUInt32LE(data.length, 20);
+    ch.writeUInt32LE(raw.length, 24);
+    ch.writeUInt16LE(nameBytes.length, 28);
+    ch.writeUInt32LE(offset, 42);
+    central.push(ch, nameBytes);
+    offset += 30 + nameBytes.length + data.length;
+  }
+  const cd = Buffer.concat(central);
+  const eocd = Buffer.alloc(22);
+  eocd.writeUInt32LE(0x06054b50, 0);
+  eocd.writeUInt16LE(Object.keys(files).length, 8);
+  eocd.writeUInt16LE(Object.keys(files).length, 10);
+  eocd.writeUInt32LE(cd.length, 12);
+  eocd.writeUInt32LE(offset, 16);
+  return new Uint8Array(Buffer.concat([...local, cd, eocd]));
+}
+
+/** A small PDF with one page content stream and, optionally, an embedded file stream. */
+function makePdf(
+  embedded: string | null,
+  options: { flate?: boolean; encrypt?: boolean } = {},
+): Uint8Array {
+  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
+  const content = deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Faktura) Tj ET'));
+  parts.push(
+    Buffer.from(
+      `4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`,
+      'latin1',
+    ),
+    content,
+    Buffer.from('\nendstream\nendobj\n', 'latin1'),
+  );
+  if (embedded !== null) {
+    const raw = Buffer.from(embedded, 'utf8');
+    const data = options.flate === false ? raw : deflateSync(raw);
+    const filter = options.flate === false ? '' : ' /Filter /FlateDecode';
+    parts.push(
+      Buffer.from(
+        `5 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml /Length ${data.length}${filter} >>\nstream\r\n`,
+        'latin1',
+      ),
+      data,
+      Buffer.from('\r\nendstream\nendobj\n', 'latin1'),
+    );
+    parts.push(
+      Buffer.from(
+        '6 0 obj\n<< /Type /Filespec /F (faktura_0042.isdoc) /EF << /F 5 0 R >> >>\nendobj\n',
+        'latin1',
+      ),
+    );
+  }
+  const trailer = options.encrypt ? '/Encrypt 9 0 R ' : '';
+  parts.push(Buffer.from(`trailer\n<< /Root 1 0 R ${trailer}>>\n%%EOF\n`, 'latin1'));
+  return new Uint8Array(Buffer.concat(parts));
+}
+
+describe('parseXml', () => {
+  it('reads local names, namespaces, attributes, entities and CDATA', () => {
+    const root = parseXml(
+      `﻿<?xml version="1.0"?><a:Root xmlns:a="urn:x" b="1 &amp; 2"><a:C><![CDATA[<raw>]]></a:C><D/></a:Root>`,
+    );
+    expect(root.name).toBe('Root');
+    expect(root.ns).toBe('urn:x');
+    expect(root.attrs).toEqual({ b: '1 & 2' });
+    expect(root.children.map((c) => c.name)).toEqual(['C', 'D']);
+    expect(root.children[0]?.text).toBe('<raw>');
+    expect(root.children[1]?.ns).toBe('');
+  });
+
+  it('refuses DOCTYPE and ENTITY declarations (no XXE)', () => {
+    expect(() =>
+      parseXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'),
+    ).toThrow(XmlError);
+  });
+
+  it('refuses malformed XML', () => {
+    expect(() => parseXml('<a><b></a></b>')).toThrow(XmlError);
+    expect(() => parseXml('<a>')).toThrow(XmlError);
+    expect(() => parseXml('<a/><b/>')).toThrow(XmlError);
+    expect(() => parseXml('<a>x & y</a>')).toThrow(XmlError);
+    expect(() => parseXml('<a>&nbsp;</a>')).toThrow(XmlError);
+    expect(() => parseXml('')).toThrow(XmlError);
+  });
+});
+
+describe('findIsdoc', () => {
+  it('finds a plain .isdoc file', () => {
+    expect(findIsdoc(enc(isdocXml()))?.container).toBe('xml');
+  });
+
+  it('finds the manifest main document in an .isdocx', () => {
+    const zip = makeZip({
+      'manifest.xml':
+        '<manifest xmlns="http://isdoc.cz/namespace/2013/manifest"><maindocument filename="invoice.isdoc"/></manifest>',
+      'invoice.isdoc': isdocXml(),
+      'invoice.pdf': '%PDF-1.7 not really',
+    });
+    const found = findIsdoc(zip);
+    expect(found?.container).toBe('isdocx');
+    expect(found?.xml).toContain('FV-2026-0042');
+  });
+
+  it('falls back to a root-level *.isdoc when the .isdocx has no manifest', () => {
+    expect(findIsdoc(makeZip({ 'faktura.isdoc': isdocXml() }))?.container).toBe('isdocx');
+  });
+
+  it('finds an ISDOC embedded in a PDF, compressed or not', () => {
+    expect(findIsdoc(makePdf(isdocXml()))?.container).toBe('pdf');
+    expect(findIsdoc(makePdf(isdocXml(), { flate: false }))?.xml).toContain('FV-2026-0042');
+  });
+
+  it('returns null for a PDF without ISDOC, an encrypted PDF, other XML and garbage', () => {
+    expect(findIsdoc(makePdf(null))).toBeNull();
+    expect(findIsdoc(makePdf(isdocXml(), { encrypt: true }))).toBeNull();
+    expect(
+      findIsdoc(enc('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>')),
+    ).toBeNull();
+    expect(findIsdoc(enc('PK\u0003\u0004 broken zip'))).toBeNull();
+    expect(findIsdoc(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
+  });
+});
+
+describe('isdocToWire / readIsdoc', () => {
+  it('maps a CZK tax invoice into the reader shape exactly', () => {
+    const reading = readIsdoc(enc(isdocXml()));
+    expect(reading?.container).toBe('xml');
+    const x = reading?.extraction;
+    expect(x).toMatchObject({
+      kind_hint: 'tax_invoice',
+      document_class: 'received_invoice',
+      supplier: {
+        name: 'Example Supplier s.r.o.',
+        ico: '12345679',
+        dic: 'CZ12345679',
+        vat_id: null,
+        country: 'CZ',
+      },
+      buyer: { name: 'Example Buyer', ico: '11111119', dic: null },
+      document: { number: 'FV-2026-0042', variable_symbol: '20260042' },
+      dates: { issue_date: '2026-09-30', duzp: '2026-09-30', due_date: '2026-10-14' },
+      currency: 'CZK',
+      vat_recap: [{ rate_pct: '21', base: '1000.00', vat: '210.00' }],
+      totals: { net: '1000.00', vat: '210.00', gross: '1210.00' },
+      payment: {
+        account_number: '123456789',
+        bank_code: '0100',
+        iban: 'CZ6508000000192000145399',
+        method: 'bank_transfer',
+      },
+      flags: {
+        not_tax_document_text: false,
+        non_vat_payer_text: false,
+        reverse_charge_text: false,
+        paid_text: false,
+      },
+      not_tax_document: false,
+      issues: [],
+    });
+  });
+
+  it('uses the foreign-currency amounts when ForeignCurrencyCode is present', () => {
+    const x = readIsdoc(enc(isdocXml({ foreign: true })))?.extraction;
+    expect(x?.currency).toBe('EUR');
+    expect(x?.totals).toEqual({ net: '40.00', vat: '8.40', gross: '48.40' });
+    expect(x?.vat_recap).toEqual([{ rate_pct: '21', base: '40.00', vat: '8.40' }]);
+  });
+
+  it('works with a prefixed namespace', () => {
+    expect(readIsdoc(enc(isdocXml({ prefix: 'isdoc' })))?.extraction.document.number).toBe(
+      'FV-2026-0042',
+    );
+  });
+
+  it('leaves DUZP empty when TaxPointDate is absent (never copies the issue date)', () => {
+    expect(readIsdoc(enc(isdocXml({ taxPointDate: false })))?.extraction.dates.duzp).toBeNull();
+  });
+
+  it('marks a non-VAT invoice and drops its VAT recap', () => {
+    const x = readIsdoc(enc(isdocXml({ vatApplicable: false })))?.extraction;
+    expect(x?.kind_hint).toBe('invoice');
+    expect(x?.flags.non_vat_payer_text).toBe(true);
+    expect(x?.not_tax_document).toBe(true);
+    expect(x?.vat_recap).toEqual([]);
+  });
+
+  it('maps document types to kinds', () => {
+    const kind = (t: string) => readIsdoc(enc(isdocXml({ documentType: t })))?.extraction.kind_hint;
+    expect([kind('2'), kind('3'), kind('4'), kind('5'), kind('6'), kind('7'), kind('9')]).toEqual([
+      'credit_note',
+      'credit_note',
+      'proforma',
+      'advance_tax_document',
+      'credit_note',
+      'simplified_receipt',
+      'other',
+    ]);
+    expect(readIsdoc(enc(isdocXml({ documentType: '4' })))?.extraction.not_tax_document).toBe(true);
+  });
+
+  it('never marks the invoice paid from PaidAmount', () => {
+    expect(readIsdoc(enc(isdocXml()))?.extraction.flags.paid_text).toBe(false);
+  });
+
+  it('reads the same data from .isdocx and from a PDF attachment', () => {
+    const plain = readIsdoc(enc(isdocXml()))?.extraction;
+    expect(readIsdoc(makeZip({ 'a.isdoc': isdocXml() }))?.extraction).toEqual(plain);
+    expect(readIsdoc(makePdf(isdocXml()))?.extraction).toEqual(plain);
+  });
+
+  it('returns null when there is no ISDOC and throws IsdocError when it is unreadable', () => {
+    expect(readIsdoc(makePdf(null))).toBeNull();
+    const broken = isdocXml().replace('</Invoice>', '');
+    expect(() => readIsdoc(enc(broken))).toThrow(IsdocError);
+  });
+
+  it('rejects a root that is not an ISDOC Invoice', () => {
+    expect(() => isdocToWire(parseXml('<Invoice xmlns="urn:other"/>'))).toThrow(IsdocError);
+  });
+});
```

## 5. Do not touch

`packages/extraction/src/proto/**`, `packages/extraction/src/llm/**`, any `package.json` or the lockfile. Hard rules 4 (no real data) and 7 (no dependency).

## 6. Commands

- `pnpm --filter @shoebox/extraction test -- test/isdoc.test.ts 2>&1 | tail -30` → `Tests  18 passed (18)`
- `pnpm --filter @shoebox/extraction test 2>&1 | tail -30` → `Tests  49 passed (49)`
- `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30` → no errors
- `pnpm exec biome check packages/extraction 2>&1 | tail -30` → no errors
- `pnpm eval --quick 2>&1 | tail -30` → record the last lines (no prompt or model change, so no score change)

## 7. Acceptance

- [ ] `git diff --stat HEAD~2` lists only the §3 files plus this brief and the report.
- [ ] The §6 commands pass.
- [ ] `grep -cE 'fast-xml-parser|fflate|pdfjs' packages/extraction/package.json` → `0`.

## 8. Stop and ask

Stop and write the report if: `git apply` fails; a test fails twice; a file outside §3 changes; a new dependency seems needed; you reach 25 tool calls or about 50k tokens.

## 9. Report

Write `docs/tasks/0075-report.md` (600 tokens at most): files changed (`git diff --stat HEAD~2`), each command with the last 5 lines of its output, deviations (none expected).
