import { pragueToday } from '@shoebox/domain';
import { requireActiveRole } from '../../../../../../src/auth/org-context';
import { loadPodkladyPreview } from '../../../../../../src/podklady/load';
import { PODKLADY_READ_ROLES, parseYearParam } from '../../../../../../src/podklady/preview';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ year: string }> },
): Promise<Response> {
  const auth = await requireActiveRole(PODKLADY_READ_ROLES);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const year = parseYearParam((await params).year, pragueToday({ now: () => Date.now() }));
  if (year === null) return Response.json({ error: 'bad_year' }, { status: 400 });
  const view = await loadPodkladyPreview(auth.orgId, year, auth.role);
  return Response.json(view, { headers: { 'Cache-Control': 'private, no-store' } });
}
