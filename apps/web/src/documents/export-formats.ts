import type { DocumentClass, VatRateType, VatStatus, VatTreatment } from '@shoebox/domain';
import type {
  IsdocExportInput,
  IsdocParty,
  PohodaDocument,
  PohodaPartner,
  PohodaPaymentMethod,
  PohodaProfile,
} from '@shoebox/exports';
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface FormatOrg {
  readonly name: string;
  readonly ico: string | null;
  readonly dic: string | null;
  readonly vatStatus: VatStatus;
}

export interface FormatPartner {
  readonly name: string;
  readonly ico: string | null;
  readonly dic: string | null;
  readonly country: string | null;
  readonly street: string | null;
  readonly city: string | null;
  readonly zip: string | null;
}

export interface FormatLine {
  readonly net: string;
  readonly vat: string;
  readonly gross: string;
  readonly vatRateType: VatRateType;
  readonly vatRatePct: string | null;
  readonly vatTreatment: VatTreatment;
  readonly categoryCode: string;
}

export interface FormatVatRow {
  readonly vatRateType: VatRateType;
  readonly vatRatePct: string;
  readonly base: string;
  readonly vat: string;
}

/** One document with its lines and VAT summary; money stays decimal strings. */
export interface FormatDoc {
  readonly id: string;
  readonly revision: number;
  readonly cls: string;
  readonly direction: string | null;
  readonly taxDocStatus: string | null;
  readonly partner: FormatPartner | null;
  readonly number: string | null;
  readonly variableSymbol: string | null;
  readonly issueDate: string | null;
  readonly duzp: string | null;
  readonly receivedDate: string | null;
  readonly vatPointDate: string | null;
  readonly dueDate: string | null;
  readonly summary: string | null;
  readonly currency: string;
  readonly totalGross: string | null;
  readonly paymentMethod: string | null;
  readonly payToAccount: {
    readonly account: string;
    readonly bankCode: string | null;
    readonly iban: string | null;
  } | null;
  readonly lines: readonly FormatLine[];
  readonly vatSummary: readonly FormatVatRow[];
}

const POHODA_PAYMENT: ReadonlySet<string> = new Set([
  'bank_transfer',
  'card',
  'cash',
  'cod',
  'platform_offset',
  'other',
]);

export function isdocTypeOf(cls: string): '1' | '2' | '5' | '7' | null {
  switch (cls) {
    case 'received_invoice':
    case 'issued_invoice':
      return '1';
    case 'received_credit_note':
    case 'issued_credit_note':
      return '2';
    case 'received_advance_tax_doc':
      return '5';
    case 'received_receipt':
      return '7';
    default:
      return null;
  }
}

function isIncoming(doc: FormatDoc): boolean {
  if (doc.direction === 'in') return true;
  if (doc.direction === 'out') return false;
  return doc.cls.startsWith('received_');
}

function isdocPartyOf(partner: FormatPartner | null): IsdocParty {
  return {
    ico: partner?.ico ?? null,
    dic: partner?.dic ?? null,
    name: partner?.name ?? '',
    country: partner?.country ?? 'CZ',
  };
}

export function isdocInputOf(
  orgId: string,
  org: FormatOrg,
  doc: FormatDoc,
): IsdocExportInput | null {
  const documentType = isdocTypeOf(doc.cls);
  if (documentType === null) return null;
  if (doc.number === null || doc.issueDate === null || doc.totalGross === null) return null;
  const orgParty: IsdocParty = { ico: org.ico, dic: org.dic, name: org.name, country: 'CZ' };
  const partnerParty = isdocPartyOf(doc.partner);
  const incoming = isIncoming(doc);
  const method = doc.paymentMethod;
  return {
    orgId,
    documentId: doc.id,
    documentType,
    number: doc.number,
    issueDate: doc.issueDate,
    duzp: doc.duzp,
    dueDate: doc.dueDate,
    currency: doc.currency,
    supplier: incoming ? partnerParty : orgParty,
    customer: incoming ? orgParty : partnerParty,
    vatRows: doc.vatSummary.map((row) => ({
      ratePct: row.vatRatePct,
      base: row.base,
      vat: row.vat,
    })),
    totalGross: doc.totalGross,
    notTaxDocument: doc.taxDocStatus === 'not_tax_document',
    payment: {
      method:
        method === 'bank_transfer' || method === 'card' || method === 'cash' || method === 'cod'
          ? method
          : method === null
            ? null
            : 'other',
      accountNumber: doc.payToAccount?.account ?? null,
      bankCode: doc.payToAccount?.bankCode ?? null,
      iban: doc.payToAccount?.iban ?? null,
      variableSymbol: doc.variableSymbol,
    },
  };
}

