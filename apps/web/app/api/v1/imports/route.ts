import { IMPORT_LIMITS } from '@shoebox/pipeline';
import { createImport } from '../../../../src/imports/handlers';
import { guardImportRequest, sendResult } from '../../../../src/imports/http';
import { supabaseImportDeps } from '../../../../src/imports/supabase-deps';

export const runtime = 'nodejs';

/** POST /api/v1/imports (multipart `file`): stores the spreadsheet and returns its first preview. */
export async function POST(request: Request): Promise<Response> {
  const guarded = await guardImportRequest(request, true);
  if (!guarded.ok) return guarded.response;
  const form = await request.formData();
  const entry = form.get('file');
  if (!(entry instanceof File))
    return sendResult({ status: 422, body: { error: 'import.unsupported' } });
  if (entry.size > IMPORT_LIMITS.bytes)
    return sendResult({ status: 413, body: { error: 'import.too_large' } });
  return sendResult(
    await createImport(supabaseImportDeps(guarded.supabase), guarded.auth, {
      name: entry.name,
      type: entry.type,
      bytes: new Uint8Array(await entry.arrayBuffer()),
    }),
  );
}
