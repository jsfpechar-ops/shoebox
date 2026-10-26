import { crc32 } from 'node:zlib';

export type QrVatSlot = 'standard' | 'reduced1' | 'reduced2' | 'none';
export interface QrVatRow {
  readonly slot: QrVatSlot;
  readonly base: string;
  readonly vat: string;
}
export interface QrInvoice {
  readonly kind: 'sid';
  readonly number: string | null;
  readonly issue_date: string | null; // ISO YYYY-MM-DD
  readonly duzp: string | null;
  readonly due_date: string | null;
  readonly amount: string | null; // "1210.00": always 2 decimals
  readonly currency: string | null; // 3 uppercase letters
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

type Attrs = Map<string, string>; // raw (not URL-decoded) values, first occurrence wins

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const v = value.trim();
  return v === '' ? null : v;
}

function amountOf(raw: string | undefined): string | null {
  const v = nonEmpty(raw === undefined ? undefined : safeDecode(raw));
  if (v === null || !/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [whole, frac = ''] = v.split('.');
  return `${whole}.${frac.padEnd(2, '0')}`;
}

function dateOf(raw: string | undefined): string | null {
  const v = nonEmpty(raw === undefined ? undefined : safeDecode(raw));
  if (v === null || !/^\d{8}$/.test(v)) return null;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(4, 6));
  const d = Number(v.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

function currencyOf(raw: string | undefined): string | null {
  const v = nonEmpty(raw === undefined ? undefined : safeDecode(raw));
  return v !== null && /^[A-Z]{3}$/.test(v) ? v : null;
}

function icoOf(raw: string | undefined): string | null {
  const v = nonEmpty(raw === undefined ? undefined : safeDecode(raw));
  return v !== null && /^\d{8}$/.test(v) ? v : null;
}

function symbolOf(raw: string | undefined): string | null {
  const v = nonEmpty(raw === undefined ? undefined : safeDecode(raw));
  return v !== null && /^\d{1,10}$/.test(v) ? v : null;
}

function dicOf(raw: string | undefined): string | null {
  const v = nonEmpty(raw === undefined ? undefined : safeDecode(raw));
  return v === null ? null : v.toUpperCase().replace(/\s+/g, '');
}

function ibanOf(raw: string | undefined): string | null {
  const v = nonEmpty(raw === undefined ? undefined : safeDecode(raw));
  return v === null ? null : v.toUpperCase().replace(/\s+/g, '');
}

function textOf(raw: string | undefined): string | null {
  return nonEmpty(raw === undefined ? undefined : safeDecode(raw));
}

// ACC is "IBAN" or "IBAN+BIC"; the separator is taken from the raw value.
function accountOf(raw: string | undefined): { iban: string | null; bic: string | null } {
  if (raw === undefined) return { iban: null, bic: null };
  const [ibanPart = '', bicPart] = safeDecode(raw).split('+');
  return {
    iban: ibanOf(ibanPart),
    bic: bicPart === undefined ? null : nonEmpty(bicPart.toUpperCase()),
  };
}

function parseAttrs(parts: readonly string[]): Attrs {
  const attrs: Attrs = new Map();
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const key = part.slice(0, idx);
    if (!attrs.has(key)) attrs.set(key, part.slice(idx + 1));
  }
  return attrs;
}

function crcMatches(header: string, parts: readonly string[], expected: string): boolean {
  const attrs = parts.filter((p) => p.includes(':') && !p.startsWith('CRC32:'));
  const signed = [header, ...[...attrs].sort()].join('*');
  const computed = crc32(Buffer.from(signed, 'utf8')).toString(16).toUpperCase().padStart(8, '0');
  return computed === expected.toUpperCase();
}

function vatRows(attrs: Attrs): QrVatRow[] {
  const rows: QrVatRow[] = [];
  const slots: Array<[QrVatSlot, string, string]> = [
    ['standard', 'TB0', 'T0'],
    ['reduced1', 'TB1', 'T1'],
    ['reduced2', 'TB2', 'T2'],
  ];
  for (const [slot, baseKey, vatKey] of slots) {
    const base = amountOf(attrs.get(baseKey));
    const vat = amountOf(attrs.get(vatKey));
    if (base !== null && vat !== null) rows.push({ slot, base, vat });
  }
  const none = amountOf(attrs.get('NTB'));
  if (none !== null) rows.push({ slot: 'none', base: none, vat: '0.00' });
  return rows;
}

function parseSid(attrs: Attrs): QrInvoice {
  const td = attrs.get('TD');
  const taxType = td === '0' || td === '1' || td === '2' || td === '9' ? td : null;
  const acc = accountOf(attrs.get('ACC'));
  return {
    kind: 'sid',
    number: textOf(attrs.get('ID')),
    issue_date: dateOf(attrs.get('DD')),
    duzp: dateOf(attrs.get('DUZP')),
    due_date: dateOf(attrs.get('DT')),
    amount: amountOf(attrs.get('AM')),
    currency: currencyOf(attrs.get('CC')),
    variable_symbol: symbolOf(attrs.get('VS')),
    supplier_ico: icoOf(attrs.get('INI')),
    supplier_dic: dicOf(attrs.get('VII')),
    buyer_ico: icoOf(attrs.get('INR')),
    buyer_dic: dicOf(attrs.get('VIR')),
    tax_doc_type: taxType,
    iban: acc.iban,
    vat_rows: vatRows(attrs),
  };
}

function parseSpayd(attrs: Attrs): QrPayment {
  const acc = accountOf(attrs.get('ACC'));
  const inv = attrs.get('X-INV');
  let invoice: QrInvoice | null = null;
  if (inv !== undefined) {
    const nested = parseQrPayload(safeDecode(inv));
    if (nested.ok && nested.value.kind === 'sid') invoice = nested.value;
  }
  return {
    kind: 'spayd',
    iban: acc.iban,
    bic: acc.bic,
    amount: amountOf(attrs.get('AM')),
    currency: currencyOf(attrs.get('CC')),
    due_date: dateOf(attrs.get('DT')),
    variable_symbol: symbolOf(attrs.get('X-VS')),
    constant_symbol: symbolOf(attrs.get('X-KS')),
    specific_symbol: symbolOf(attrs.get('X-SS')),
    payee_name: textOf(attrs.get('RN')),
    message: textOf(attrs.get('MSG')),
    invoice,
  };
}

export function parseQrPayload(text: string): QrParseResult {
  let body = text.trim();
  if (body.endsWith('*')) body = body.slice(0, -1);
  const parts = body.split('*');
  const type = parts[0] ?? '';
  if (type !== 'SPD' && type !== 'SID') return { ok: false, reason: 'not_payment_qr' };
  const version = parts[1];
  if (version === undefined || !/^\d+\.\d+$/.test(version))
    return { ok: false, reason: 'bad_header' };

  const header = `${type}*${version}`;
  const attributeParts = parts.slice(2);
  const attrs = parseAttrs(attributeParts);
  const crc = attrs.get('CRC32');
  if (crc !== undefined && !crcMatches(header, attributeParts, crc)) {
    return { ok: false, reason: 'crc_invalid' };
  }

  if (type === 'SID') return { ok: true, value: parseSid(attrs) };
  return { ok: true, value: parseSpayd(attrs) };
}
