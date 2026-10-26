import { requireActiveRole } from '../../../../../../../src/auth/org-context';
import { enqueueVatWorkbookGenerate } from '../../../../../../../src/documents/enqueue';
import { appOrigin } from '../../../../../../../src/supabase/server';
import { FILING_DOWNLOAD_ROLES } from '../../../../../../../src/vat/filings';
import { parsePeriodStart } from '../../../../../../../src/vat/periods';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ periodStart: string }> },
): Promise<Response> {
  if (request.headers.get('origin') !== appOrigin())
    return Response.json({ error: 'origin' }, { status: 403 });
  const auth = await requireActiveRole(FILING_DOWNLOAD_ROLES);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const periodStart = parsePeriodStart((await params).periodStart);
  if (periodStart === null) return Response.json({ error: 'bad_period' }, { status: 400 });
  try {
    const jobId = await enqueueVatWorkbookGenerate(auth.orgId, periodStart, auth.userId);
    return Response.json({ jobId }, { status: 202 });
  } catch {
    return Response.json({ error: 'enqueue_failed' }, { status: 500 });
  }
}
