import { requireActiveRole } from '../../../src/auth/org-context';
import { supabaseUploadDeps } from '../../../src/documents/supabase-deps';
import { UPLOAD_MAX_FILES, type UploadFile, uploadDocuments } from '../../../src/documents/upload';
import { appOrigin, createSupabaseServerClient } from '../../../src/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== appOrigin())
    return Response.json({ error: 'origin' }, { status: 403 });
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const form = await request.formData();
  const entries = form.getAll('files').filter((value): value is File => value instanceof File);
  if (entries.length === 0 || entries.length > UPLOAD_MAX_FILES)
    return Response.json({ error: 'count' }, { status: 400 });
  const files: UploadFile[] = await Promise.all(
    entries.map(async (file) => ({
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
  const supabase = await createSupabaseServerClient();
  const items = await uploadDocuments(
    supabaseUploadDeps(supabase),
    { orgId: auth.orgId, userId: auth.userId },
    files,
  );
  return Response.json({ items });
}
