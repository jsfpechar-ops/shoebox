import { requireActiveRole } from '../auth/org-context';
import { appOrigin, createSupabaseServerClient } from '../supabase/server';

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type ImportGuard =
  | {
      readonly ok: true;
      readonly auth: { readonly orgId: string; readonly userId: string };
      readonly supabase: SupabaseServerClient;
    }
  | { readonly ok: false; readonly response: Response };

/** Origin check (writes only), then owner or member: the same guard as the document upload route. */
export async function guardImportRequest(request: Request, write: boolean): Promise<ImportGuard> {
  if (write && request.headers.get('origin') !== appOrigin())
    return { ok: false, response: Response.json({ error: 'origin' }, { status: 403 }) };
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok)
    return {
      ok: false,
      response: Response.json(
        { error: auth.code },
        { status: auth.code === 'unauthenticated' ? 401 : 403 },
      ),
    };
  return {
    ok: true,
    auth: { orgId: auth.orgId, userId: auth.userId },
    supabase: await createSupabaseServerClient(),
  };
}

export function sendResult(result: { status: number; body: Record<string, unknown> }): Response {
  return Response.json(result.body, { status: result.status });
}
