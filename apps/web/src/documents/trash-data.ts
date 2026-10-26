import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface TrashRow {
  readonly id: string;
  readonly title: string | null;
  readonly deletedAt: string;
}

const TRASH_COLUMNS = 'id, deleted_at, partner_snapshot, source_files(original_filename)';

function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function trashRowOf(raw: unknown): TrashRow | null {
  const row = objectOf(raw);
  if (row === null) return null;
  const id = textOf(row.id);
  const deletedAt = textOf(row.deleted_at);
  if (id === null || deletedAt === null) return null;

  const supplier = textOf(objectOf(row.partner_snapshot)?.name);
  const sourceFile = Array.isArray(row.source_files) ? row.source_files[0] : row.source_files;
  const fileName = textOf(objectOf(sourceFile)?.original_filename);

  return { id, title: supplier ?? fileName ?? null, deletedAt };
}

/** The org's trashed documents, most recently moved first. Any error gives an empty list. */
export async function loadTrash(supabase: SupabaseLike, orgId: string): Promise<TrashRow[]> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select(TRASH_COLUMNS)
      .eq('org_id', orgId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(200);
    if (error || !Array.isArray(data)) return [];
    return data.flatMap((raw) => {
      const row = trashRowOf(raw);
      return row === null ? [] : [row];
    });
  } catch {
    return [];
  }
}
