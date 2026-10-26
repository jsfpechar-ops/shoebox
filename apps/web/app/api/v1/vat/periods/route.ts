import { pragueToday } from '@shoebox/domain';
import { requireActiveRole } from '../../../../../src/auth/org-context';
import { createSupabaseServerClient } from '../../../../../src/supabase/server';
import { FILING_READ_ROLES } from '../../../../../src/vat/filings';
import { buildPeriodCards, loadPeriodCardInputs, parseYear } from '../../../../../src/vat/periods';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireActiveRole(FILING_READ_ROLES);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const today = pragueToday({ now: () => Date.now() });
  const year = parseYear(new URL(request.url).searchParams.get('year'), today);
  if (year === null) return Response.json({ error: 'bad_year' }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  let inputs: Awaited<ReturnType<typeof loadPeriodCardInputs>>;
  try {
    inputs = await loadPeriodCardInputs(supabase, auth.orgId, year, today);
  } catch {
    return Response.json({ error: 'load_failed' }, { status: 500 });
  }
  const cards = inputs === null ? [] : buildPeriodCards(inputs);
  return Response.json({ year, cards }, { headers: { 'Cache-Control': 'no-store' } });
}
