import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { touchLastSeen } from '../../../src/auth/last-seen';
import {
  afterLinkSignIn,
  loginUrl,
  PASSKEY_OFFER_COOKIE,
  safeNextPath,
} from '../../../src/auth/session';
import { appOrigin, createSupabaseServerClient } from '../../../src/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Where the magic link lands (ADR-012, @supabase/ssr PKCE flow): `?code=` is exchanged for a session
 * in the same browser that asked for the link. `?token_hash=&type=` is the template variant of the
 * same link (Supabase "Confirm signup / Magic Link" templates with {{ .TokenHash }}); both are accepted.
 * Any failure goes back to the login page with `reason=link`; nothing from the provider is shown.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get('next'));
  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  const type = params.get('type');

  const supabase = await createSupabaseServerClient();
  let failed = true;
  try {
    if (code) {
      failed = (await supabase.auth.exchangeCodeForSession(code)).error !== null;
    } else if (tokenHash && (type === 'email' || type === 'magiclink')) {
      failed =
        (await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })).error !== null;
    }
  } catch {
    failed = true;
  }

  const origin = appOrigin();
  if (failed) return NextResponse.redirect(new URL(loginUrl(next, 'link'), origin), 303);
  const store = await cookies();
  touchLastSeen(store);
  const to = afterLinkSignIn(next, store.get(PASSKEY_OFFER_COOKIE)?.value);
  return NextResponse.redirect(new URL(to, origin), 303);
}
