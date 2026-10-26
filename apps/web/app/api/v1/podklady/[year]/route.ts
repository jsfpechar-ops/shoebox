import { pragueToday } from '@shoebox/domain';
import { requireActiveRole } from '../../../../../src/auth/org-context';
import { enqueuePodkladyGenerate } from '../../../../../src/documents/enqueue';
import { podkladyDb } from '../../../../../src/podklady/db';
import { decideGenerate, storeAnswersDraft } from '../../../../../src/podklady/generate';
import { PODKLADY_WRITE_ROLES, parseYearParam } from '../../../../../src/podklady/preview';
import { appOrigin } from '../../../../../src/supabase/server';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ year: string }> },
): Promise<Response> {
  if (request.headers.get('origin') !== appOrigin())
    return Response.json({ error: 'origin' }, { status: 403 });
  const auth = await requireActiveRole(PODKLADY_WRITE_ROLES);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const year = parseYearParam((await params).year, pragueToday({ now: () => Date.now() }));
  if (year === null) return Response.json({ error: 'bad_year' }, { status: 400 });
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const decision = decideGenerate(auth.role, body);
  if (!decision.ok) return Response.json({ error: decision.code }, { status: decision.status });
  const stored = await storeAnswersDraft(
    podkladyDb(),
    auth.orgId,
    year,
    decision.answers,
    auth.userId,
  );
  await enqueuePodkladyGenerate(auth.orgId, year, stored.answersVersion, auth.userId);
  return Response.json(stored, { status: 202 });
}