export function pohodaDocumentOf(doc: FormatDoc): PohodaDocument | null {
  if (doc.issueDate === null) return null;
  if (doc.lines.length === 0 && doc.vatSummary.length === 0) return null;
  const partner: PohodaPartner | null =
    doc.partner === null
      ? null
      : {
          name: doc.partner.name,
          ico: doc.partner.ico,
          dic: doc.partner.dic,
          street: doc.partner.street,
          city: doc.partner.city,
          zip: doc.partner.zip,
          country: doc.partner.country,
        };
  const method: PohodaPaymentMethod | null =
    doc.paymentMethod !== null && POHODA_PAYMENT.has(doc.paymentMethod)
      ? (doc.paymentMethod as PohodaPaymentMethod)
      : null;
  return {
    id: doc.id,
    revision: doc.revision,
    class: doc.cls as DocumentClass,
    issueDate: doc.issueDate,
    duzp: doc.duzp,
    receivedDate: doc.receivedDate,
    vatPointDate: doc.vatPointDate,
    dueDate: doc.dueDate,
    documentNumber: doc.number,
    variableSymbol: doc.variableSymbol,
    summary: doc.summary,
    currency: doc.currency,
    paymentMethod: method,
    payToAccount:
      doc.payToAccount === null || doc.payToAccount.bankCode === null
        ? null
        : { accountNumber: doc.payToAccount.account, bankCode: doc.payToAccount.bankCode },
    partner,
    lines: doc.lines.map((line) => ({ ...line })),
    vatSummary: doc.vatSummary.map((row) => ({
      vatRateType: row.vatRateType,
      base: row.base,
      vat: row.vat,
    })),
  };
}

export function pohodaProfileOf(
  org: FormatOrg,
  labels: ReadonlyMap<string, string>,
): PohodaProfile {
  return {
    vatStatus: org.vatStatus,
    ico: org.ico ?? '',
    classificationVAT: {},
    accounting: {},
    categoryLabel: (code) => labels.get(code) ?? code,
  };
}

// ---- loading ----

const CHUNK = 200;

const DOC_COLUMNS =
  'id, revision, class, direction, tax_doc_status, partner_snapshot, document_number, variable_symbol, issue_date, duzp, received_date, vat_point_date, due_date, summary_cs, currency, total_gross, payment_method, pay_to_account, document_vat_summary(vat_rate_type, vat_rate_pct, base, vat), document_lines(position, net, vat, gross, vat_rate_type, vat_rate_pct, vat_treatment, category_code)';

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** A numeric column as a 2-decimal string; PostgREST may send a JSON number. */
function decimalOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toFixed(2);
  return null;
}

function partnerOf(raw: unknown): FormatPartner | null {
  const snapshot = objectOf(raw);
  const name = textOf(snapshot?.name);
  if (snapshot === null || name === null) return null;
  const address = objectOf(snapshot.address);
  const pick = (key: string): string | null => textOf(address?.[key]) ?? textOf(snapshot[key]);
  return {
    name,
    ico: textOf(snapshot.ico),
    dic: textOf(snapshot.dic),
    country: textOf(snapshot.country) ?? pick('country'),
    street: pick('street'),
    city: pick('city'),
    zip: pick('zip'),
  };
}

function accountOf(raw: unknown): FormatDoc['payToAccount'] {
  const account = objectOf(raw);
  const number = textOf(account?.account);
  if (account === null || number === null) return null;
  return { account: number, bankCode: textOf(account.bank_code), iban: textOf(account.iban) };
}

function listOf(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const obj = objectOf(item);
    return obj === null ? [] : [obj];
  });
}

