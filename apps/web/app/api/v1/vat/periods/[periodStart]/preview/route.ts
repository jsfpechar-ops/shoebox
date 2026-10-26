import { requireActiveRole } from '../../../../../../../src/auth/org-context';
import { createSupabaseServerClient } from '../../../../../../../src/supabase/server';
import { FILING_READ_ROLES } from '../../../../../../../src/vat/filings';
import {
  computePreview,
  loadPreviewInputs,
  parseForm,
  parsePeriodStart,
} from '../../../../../../../src/vat/periods';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ periodStart: string }> },
): Promise<Response> {
  const auth = await requireActiveRole(FILING_READ_ROLES);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const periodStart = parsePeriodStart((await params).periodStart);
  if (periodStart === null) return Response.json({ error: 'bad_period' }, { status: 400 });
  const form = parseForm(new URL(request.url).searchParams.get('form'));
  if (form === null) return Response.json({ error: 'bad_form' }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  try {
    const inputs = await loadPreviewInputs(supabase, auth.orgId, periodStart);
    if (inputs === null) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(computePreview(form, inputs), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'preview_failed' }, { status: 500 });
  }
}
