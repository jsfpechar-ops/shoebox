import { getImport } from '../../../../../src/imports/handlers';
import { guardImportRequest, sendResult } from '../../../../../src/imports/http';
import { supabaseImportDeps } from '../../../../../src/imports/supabase-deps';

/** GET /api/v1/imports/{id}: the state and the counts of one import. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = await guardImportRequest(request, false);
  if (!guarded.ok) return guarded.response;
  const { id } = await params;
  return sendResult(await getImport(supabaseImportDeps(guarded.supabase), guarded.auth, id));
}
