import { previewImport } from '../../../../../../src/imports/handlers';
import { guardImportRequest, sendResult } from '../../../../../../src/imports/http';
import { supabaseImportDeps } from '../../../../../../src/imports/supabase-deps';

/** POST /api/v1/imports/{id}/preview: the preview for the mapping and options in the body. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guardImportRequest(request, true);
  if (!guarded.ok) return guarded.response;
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  return sendResult(
    await previewImport(supabaseImportDeps(guarded.supabase), guarded.auth, id, body),
  );
}
