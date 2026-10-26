import type { DocumentClass, DocumentStatus, LegalDate } from '@shoebox/domain';
import type { XlsxCell } from '@shoebox/exports';
import { t } from '@shoebox/i18n';
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type PaidFilter = 'all' | 'paid' | 'unpaid';
export interface RegisterFilter { readonly year: number | null; readonly paid: PaidFilter; readonly q: string }
export interface RegisterRow {
  readonly id: string; readonly status: DocumentStatus; readonly cls: DocumentClass;
  readonly date: LegalDate | null; // issue_date ?? duzp ?? null
  readonly partner: string | null; readonly ico: string | null; readonly dic: string | null;
  readonly number: string | null; readonly variableSymbol: string | null;
  readonly gross: string | null; readonly net: string | null; readonly vat: string | null;
  readonly currency: string; readonly due: LegalDate | null; readonly duzp: LegalDate | null;
  readonly paid: 'paid' | 'unpaid' | 'none'; // paid_at or is_paid_per_document → paid; else gross present → unpaid; else none
  readonly paidAt: LegalDate | null;
  readonly hasFile: boolean; // source_file_id not null
  readonly manual: boolean; // entry_mode === 'manual'
}

export const REGISTER_LIMIT = 10_000;

const REGISTER_COLUMNS =
  'id, status, class, entry_mode, source_file_id, partner_snapshot, document_number, variable_symbol, issue_date, duzp, due_date, currency, total_net, total_vat, total_gross, is_paid_per_document, paid_at, created_at, deleted_at';

function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Maps one `documents` row from the register query; null for a row of the wrong shape. */
export function registerRowOf(raw: unknown): RegisterRow | null {
  const row = objectOf(raw);
  if (row === null) return null;
  const id = textOf(row.id);
  const status = textOf(row.status);
  const cls = textOf(row.class);
  if (id === null || status === null || cls === null) return null;

  const partner = objectOf(row.partner_snapshot);
  const issueDate = textOf(row.issue_date);
  const duzp = textOf(row.duzp);
  const dueDate = textOf(row.due_date);
  const paidAt = textOf(row.paid_at);
  const gross = textOf(row.total_gross);
  const paid =
    paidAt !== null || row.is_paid_per_document === true
      ? 'paid'
      : gross !== null
        ? 'unpaid'
        : 'none';

  return {
    id,
    status: status as DocumentStatus,
    cls: cls as DocumentClass,
    date: (issueDate ?? duzp ?? null) as LegalDate | null,
    partner: textOf(partner?.name),
    ico: textOf(partner?.ico),
    dic: textOf(partner?.dic),
    number: textOf(row.document_number),
    variableSymbol: textOf(row.variable_symbol),
    gross,
    net: textOf(row.total_net),
    vat: textOf(row.total_vat),
    currency: textOf(row.currency) ?? '',
    due: dueDate as LegalDate | null,
    duzp: duzp as LegalDate | null,
    paid,
    paidAt: paidAt === null ? null : (paidAt.slice(0, 10) as LegalDate),
    hasFile: textOf(row.source_file_id) !== null,
    manual: row.entry_mode === 'manual',
  };
}

/** Reads year, paid and search text from the URL; anything unknown is ignored. */
export function parseRegisterFilter(params: URLSearchParams): RegisterFilter {
  const yearText = params.get('year');
  const year = yearText !== null && /^\d{4}$/.test(yearText) ? Number(yearText) : null;
  const paidText = params.get('paid');
  const paid: PaidFilter = paidText === 'paid' || paidText === 'unpaid' ? paidText : 'all';
  const q = (params.get('q') ?? '').trim().slice(0, 100);
  return {
    year: year !== null && year >= 2000 && year <= 2100 ? year : null,
    paid,
    q,
  };
}

/** The rows of the filtered register view, in the order given. */
export function applyRegisterFilter(
  rows: readonly RegisterRow[],
  filter: RegisterFilter,
): RegisterRow[] {
  const needle = filter.q.toLowerCase();
  return rows.filter((row) => {
    if (filter.year !== null && (row.date === null || row.date.slice(0, 4) !== String(filter.year))) {
      return false;
    }
    if (filter.paid === 'paid' && row.paid !== 'paid') return false;
    if (filter.paid === 'unpaid' && row.paid !== 'unpaid') return false;
    if (needle === '') return true;
    return [row.partner, row.number, row.variableSymbol, row.ico, row.dic].some((field) =>
      (field ?? '').toLowerCase().includes(needle),
    );
  });
}

function moneyCell(value: string | null): XlsxCell {
  return value === null ? null : { num: value };
}

/** The Excel sheet: a header row, then one row per document. */
export function registerSheet(rows: readonly RegisterRow[]): XlsxCell[][] {
  const header: XlsxCell[] = [
    t('register.col.date'),
    t('register.col.partner'),
    t('register.col.ico'),
    t('register.col.dic'),
    t('register.col.number'),
    t('register.col.variable_symbol'),
    t('register.col.gross'),
    t('register.col.net'),
    t('register.col.vat'),
    t('register.col.currency'),
    t('register.col.due'),
    t('register.col.duzp'),
    t('register.col.paid'),
    t('register.col.file'),
  ];
  const body = rows.map((row): XlsxCell[] => [
    row.date,
    row.partner,
    row.ico,
    row.dic,
    row.number,
    row.variableSymbol,
    moneyCell(row.gross),
    moneyCell(row.net),
    moneyCell(row.vat),
    row.currency,
    row.due,
    row.duzp,
    row.paid === 'paid'
      ? t('register.paid.yes')
      : row.paid === 'unpaid'
        ? t('register.paid.no')
        : t('register.paid.none'),
    row.hasFile ? t('register.file.yes') : t('register.file.manual'),
  ]);
  return [header, ...body];
}

/** The download file name: by year when the view is one year. */
export function registerFileName(filter: RegisterFilter): string {
  return filter.year !== null ? `sysel-documents-${filter.year}.xlsx` : 'sysel-documents.xlsx';
}

/** The org's documents for the register, newest first. Any error gives an empty list. */
export async function loadRegister(supabase: SupabaseLike, orgId: string): Promise<RegisterRow[]> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select(REGISTER_COLUMNS)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('issue_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(REGISTER_LIMIT);
    if (error || !Array.isArray(data)) return [];
    return data.flatMap((raw) => {
      const row = registerRowOf(raw);
      return row === null ? [] : [row];
    });
  } catch {
    return [];
  }
}
