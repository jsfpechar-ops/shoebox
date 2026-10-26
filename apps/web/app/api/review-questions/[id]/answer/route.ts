import { requireActiveRole } from '../../../../../src/auth/org-context';
import { parseAnswerBody, storeAnswer } from '../../../../../src/documents/classification';
import { enqueueDocCategorize } from '../../../../../src/documents/enqueue';
import { appOrigin, createSupabaseServerClient } from '../../../../../src/supabase/server';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (request.headers.get('origin') !== appOrigin())
    return Response.json({ error: 'origin' }, { status: 403 });
  const auth = await requireActiveRole(['owner', 'member', 'accountant']);
  if (!auth.ok)
    return Response.json(
      { error: auth.code },
      { status: auth.code === 'unauthenticated' ? 401 : 403 },
    );
  const body = parseAnswerBody(await request.json().catch(() => null));
  if (body === null) return Response.json({ error: 'body' }, { status: 400 });
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const result = await storeAnswer(supabase, {
    orgId: auth.orgId,
    userId: auth.userId,
    questionId: id,
    value: body.value,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  await enqueueDocCategorize(auth.orgId, result.documentId, result.revision, 'question_answered');
  return Response.json({ documentId: result.documentId, status: 'queued' }, { status: 202 });
}
