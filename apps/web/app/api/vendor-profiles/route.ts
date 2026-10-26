import { requireActiveRole } from '../../../src/auth/org-context';
import { listVendorProfiles } from '../../../src/documents/vendor-memory';
import { createSupabaseServerClient } from '../../../src/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireActiveRole(['owner', 'member', 'accountant', 'viewer']);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const partnerId = new URL(request.url).searchParams.get('partner_id') || null;
  const supabase = await createSupabaseServerClient();
  const profiles = await listVendorProfiles(supabase, { orgId: auth.orgId, partnerId });
  return Response.json({ profiles });
}
