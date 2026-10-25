'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { appOrigin, createSupabaseServerClient } from '../supabase/server';
import { type AuthActionState, type AuthErrorLike, magicLinkSchema, mapAuthError } from './schemas';
import { CALLBACK_PATH, LAST_SEEN_COOKIE, loginUrl, safeNextPath } from './session';

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' ? value : undefined;
}

/** Magic link (ADR-012). The link returns to `/auth/callback?next=…` on APP_URL; the user sees "sent" either way. */
export async function sendMagicLink(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = magicLinkSchema.safeParse({ email: field(formData, 'email') });
  if (!parsed.success) return { status: 'error', code: 'invalid_email' };
  const next = safeNextPath(field(formData, 'next'));

  const supabase = await createSupabaseServerClient();
  let error: AuthErrorLike | null;
  try {
    ({ error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        emailRedirectTo: `${appOrigin()}${CALLBACK_PATH}?next=${encodeURIComponent(next)}`,
        shouldCreateUser: true,
      },
    }));
  } catch {
    error = {};
  }
  if (error) return { status: 'error', code: mapAuthError(error) };
  return { status: 'sent', email: parsed.data.email };
}

async function endSession(scope: 'local' | 'global'): Promise<never> {
  const supabase = await createSupabaseServerClient();
  try {
    await supabase.auth.signOut({ scope });
  } catch {
    // The cookies are cleared below either way; a failed remote revoke is not shown to the user.
  }
  const store = await cookies();
  store.delete(LAST_SEEN_COOKIE);
  redirect(loginUrl(undefined, 'signed_out'));
}

/** "Odhlásit": this browser only. */
export async function signOut(): Promise<void> {
  await endSession('local');
}

/** "Odhlásit všude" (M12 §4.5 V3.4): revokes every refresh token of the user, so other devices drop out at their next request. */
export async function signOutEverywhere(): Promise<void> {
  await endSession('global');
}
