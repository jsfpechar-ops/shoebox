import type { DocumentClass, DocumentStatus, LegalDate } from '@shoebox/domain';
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const PROCESSING_STATUSES: readonly DocumentStatus[] = [
  'received',
  'splitting',
  'classifying',
  'extracting',
  'validating',
  'categorizing',
];

export interface InboxRow {
  readonly id: string;
  readonly status: DocumentStatus;
  readonly cls: DocumentClass;
  readonly title: string | null; // supplier name, else the original file name, else null
  readonly total: { value: string; currency: string } | null;
  readonly issueDate: LegalDate | null;
  readonly createdAt: string;
  readonly processing: boolean;
}

const INBOX_COLUMNS =
  'id, status, class, currency, total_gross, issue_date, created_at, partner_snapshot, source_files(original_filename)';

function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Maps one `documents` row from the inbox query; null for a row of the wrong shape. */
export function inboxRowOf(raw: unknown): InboxRow | null {
  const row = objectOf(raw);
  if (row === null) return null;
  const id = textOf(row.id);
  const status = textOf(row.status);
  const cls = textOf(row.class);
  const createdAt = textOf(row.created_at);
  if (id === null || status === null || cls === null || createdAt === null) return null;

  const supplier = textOf(objectOf(row.partner_snapshot)?.name);
  const sourceFile = Array.isArray(row.source_files) ? row.source_files[0] : row.source_files;
  const fileName = textOf(objectOf(sourceFile)?.original_filename);

  const amount = textOf(row.total_gross);
  const currency = textOf(row.currency);
  const issueDate = textOf(row.issue_date);

  return {
    id,
    status: status as DocumentStatus,
    cls: cls as DocumentClass,
    title: supplier ?? fileName ?? null,
    total: amount !== null && currency !== null ? { value: amount, currency } : null,
    issueDate: issueDate as LegalDate | null,
    createdAt,
    processing: PROCESSING_STATUSES.includes(status as DocumentStatus),
  };
}

/** The org's latest 100 documents, newest first. Any error gives an empty list. */
export async function loadInbox(supabase: SupabaseLike, orgId: string): Promise<InboxRow[]> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select(INBOX_COLUMNS)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error || !Array.isArray(data)) return [];
    return data.flatMap((raw) => {
      const row = inboxRowOf(raw);
      return row === null ? [] : [row];
    });
  } catch {
    return [];
  }
}
