/**
 * Prototype extraction (decisions 2026-10-18 [proto]): the M02 §4.5.4 wire conventions on the
 * fields the "page + score" MVP needs. "" = not printed, amounts are decimal strings, dates are
 * YYYY-MM-DD. Names follow 04 (supplier, duzp, variable_symbol, vat_recap, totals.gross).
 */
import type { LlmImageMediaType, LlmRequest } from '../llm/client';

export const PROTO_PROMPT_VERSION = 'm02-proto-v3';
export const PROTO_MAX_TOKENS = 4096;

export type ProtoMediaType = 'application/pdf' | LlmImageMediaType;

const EXTENSION_MEDIA_TYPES: Readonly<Record<string, ProtoMediaType>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Media type by file extension (case-insensitive), or null when the file is not a PDF or image. */
export function protoMediaTypeOf(fileName: string): ProtoMediaType | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_MEDIA_TYPES[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

export function isProtoMediaType(value: string): value is ProtoMediaType {
  return Object.values(EXTENSION_MEDIA_TYPES).includes(value as ProtoMediaType);
}

export const PROTO_KIND_HINTS = [
  'invoice',
  'tax_invoice',
  'simplified_receipt',
  'card_slip',
  'credit_note',
  'proforma',
  'advance_tax_document',
  'order_confirmation',
  'statement',
  'government_filing',
  'non_document',
  'unreadable',
  'other',
] as const;
export type ProtoKindHint = (typeof PROTO_KIND_HINTS)[number];

/** Document classes of 04 that the prototype can tell apart. */
export type ProtoDocumentClass =
  | 'received_invoice'
  | 'received_receipt'
  | 'received_credit_note'
  | 'received_proforma'
  | 'received_advance_tax_doc'
  | 'order_confirmation'
  | 'settlement_statement'
  | 'government_filing'
  | 'non_document'
  | 'unreadable'
  | 'unknown';

const KIND_TO_CLASS: Readonly<Record<ProtoKindHint, ProtoDocumentClass>> = {
  invoice: 'received_invoice',
  tax_invoice: 'received_invoice',
  simplified_receipt: 'received_receipt',
  card_slip: 'received_receipt',
  credit_note: 'received_credit_note',
  proforma: 'received_proforma',
  advance_tax_document: 'received_advance_tax_doc',
  order_confirmation: 'order_confirmation',
  statement: 'settlement_statement',
  government_filing: 'government_filing',
  non_document: 'non_document',
  unreadable: 'unreadable',
  other: 'unknown',
};

export function documentClassOf(kind: ProtoKindHint): ProtoDocumentClass {
  return KIND_TO_CLASS[kind];
}

export const PROTO_PAYMENT_METHODS = [
  'bank_transfer',
  'card',
  'cash',
  'cash_on_delivery',
  'other',
] as const;
export type ProtoPaymentMethod = (typeof PROTO_PAYMENT_METHODS)[number];

const S = { type: 'string' } as const;
const DEC = {
  type: 'string',
  description: 'Decimal string with a dot, no spaces or currency; "" if not printed',
};
const DATE = { type: 'string', description: 'YYYY-MM-DD; "" if not printed' };

/** OpenAPI-subset schema for `generationConfig.responseSchema` (Gemini) and the tool schema (Claude). */
export const PROTO_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    kind_hint: { type: 'string', enum: [...PROTO_KIND_HINTS] },
    supplier: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Supplier (issuer) legal name as printed' },
        ico: { type: 'string', description: 'Czech IČO, 8 digits; "" if not printed' },
        dic: { type: 'string', description: 'Czech DIČ starting with CZ; "" if not printed' },
        vat_id: { type: 'string', description: 'Foreign VAT ID; "" if not printed' },
        country: {
          type: 'string',
          description: 'ISO 3166-1 alpha-2 of the supplier; "" if unknown',
        },
      },
      required: ['name', 'ico', 'dic', 'vat_id', 'country'],
    },
    buyer: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Buyer (customer) name as printed; "" if not printed',
        },
        ico: { type: 'string', description: 'Buyer Czech IČO, 8 digits; "" if not printed' },
        dic: { type: 'string', description: 'Buyer DIČ or VAT ID; "" if not printed' },
      },
      required: ['name', 'ico', 'dic'],
    },
    document: {
      type: 'object',
      properties: {
        number: { type: 'string', description: 'Document (invoice/receipt) number' },
        variable_symbol: { type: 'string', description: 'Variabilní symbol' },
      },
      required: ['number', 'variable_symbol'],
    },
    dates: {
      type: 'object',
      properties: { issue_date: DATE, duzp: DATE, due_date: DATE },
      required: ['issue_date', 'duzp', 'due_date'],
    },
    currency: { type: 'string', description: 'ISO 4217 code, e.g. CZK; "" if not printed' },
    vat_recap: {
      type: 'array',
      description:
        'One row per VAT rate from the VAT summary; empty if no VAT breakdown is printed',
      items: {
        type: 'object',
        properties: {
          rate_pct: { type: 'string', description: 'Rate in percent, e.g. "21"' },
          base: DEC,
          vat: DEC,
        },
        required: ['rate_pct', 'base', 'vat'],
      },
    },
    totals: {
      type: 'object',
      properties: { net: DEC, vat: DEC, gross: DEC },
      required: ['net', 'vat', 'gross'],
    },
    payment: {
      type: 'object',
      properties: {
        account_number: { type: 'string', description: 'Czech account number without bank code' },
        bank_code: { type: 'string', description: 'Czech 4-digit bank code' },
        iban: S,
        method: {
          type: 'string',
          enum: [...PROTO_PAYMENT_METHODS, ''],
          description: 'How it is or was paid, as printed; "" if not printed',
        },
      },
      required: ['account_number', 'bank_code', 'iban', 'method'],
    },
    flags: {
      type: 'object',
      properties: {
        not_tax_document_text: {
          type: 'boolean',
          description: 'The document states it is not a tax document (e.g. "není daňový doklad")',
        },
        non_vat_payer_text: {
          type: 'boolean',
          description: 'The supplier states it is not a VAT payer (e.g. "neplátce DPH")',
        },
        reverse_charge_text: {
          type: 'boolean',
          description: 'Reverse charge wording is printed',
        },
        paid_text: {
          type: 'boolean',
          description: 'The document states it is already paid (e.g. "Zaplaceno", "Uhrazeno")',
        },
      },
      required: ['not_tax_document_text', 'non_vat_payer_text', 'reverse_charge_text', 'paid_text'],
    },
  },
  required: [
    'kind_hint',
    'supplier',
    'buyer',
    'document',
    'dates',
    'currency',
    'vat_recap',
    'totals',
    'payment',
    'flags',
  ],
};

