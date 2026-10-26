import type { createSupabaseServerClient } from '../supabase/server';
import { enqueueDocExtract } from './enqueue';

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ReadAgainDeps {
  /** Moves the org's document from `failed` back to `received`. False when it was not `failed` (or not found). */
  markReceived(orgId: string, documentId: string): Promise<boolean>;
  enqueue(orgId: string, documentId: string, retry: string): Promise<void>;
  now(): number;
}

/**
 * Restarts the read of a document that could not be read. True when it was restarted.
 * A queue failure is swallowed: the document stays `received`, as after an upload.
 */
export async function restartFailedRead(
  deps: ReadAgainDeps,
  orgId: string,
  documentId: string,
): Promise<boolean> {
  const restarted = await deps.markReceived(orgId, documentId);
  if (!restarted) return false;
  try {
    await deps.enqueue(orgId, documentId, String(deps.now()));
  } catch {
    // The queue is down: the document stays `received` and is still restarted.
  }
  return true;
}

/** Supabase-backed deps (RLS applies): update documents set status='received' where id, org_id, status='failed', deleted_at is null; select id. */
export function supabaseReadAgainDeps(supabase: SupabaseServerClient): ReadAgainDeps {
  return {
    async markReceived(orgId, documentId) {
      const { data, error } = await supabase
        .from('documents')
        .update({ status: 'received' })
        .eq('id', documentId)
        .eq('org_id', orgId)
        .eq('status', 'failed')
        .is('deleted_at', null)
        .select('id');
      if (error) throw new Error('documents');
      return data.length > 0;
    },
    enqueue: enqueueDocExtract,
    now: Date.now,
  };
}
