import { requireActiveRole } from '../../../../../src/auth/org-context';
import { enqueueDocCategorize } from '../../../../../src/documents/enqueue';
import { parseReprocess, resetVendorMemory } from '../../../../../src/documents/vendor-memory';
import { appOrigin, createSupabaseServerClient } from '../../../../../src/supabase/server';

export const runtime = 'nodejs';

/** "Forget what you learned": clears the vendor's category memory; `?reprocess=true` re-queues its open documents. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (request.headers.get('origin') !== appOrigin())
    return Response.json({ error: 'origin' }, { status: 403 });
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const { id } = await params;
  const reprocess = parseReprocess(new URL(request.url).searchParams.get('reprocess'));
  const supabase = await createSupabaseServerClient();
  const result = await resetVendorMemory(supabase, { orgId: auth.orgId, profileId: id });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  if (reprocess) {
    for (const d of result.openDocuments) {
      await enqueueDocCategorize(auth.orgId, d.id, d.revision, 'user_reprocess');
    }
  }
  return Response.json({
    reset: true,
    reprocessed: reprocess ? result.openDocuments.length : 0,
  });
}