export const PROTO_SYSTEM_PROMPT = [
  'Jsi přesný extraktor údajů z českých a zahraničních účetních dokladů (faktury, účtenky, dobropisy, výpisy, podání).',
  'Vrať pouze JSON podle schématu. Nic nedopočítávej a nic si nedomýšlej: opisuj jen to, co je na dokladu vytištěno.',
  'Hodnota, která na dokladu není, je prázdný řetězec "".',
  'Částky zapisuj jako desetinný řetězec s tečkou, bez mezer a bez měny (např. "1234.56"). Záporné částky se znaménkem minus.',
  'Data zapisuj jako YYYY-MM-DD. Sazby DPH v procentech jako řetězec (např. "21", "12", "0").',
  'supplier je dodavatel (ten, kdo doklad vystavil), nikdy odběratel. ico je české IČO (8 číslic), dic je české DIČ (začíná CZ), vat_id je zahraniční DIČ/VAT ID.',
  'duzp je datum uskutečnění zdanitelného plnění; pokud není vytištěno, nech "" (nepřebírej datum vystavení).',
  'vat_recap je rekapitulace DPH po sazbách; pokud doklad žádný rozpis DPH neobsahuje, vrať prázdné pole.',
  'Sazbu DPH nikdy neodhaduj a nedopočítávej: když na dokladu není rozpis podle sazeb, nech vat_recap prázdné, i když je vytištěna celková DPH.',
  'buyer je odběratel (komu je doklad vystaven); na účtence často chybí, pak nech "".',
  'payment.method: bank_transfer = převodem; card = kartou (i „Platba kartou“, terminál); cash = hotově; cash_on_delivery = dobírka; other = jinak; "" = neuvedeno. flags.paid_text = na dokladu stojí, že je už zaplaceno („Zaplaceno“, „Uhrazeno“, „Neplaťte“).',
  'kind_hint: tax_invoice = faktura - daňový doklad; invoice = faktura bez rozpisu DPH nebo od neplátce; simplified_receipt = zjednodušený daňový doklad / účtenka; card_slip = jen stvrzenka z terminálu; order_confirmation = potvrzení objednávky; statement = vyúčtování nebo výpis; government_filing = podání nebo hlášení úřadu; non_document = není účetní doklad: newsletter, reklama, marketingový e-mail, obchodní nabídka, spam, i když obsahuje ceny; unreadable = doklad je rozmazaný, oříznutý nebo jinak nečitelný, takže dodavatele, částku nebo datum nejde spolehlivě přečíst (pak ostatní pole nech prázdná); other = jiný doklad, který se do žádné skupiny nevejde. Faktura nebo účtenka zůstává fakturou nebo účtenkou, i když je v marketingově vypadajícím e-mailu.',
].join('\n');

