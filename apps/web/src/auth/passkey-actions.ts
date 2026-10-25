'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../supabase/server';
import { touchLastSeen } from './last-seen';
import {
  challengeIdSchema,
  credentialSchema,
  mapPasskeyError,
  type PasskeyErrorCode,
  type PasskeyResult,
} from './passkey';
import {
  AUTH_COOKIE_OPTIONS,
  PASSKEY_OFFER_COOKIE,
  PASSKEY_OFFER_DONE_S,
  PASSKEY_OFFER_LATER_S,
  safeNextPath,
} from './session';

type PasskeyApi = Awaited<ReturnType<typeof createSupabaseServerClient>>['auth']['passkey'];
type RegistrationOptions = NonNullable<
  Awaited<ReturnType<PasskeyApi['startRegistration']>>['data']
>['options'];
type Credential = Parameters<PasskeyApi['verifyRegistration']>[0]['credential'];
type AuthenticationOptions = NonNullable<
  Awaited<ReturnType<PasskeyApi['startAuthentication']>>['data']
>['options'];
type AuthenticationCredential = Parameters<PasskeyApi['verifyAuthentication']>[0]['credential'];

export type PasskeySignInStart =
  | { status: 'ok'; challengeId: string; options: AuthenticationOptions }
  | { status: 'error'; code: PasskeyErrorCode };

export type PasskeyRegistrationStart =
  | { status: 'ok'; challengeId: string; options: RegistrationOptions }
  | { status: 'error'; code: PasskeyErrorCode };

/** Step 1 (ADR-012): Supabase issues a challenge for the signed-in user. The session stays on the server. */
export async function startPasskeyRegistration(): Promise<PasskeyRegistrationStart> {
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.passkey.startRegistration();
    if (error || !data) return { status: 'error', code: mapPasskeyError(error) };
    return { status: 'ok', challengeId: data.challenge_id, options: data.options };
  } catch {
    return { status: 'error', code: 'unknown' };
  }
}

/** Step 2: Supabase verifies what the browser created; on success the offer is answered and the user goes on. */
export async function finishPasskeyRegistration(
  challengeId: unknown,
  credential: unknown,
  next: unknown,
): Promise<PasskeyResult> {
  const id = challengeIdSchema.safeParse(challengeId);
  const parsed = credentialSchema.safeParse(credential);
  if (!id.success || !parsed.success) return { status: 'error', code: 'unknown' };

  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.auth.passkey.verifyRegistration({
      challengeId: id.data,
      credential: parsed.data as unknown as Credential,
    });
    if (error) return { status: 'error', code: mapPasskeyError(error) };
  } catch {
    return { status: 'error', code: 'unknown' };
  }
  (await cookies()).set(PASSKEY_OFFER_COOKIE, 'done', {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: PASSKEY_OFFER_DONE_S,
  });
  redirect(safeNextPath(typeof next === 'string' ? next : undefined));
}

/** "Teď ne": asked again in 30 days, in this browser only. */
export async function skipPasskey(formData: FormData): Promise<void> {
  const raw = formData.get('next');
  (await cookies()).set(PASSKEY_OFFER_COOKIE, 'later', {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: PASSKEY_OFFER_LATER_S,
  });
  redirect(safeNextPath(typeof raw === 'string' ? raw : undefined));
}

/** Sign-in step 1 (ADR-012): a challenge for any passkey of this site; the browser lets the user pick. */
export async function startPasskeySignIn(): Promise<PasskeySignInStart> {
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.passkey.startAuthentication();
    if (error || !data) return { status: 'error', code: mapPasskeyError(error) };
    return { status: 'ok', challengeId: data.challenge_id, options: data.options };
  } catch {
    return { status: 'error', code: 'unknown' };
  }
}

/** Sign-in step 2: Supabase verifies the signature and opens the session (HttpOnly cookies), like the e-mail link. */
export async function finishPasskeySignIn(
  challengeId: unknown,
  credential: unknown,
  next: unknown,
): Promise<PasskeyResult> {
  const id = challengeIdSchema.safeParse(challengeId);
  const parsed = credentialSchema.safeParse(credential);
  if (!id.success || !parsed.success) return { status: 'error', code: 'unknown' };

  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.passkey.verifyAuthentication({
      challengeId: id.data,
      credential: parsed.data as unknown as AuthenticationCredential,
    });
    if (error || !data?.session) return { status: 'error', code: mapPasskeyError(error) };
  } catch {
    return { status: 'error', code: 'unknown' };
  }
  const store = await cookies();
  touchLastSeen(store);
  store.set(PASSKEY_OFFER_COOKIE, 'done', { ...AUTH_COOKIE_OPTIONS, maxAge: PASSKEY_OFFER_DONE_S });
  redirect(safeNextPath(typeof next === 'string' ? next : undefined));
}
