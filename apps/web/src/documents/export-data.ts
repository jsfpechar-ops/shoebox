import type { createSupabaseServerClient } from '../supabase/server';
import type { ExportPeriod } from './export-period';
import { type RegisterRow, registerRowOf } from './register-data';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ExportDoc {
  readonly row: RegisterRow;
  readonly file: {
    readonly path: string;
    readonly mime: string;
    readonly size: number;
    readonly name: string | null;
  } | null;
}

const EXPORT_LIMIT = 10_000;

const EXPORT_COLUMNS =
  'id, status, class, entry_mode, source_file_id, partner_snapshot, document_number, variable_symbol, issue_date, duzp, due_date, currency, total_net, total_vat, total_gross, is_paid_per_document, paid_at, created_at, deleted_at, source_files(storage_path, mime_type, byte_size, original_filename)';

function fileOf(raw: unknown): ExportDoc['file'] {
  if (typeof raw !== 'object' || raw === null) return null;
  const joined = (raw as { source_files?: unknown }).source_files;
  const source = Array.isArray(joined) ? joined[0] : joined;
  if (typeof source !== 'object' || source === null) return null;
  const file = source as Record<string, unknown>;
  if (typeof file.storage_path !== 'string' || typeof file.mime_type !== 'string') return null;
  return {
    path: file.storage_path,
    mime: file.mime_type,
    size: typeof file.byte_size === 'number' ? file.byte_size : 0,
    name: typeof file.original_filename === 'string' ? file.original_filename : null,
  };
}

/** The register rows of one period, each with its original file when it has one. */
export async function loadExportDocs(
  supabase: SupabaseLike,
  orgId: string,
  period: ExportPeriod,
): Promise<ExportDoc[]> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select(EXPORT_COLUMNS)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .or(
        `and(issue_date.gte.${period.from},issue_date.lte.${period.to}),and(issue_date.is.null,duzp.gte.${period.from},duzp.lte.${period.to})`,
      )
      .order('issue_date', { ascending: true })
      .limit(EXPORT_LIMIT);
    if (error || !Array.isArray(data)) return [];
    return data.flatMap((raw) => {
      const row = registerRowOf(raw);
      return row === null ? [] : [{ row, file: fileOf(raw) }];
    });
  } catch {
    return [];
  }
}

export interface DocumentOverview {
  /** issue_date, or duzp when there is no issue date, of every document not in the trash. */
  readonly dates: string[];
  /** Documents with neither date. */
  readonly undated: number;
}

/** The dates of all the org's documents, for the period list and the empty-period hint. */
export async function loadDocumentOverview(
  supabase: SupabaseLike,
  orgId: string,
): Promise<DocumentOverview> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('issue_date, duzp')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .limit(EXPORT_LIMIT);
    if (error || !Array.isArray(data)) return { dates: [], undated: 0 };
    const dates: string[] = [];
    let undated = 0;
    for (const raw of data) {
      const r = raw as { issue_date?: unknown; duzp?: unknown };
      const date = typeof r.issue_date === 'string' ? r.issue_date : r.duzp;
      if (typeof date === 'string') dates.push(date);
      else undated += 1;
    }
    return { dates, undated };
  } catch {
    return { dates: [], undated: 0 };
  }
}

/** How many documents in the trash are dated in the period. */
export async function countTrashedInPeriod(
  supabase: SupabaseLike,
  orgId: string,
  period: ExportPeriod,
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .not('deleted_at', 'is', null)
      .or(
        `and(issue_date.gte.${period.from},issue_date.lte.${period.to}),and(issue_date.is.null,duzp.gte.${period.from},duzp.lte.${period.to})`,
      );
    return error || count === null ? 0 : count;
  } catch {
    return 0;
  }
}
