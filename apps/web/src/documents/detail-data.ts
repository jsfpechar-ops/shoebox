import type { DocumentClass, DocumentStatus } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import { catalogs, t } from '@shoebox/i18n';
import type { createSupabaseServerClient } from '../supabase/server';

export interface DetailField {
  readonly label: MessageKey;
  readonly value: string;
  readonly kind: 'text' | 'date' | 'money';
}
export interface DetailCheck {
  readonly severity: 'blocking' | 'warning';
  readonly key: MessageKey;
  readonly params: Record<string, string | number>;
}
export interface DocumentDetail {
  readonly id: string;
  readonly status: DocumentStatus;
  readonly cls: DocumentClass;
  readonly title: string | null;
  readonly currency: string;
  readonly createdAt: string;
  readonly fields: readonly DetailField[];
  readonly vatLines: readonly { rate: string; base: string; vat: string }[];
  readonly checks: readonly DetailCheck[]; // blocking first, then warning
  readonly file: {
    readonly path: string;
    readonly mimeType: string;
    readonly name: string | null;
  } | null;
}

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Row = Record<string, unknown>;

const DOCUMENT_COLUMNS =
  'id, status, class, currency, total_net, total_vat, total_gross, issue_date, duzp, due_date, document_number, variable_symbol, partner_snapshot, pay_to_account, created_at, source_files(storage_path, mime_type, original_filename)';

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function scalar(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

function isKey(key: string): key is MessageKey {
  return Object.hasOwn(catalogs.en, key);
}

/** Builds the page model from the three raw rows. Pure; null when the document row is malformed. */
export function detailOf(doc: unknown, vat: unknown, checks: unknown): DocumentDetail | null {
  if (!isRow(doc)) return null;
  const id = text(doc.id);
  const status = text(doc.status);
  const cls = text(doc.class);
  const currency = text(doc.currency);
  const createdAt = text(doc.created_at);
  if (id === null || status === null || cls === null || currency === null || createdAt === null)
    return null;

  const partner: Row = isRow(doc.partner_snapshot) ? doc.partner_snapshot : {};
  const pay: Row = isRow(doc.pay_to_account) ? doc.pay_to_account : {};

  const fields: DetailField[] = [];
  const add = (label: MessageKey, value: string | null, kind: DetailField['kind']) => {
    if (value !== null) fields.push({ label, value, kind });
  };
  add('proto.field.supplier_name', text(partner.name), 'text');
  add('proto.field.supplier_ico', text(partner.ico), 'text');
  add('proto.field.supplier_dic', text(partner.dic), 'text');
  add('proto.field.document_number', text(doc.document_number), 'text');
  add('proto.field.variable_symbol', text(doc.variable_symbol), 'text');
  add('proto.field.issue_date', scalar(doc.issue_date), 'date');
  add('doc.field.duzp', scalar(doc.duzp), 'date');
  add('proto.field.due_date', scalar(doc.due_date), 'date');
  add('proto.field.total_net', scalar(doc.total_net), 'money');
  add('proto.field.total_vat', scalar(doc.total_vat), 'money');
  add('proto.field.total_gross', scalar(doc.total_gross), 'money');
  const account = text(pay.account);
  const bankCode = text(pay.bank_code);
  if (account !== null)
    add('proto.field.account', bankCode !== null ? `${account}/${bankCode}` : account, 'text');
  add('proto.field.iban', text(pay.iban), 'text');

  const vatLines = (Array.isArray(vat) ? vat : []).flatMap((row) => {
    if (!isRow(row)) return [];
    const rate = scalar(row.vat_rate_pct);
    const base = scalar(row.base);
    const vatAmount = scalar(row.vat);
    return rate !== null && base !== null && vatAmount !== null
      ? [{ rate, base, vat: vatAmount }]
      : [];
  });

  const detailChecks: DetailCheck[] = [];
  for (const row of Array.isArray(checks) ? checks : []) {
    if (!isRow(row) || !isRow(row.params)) continue;
    const messageKey = text(row.params.messageKey);
    if (messageKey === null || !isKey(messageKey)) continue;
    const params: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(row.params)) {
      if (name === 'messageKey') continue;
      if (typeof value === 'string' || typeof value === 'number') params[name] = value;
    }
    const field = params.field;
    if (typeof field === 'string' && isKey(`proto.field.${field}`)) {
      params.field = t(`proto.field.${field}` as MessageKey);
    }
    detailChecks.push({
      severity: row.severity === 'blocking' ? 'blocking' : 'warning',
      key: messageKey,
      params,
    });
  }
  detailChecks.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1));

  const sourceFile = (Array.isArray(doc.source_files) ? doc.source_files : []).find(
    (row): row is Row => isRow(row) && text(row.storage_path) !== null,
  );
  const file = sourceFile
    ? {
        path: text(sourceFile.storage_path) as string,
        mimeType: text(sourceFile.mime_type) ?? 'application/octet-stream',
        name: text(sourceFile.original_filename),
      }
    : null;

  return {
    id,
    status: status as DocumentStatus,
    cls: cls as DocumentClass,
    title: text(partner.name),
    currency,
    createdAt,
    fields,
    vatLines,
    checks: detailChecks,
    file,
  };
}

/** Loads one document for the org (RLS applies too). Returns null when missing, not visible or on any error. */
export async function loadDocumentDetail(
  supabase: SupabaseLike,
  orgId: string,
  id: string,
): Promise<DocumentDetail | null> {
  try {
    const [docResult, vatResult, checkResult] = await Promise.all([
      supabase
        .from('documents')
        .select(DOCUMENT_COLUMNS)
        .eq('id', id)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase
        .from('document_vat_summary')
        .select('vat_rate_pct, base, vat')
        .eq('document_id', id)
        .order('vat_rate_pct', { ascending: false }),
      supabase
        .from('validation_results')
        .select('rule_id, severity, params')
        .eq('document_id', id)
        .eq('state', 'open'),
    ]);
    if (docResult.error || vatResult.error || checkResult.error) return null;
    return detailOf(docResult.data, vatResult.data, checkResult.data);
  } catch {
    return null;
  }
}
