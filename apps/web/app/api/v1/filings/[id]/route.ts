import { isUuid } from '../../../../../src/auth/authz';
import { requireActiveRole } from '../../../../../src/auth/org-context';
import { createSupabaseServerClient } from '../../../../../src/supabase/server';
import { FILING_READ_ROLES, loadFiling } from '../../../../../src/vat/filings';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireActiveRole(FILING_READ_ROLES);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 });
  const supabase = await createSupabaseServerClient();
  const filing = await loadFiling(supabase, auth.orgId, id);
  if (filing === null) return Response.json({ error: 'not_found' }, { status: 404 });
  // The stored XML path never leaves the server, whatever the role.
  const { xmlPath: _xmlPath, ...view } = filing;
  return Response.json(view, { headers: { 'Cache-Control': 'no-store' } });
}
