// One batch of retention.trash_purge (M12 §4.6) over app.purge_trash (migration 0052).
import { sql } from 'drizzle-orm';
import type { ServiceTx } from './tenant';

export interface TrashPurge {
  /** Documents deleted in this batch. */
  readonly documents: number;
  /** Storage paths (source files, raw model answers) the caller removes from the bucket. */
  readonly paths: readonly string[];
}

/** Deletes up to `limit` documents trashed before `cutoff`. Run inside withServiceRole('retention'). */
export async function purgeTrash(
  tx: ServiceTx,
  cutoff: Date,
  today: string,
  limit: number,
): Promise<TrashPurge> {
  const rows = await tx.execute<{ kind: string; path: string | null }>(
    sql`select kind, path from app.purge_trash(${cutoff.toISOString()}::timestamptz, ${today}::date, ${limit}::int)`,
  );
  let documents = 0;
  const paths: string[] = [];
  for (const row of rows) {
    if (row.kind === 'document') documents += 1;
    else if (row.path) paths.push(row.path);
  }
  return { documents, paths };
}
