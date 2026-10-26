import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Data access for a duplicate document; every call is scoped to one org. */
export interface DuplicateStore {
  /** Id of the document this one repeats, or null. */
  originalOf(documentId: string): Promise<string | null>;
  statusOf(documentId: string): Promise<string | null>;
  openBlockingCount(documentId: string): Promise<number>;
  /** Sets semantic_dedupe_exempt, the new status, and deletes the duplicate_of link. */
  keep(documentId: string, status: 'ready' | 'needs_review'): Promise<void>;
}

export type KeepBothResult = { ok: true; status: 'ready' | 'needs_review' } | { ok: false };

/** "These are two different invoices": a duplicate goes back to the normal flow. */
export async function keepBoth(store: DuplicateStore, documentId: string): Promise<KeepBothResult> {
  try {
    if ((await store.statusOf(documentId)) !== 'duplicate') return { ok: false };
    const status = (await store.openBlockingCount(documentId)) > 0 ? 'needs_review' : 'ready';
    await store.keep(documentId, status);
    return { ok: true, status };
  } catch {
    return { ok: false };
  }
}

export function supabaseDuplicateStore(supabase: SupabaseLike, orgId: string): DuplicateStore {
  return {
    async originalOf(documentId) {
      const { data, error } = await supabase
        .from('document_links')
        .select('to_document_id')
        .eq('org_id', orgId)
        .eq('from_document_id', documentId)
        .eq('kind', 'duplicate_of')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error('duplicate link read failed');
      return typeof data?.to_document_id === 'string' ? data.to_document_id : null;
    },
    async statusOf(documentId) {
      const { data, error } = await supabase
        .from('documents')
        .select('status')
        .eq('org_id', orgId)
        .eq('id', documentId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new Error('document read failed');
      return typeof data?.status === 'string' ? data.status : null;
    },
    async openBlockingCount(documentId) {
      const { count, error } = await supabase
        .from('validation_results')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('document_id', documentId)
        .eq('state', 'open')
        .eq('severity', 'blocking');
      if (error) throw new Error('checks read failed');
      return count ?? 0;
    },
    async keep(documentId, status) {
      const { error: linkError } = await supabase
        .from('document_links')
        .delete()
        .eq('org_id', orgId)
        .eq('from_document_id', documentId)
        .eq('kind', 'duplicate_of');
      if (linkError) throw new Error('link delete failed');
      const { error } = await supabase
        .from('documents')
        .update({ semantic_dedupe_exempt: true, status })
        .eq('org_id', orgId)
        .eq('id', documentId);
      if (error) throw new Error('document update failed');
    },
  };
}
