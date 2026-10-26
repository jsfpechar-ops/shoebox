import { requireActiveRole } from '../../../../../src/auth/org-context';
import { loadTaxReserve } from '../../../../../src/podklady/load';
import { PODKLADY_READ_ROLES } from '../../../../../src/podklady/preview';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const auth = await requireActiveRole(PODKLADY_READ_ROLES);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const view = await loadTaxReserve(auth.orgId);
  return Response.json(view, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