export function formatDocOf(raw: unknown): FormatDoc | null {
  const row = objectOf(raw);
  const id = textOf(row?.id);
  const cls = textOf(row?.class);
  if (row === null || id === null || cls === null) return null;
  const vatSummary = listOf(row.document_vat_summary).flatMap((item): FormatVatRow[] => {
    const base = decimalOf(item.base);
    const vat = decimalOf(item.vat);
    const pct = decimalOf(item.vat_rate_pct);
    const type = textOf(item.vat_rate_type);
    if (base === null || vat === null || pct === null || type === null) return [];
    return [{ vatRateType: type as VatRateType, vatRatePct: pct, base, vat }];
  });
  const lines = listOf(row.document_lines)
    .sort(
      (a, b) =>
        (typeof a.position === 'number' ? a.position : 0) -
        (typeof b.position === 'number' ? b.position : 0),
    )
    .flatMap((item): FormatLine[] => {
      const net = decimalOf(item.net);
      const vat = decimalOf(item.vat);
      const gross = decimalOf(item.gross);
      const type = textOf(item.vat_rate_type);
      const treatment = textOf(item.vat_treatment);
      if (net === null || vat === null || gross === null || type === null || treatment === null)
        return [];
      return [
        {
          net,
          vat,
          gross,
          vatRateType: type as VatRateType,
          vatRatePct: decimalOf(item.vat_rate_pct),
          vatTreatment: treatment as VatTreatment,
          categoryCode: textOf(item.category_code) ?? '',
        },
      ];
    });
  return {
    id,
    revision: typeof row.revision === 'number' ? row.revision : 1,
    cls,
    direction: textOf(row.direction),
    taxDocStatus: textOf(row.tax_doc_status),
    partner: partnerOf(row.partner_snapshot),
    number: textOf(row.document_number),
    variableSymbol: textOf(row.variable_symbol),
    issueDate: textOf(row.issue_date),
    duzp: textOf(row.duzp),
    receivedDate: textOf(row.received_date),
    vatPointDate: textOf(row.vat_point_date),
    dueDate: textOf(row.due_date),
    summary: textOf(row.summary_cs),
    currency: textOf(row.currency) ?? 'CZK',
    totalGross: decimalOf(row.total_gross),
    paymentMethod: textOf(row.payment_method),
    payToAccount: accountOf(row.pay_to_account),
    lines,
    vatSummary,
  };
}

/** Documents with lines and VAT summary, the firm and the category labels. Null on any error. */
export async function loadFormatData(
  supabase: SupabaseLike,
  orgId: string,
  documentIds: readonly string[],
): Promise<{ org: FormatOrg; docs: FormatDoc[]; labels: Map<string, string> } | null> {
  try {
    const docs: FormatDoc[] = [];
    for (let i = 0; i < documentIds.length; i += CHUNK) {
      const { data, error } = await supabase
        .from('documents')
        .select(DOC_COLUMNS)
        .eq('org_id', orgId)
        .in('id', documentIds.slice(i, i + CHUNK));
      if (error || !Array.isArray(data)) return null;
      for (const raw of data) {
        const doc = formatDocOf(raw);
        if (doc !== null) docs.push(doc);
      }
    }
    const orgRes = await supabase
      .from('organizations')
      .select('name, ico, dic')
      .eq('id', orgId)
      .maybeSingle();
    const org = objectOf(orgRes.data);
    const orgName = textOf(org?.name);
    if (orgRes.error || org === null || orgName === null) return null;
    const profileRes = await supabase
      .from('taxpayer_profiles')
      .select('valid_from, valid_to, vat_status')
      .eq('org_id', orgId);
    if (profileRes.error || !Array.isArray(profileRes.data)) return null;
    const today = new Date().toISOString().slice(0, 10);
    let best: { from: string; status: string } | null = null;
    for (const raw of listOf(profileRes.data)) {
      const from = textOf(raw.valid_from);
      const to = textOf(raw.valid_to);
      const status = textOf(raw.vat_status);
      if (from === null || status === null || from > today) continue;
      if (to !== null && to < today) continue;
      if (best === null || from > best.from) best = { from, status };
    }
    const catRes = await supabase.from('categories').select('code, label_cs');
    if (catRes.error || !Array.isArray(catRes.data)) return null;
    const labels = new Map<string, string>();
    for (const raw of listOf(catRes.data)) {
      const code = textOf(raw.code);
      const label = textOf(raw.label_cs);
      if (code !== null && label !== null) labels.set(code, label);
    }
    return {
      org: {
        name: orgName,
        ico: textOf(org.ico),
        dic: textOf(org.dic),
        vatStatus: (best?.status ?? 'neplatce') as VatStatus,
      },
      docs,
      labels,
    };
  } catch {
    return null;
  }
}
