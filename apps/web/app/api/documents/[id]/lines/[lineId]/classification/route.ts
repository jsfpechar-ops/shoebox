import { requireActiveRole } from '../../../../../../../src/auth/org-context';
import {
  parseClassificationPatch,
  storeClassificationPatch,
} from '../../../../../../../src/documents/classification';
import { enqueueDocCategorize } from '../../../../../../../src/documents/enqueue';
import { appOrigin, createSupabaseServerClient } from '../../../../../../../src/supabase/server';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> },
): Promise<Response> {
  if (request.headers.get('origin') !== appOrigin())
    return Response.json({ error: 'origin' }, { status: 403 });
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const patch = parseClassificationPatch(await request.json().catch(() => null));
  if (patch === null) return Response.json({ error: 'body' }, { status: 400 });
  const { id, lineId } = await params;
  const supabase = await createSupabaseServerClient();
  const result = await storeClassificationPatch(supabase, {
    orgId: auth.orgId,
    userId: auth.userId,
    documentId: id,
    lineId,
    patch,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  await enqueueDocCategorize(auth.orgId, result.documentId, result.revision, 'user_reprocess');
  return Response.json({ documentId: result.documentId, status: 'queued' }, { status: 202 });
}
