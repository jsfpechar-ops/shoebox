import { undoImport } from '../../../../../../src/imports/handlers';
import { guardImportRequest, sendResult } from '../../../../../../src/imports/http';
import { supabaseImportDeps } from '../../../../../../src/imports/supabase-deps';

/** POST /api/v1/imports/{id}/undo: queues the undo (410 when the import is older than 30 days). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guardImportRequest(request, true);
  if (!guarded.ok) return guarded.response;
  const { id } = await params;
  return sendResult(await undoImport(supabaseImportDeps(guarded.supabase), guarded.auth, id));
}
