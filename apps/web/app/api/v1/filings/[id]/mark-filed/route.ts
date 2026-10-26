import { pragueToday } from '@shoebox/domain';
import { isUuid } from '../../../../../../src/auth/authz';
import { requireActiveRole } from '../../../../../../src/auth/org-context';
import { appOrigin, createSupabaseServerClient } from '../../../../../../src/supabase/server';
import {
  applyMarkFiled,
  decideMarkFiled,
  FILING_WRITE_ROLES,
  loadAmendsFilingId,
  loadFiling,
} from '../../../../../../src/vat/filings';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (request.headers.get('origin') !== appOrigin())
    return Response.json({ error: 'origin' }, { status: 403 });
  const auth = await requireActiveRole(FILING_WRITE_ROLES);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  const supabase = await createSupabaseServerClient();
  const filing = await loadFiling(supabase, auth.orgId, id);
  const amends =
    filing?.kind === 'opravne' ? await loadAmendsFilingId(supabase, auth.orgId, id) : null;
  const decision = decideMarkFiled(filing, body, pragueToday({ now: () => Date.now() }), amends);
  if (!decision.ok) return Response.json({ error: decision.error }, { status: decision.status });
  if (filing === null) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    await applyMarkFiled(supabase, auth.orgId, filing, decision, new Date());
  } catch {
    return Response.json({ error: 'save_failed' }, { status: 500 });
  }
  // biome-ignore lint/suspicious/noConsole: TODO(audit), the web app has no audit helper yet
  console.info(JSON.stringify({ event: 'filing.marked_filed', filingId: filing.id }));
  return Response.json({ state: 'marked_filed' }, { headers: { 'Cache-Control': 'no-store' } });
}