export const PROTO_USER_PROMPT = 'Vytěž údaje z přiloženého dokladu.';

export interface ProtoFile {
  readonly bytes: Uint8Array;
  readonly mediaType: ProtoMediaType;
}

export interface BuildProtoRequestOptions {
  readonly model: string;
  readonly file: ProtoFile;
  readonly maxTokens?: number;
}

/** The `LlmRequest` for one file: system prompt, the file as a document or image block, the schema. */
export function buildProtoRequest(options: BuildProtoRequestOptions): LlmRequest {
  const dataBase64 = Buffer.from(options.file.bytes).toString('base64');
  const fileBlock =
    options.file.mediaType === 'application/pdf'
      ? { type: 'document' as const, mediaType: options.file.mediaType, dataBase64 }
      : { type: 'image' as const, mediaType: options.file.mediaType, dataBase64 };
  return {
    model: options.model,
    promptVersion: PROTO_PROMPT_VERSION,
    maxTokens: options.maxTokens ?? PROTO_MAX_TOKENS,
    system: [{ type: 'text', text: PROTO_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: PROTO_USER_PROMPT }] }],
    output: { type: 'json_schema', name: PROTO_PROMPT_VERSION, schema: PROTO_RESPONSE_SCHEMA },
  };
}

export interface ProtoVatLine {
  readonly rate_pct: string;
  readonly base: string;
  readonly vat: string;
}

/** Normalized output: "" became null, invalid decimals and dates became null and are listed in `issues`. */
export interface ProtoExtraction {
  readonly schema_version: typeof PROTO_PROMPT_VERSION;
  readonly kind_hint: ProtoKindHint;
  readonly document_class: ProtoDocumentClass;
  readonly supplier: {
    readonly name: string | null;
    readonly ico: string | null;
    readonly dic: string | null;
    readonly vat_id: string | null;
    readonly country: string | null;
  };
  readonly buyer: {
    readonly name: string | null;
    readonly ico: string | null;
    readonly dic: string | null;
  };
  readonly document: { readonly number: string | null; readonly variable_symbol: string | null };
  readonly dates: {
    readonly issue_date: string | null;
    readonly duzp: string | null;
    readonly due_date: string | null;
  };
  readonly currency: string | null;
  readonly vat_recap: readonly ProtoVatLine[];
  readonly totals: {
    readonly net: string | null;
    readonly vat: string | null;
    readonly gross: string | null;
  };
  readonly payment: {
    readonly account_number: string | null;
    readonly bank_code: string | null;
    readonly iban: string | null;
    readonly method: ProtoPaymentMethod | null;
  };
  readonly flags: {
    readonly not_tax_document_text: boolean;
    readonly non_vat_payer_text: boolean;
    readonly reverse_charge_text: boolean;
    readonly paid_text: boolean;
  };
  /** Derived: the document says so, or the supplier is not a VAT payer. */
  readonly not_tax_document: boolean;
  /** Paths whose value did not match the wire format and were dropped. */
  readonly issues: readonly string[];
}

export class ProtoParseError extends Error {
  constructor(detail: string) {
    super(`proto extraction: ${detail}`);
    this.name = 'ProtoParseError';
  }
}

const DECIMAL_RE = /^-?\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

type Json = Record<string, unknown>;

