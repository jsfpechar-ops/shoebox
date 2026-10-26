import { registerRowOf, type RegisterRow } from './register-data';
import type { ExportPeriod } from './export-period';
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ExportDoc {
  readonly row: RegisterRow;
  readonly file: { readonly path: string; readonly mime: string; readonly size: number; readonly name: string | null } | null;
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
      .gte('issue_date', period.from)
      .lte('issue_date', period.to)
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