function objectAt(parent: Json, key: string): Json {
  const value = parent[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function textAt(parent: Json, key: string): string | null {
  const value = parent[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeDecimal(text: string): string {
  // Tolerate "1 234,56", "1234,56" and "1.234,56": spaces out, a comma decimal becomes a dot.
  const compact = text.replace(/[\s ]/g, '');
  if (compact.includes(',')) return compact.replace(/\./g, '').replace(',', '.');
  return compact;
}

function decimalAt(parent: Json, key: string, path: string, issues: string[]): string | null {
  const text = textAt(parent, key);
  if (text === null) return null;
  const normalized = normalizeDecimal(text);
  if (DECIMAL_RE.test(normalized)) return normalized;
  issues.push(path);
  return null;
}

function dateAt(parent: Json, key: string, path: string, issues: string[]): string | null {
  const text = textAt(parent, key);
  if (text === null) return null;
  if (DATE_RE.test(text)) return text;
  issues.push(path);
  return null;
}

function boolAt(parent: Json, key: string): boolean {
  return parent[key] === true;
}

/** Validates and normalizes the model's JSON. Throws `ProtoParseError` only when it is not an object. */
export function parseProtoExtraction(json: unknown): ProtoExtraction {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new ProtoParseError('response is not a JSON object');
  }
  const root = json as Json;
  const issues: string[] = [];
  const rawKind = textAt(root, 'kind_hint');
  let kind: ProtoKindHint = 'other';
  if (rawKind !== null && (PROTO_KIND_HINTS as readonly string[]).includes(rawKind)) {
    kind = rawKind as ProtoKindHint;
  } else if (rawKind !== null) {
    issues.push('kind_hint');
  }
  const supplier = objectAt(root, 'supplier');
  const document = objectAt(root, 'document');
  const dates = objectAt(root, 'dates');
  const totals = objectAt(root, 'totals');
  const payment = objectAt(root, 'payment');
  const flags = objectAt(root, 'flags');
  const buyer = objectAt(root, 'buyer');
  const rawCurrency = textAt(root, 'currency')?.toUpperCase() ?? null;
  let currency: string | null = null;
  if (rawCurrency !== null && CURRENCY_RE.test(rawCurrency)) {
    currency = rawCurrency;
  } else if (rawCurrency !== null) {
    issues.push('currency');
  }
  const rawMethod = textAt(payment, 'method');
  let method: ProtoPaymentMethod | null = null;
  if (rawMethod !== null && (PROTO_PAYMENT_METHODS as readonly string[]).includes(rawMethod)) {
    method = rawMethod as ProtoPaymentMethod;
  } else if (rawMethod !== null) {
    issues.push('payment.method');
  }
  const vatRecap: ProtoVatLine[] = [];
  const rawRecap = Array.isArray(root.vat_recap) ? (root.vat_recap as unknown[]) : [];
  rawRecap.forEach((row, index) => {
    const line = row !== null && typeof row === 'object' ? (row as Json) : {};
    const path = `vat_recap[${index}]`;
    const ratePct = decimalAt(line, 'rate_pct', `${path}.rate_pct`, issues);
    const base = decimalAt(line, 'base', `${path}.base`, issues);
    const vat = decimalAt(line, 'vat', `${path}.vat`, issues);
    if (ratePct !== null && base !== null && vat !== null) {
      vatRecap.push({ rate_pct: ratePct, base, vat });
    } else {
      issues.push(path);
    }
  });
  const parsedFlags = {
    not_tax_document_text: boolAt(flags, 'not_tax_document_text'),
    non_vat_payer_text: boolAt(flags, 'non_vat_payer_text'),
    reverse_charge_text: boolAt(flags, 'reverse_charge_text'),
    paid_text: boolAt(flags, 'paid_text'),
  };
  return {
    schema_version: PROTO_PROMPT_VERSION,
    kind_hint: kind,
    document_class: documentClassOf(kind),
    supplier: {
      name: textAt(supplier, 'name'),
      ico: textAt(supplier, 'ico')?.replace(/\s/g, '') ?? null,
      dic: textAt(supplier, 'dic')?.replace(/\s/g, '').toUpperCase() ?? null,
      vat_id: textAt(supplier, 'vat_id')?.replace(/\s/g, '').toUpperCase() ?? null,
      country: textAt(supplier, 'country')?.toUpperCase() ?? null,
    },
    buyer: {
      name: textAt(buyer, 'name'),
      ico: textAt(buyer, 'ico')?.replace(/\s/g, '') ?? null,
      dic: textAt(buyer, 'dic')?.replace(/\s/g, '').toUpperCase() ?? null,
    },
    document: {
      number: textAt(document, 'number'),
      variable_symbol: textAt(document, 'variable_symbol'),
    },
    dates: {
      issue_date: dateAt(dates, 'issue_date', 'dates.issue_date', issues),
      duzp: dateAt(dates, 'duzp', 'dates.duzp', issues),
      due_date: dateAt(dates, 'due_date', 'dates.due_date', issues),
    },
    currency,
    vat_recap: vatRecap,
    totals: {
      net: decimalAt(totals, 'net', 'totals.net', issues),
      vat: decimalAt(totals, 'vat', 'totals.vat', issues),
      gross: decimalAt(totals, 'gross', 'totals.gross', issues),
    },
    payment: {
      account_number: textAt(payment, 'account_number'),
      bank_code: textAt(payment, 'bank_code'),
      iban: textAt(payment, 'iban')?.replace(/\s/g, '').toUpperCase() ?? null,
      method,
    },
    flags: parsedFlags,
    not_tax_document: parsedFlags.not_tax_document_text || parsedFlags.non_vat_payer_text,
    issues,
  };
}
