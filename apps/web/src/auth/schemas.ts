import { z } from 'zod';

/** Trimmed, lower-cased, RFC-shaped, ≤ 254 chars. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const magicLinkSchema = z.object({ email: emailSchema });

/** What the login form can show; each maps to an i18n key `auth.error.<code>`. */
export type AuthErrorCode = 'invalid_email' | 'rate_limited' | 'link' | 'unknown';

/** State of the login form (React `useActionState`). */
export type AuthActionState =
  | { status: 'idle' }
  | { status: 'sent'; email: string }
  | { status: 'error'; code: AuthErrorCode };

/** The subset of a Supabase AuthError the mapping needs. Never exposes the provider message. */
export interface AuthErrorLike {
  code?: string | null | undefined;
  status?: number | null | undefined;
}

/** Maps a Supabase Auth error to a user-facing code (M11 §7: errors never show provider names or details). */
export function mapAuthError(error: AuthErrorLike | null | undefined): AuthErrorCode {
  if (!error) return 'unknown';
  const code = error.code ?? '';
  if (error.status === 429 || code.startsWith('over_') || code.endsWith('_rate_limit')) {
    return 'rate_limited';
  }
  if (code === 'validation_failed' || code === 'email_address_invalid') return 'invalid_email';
  if (
    code === 'otp_expired' ||
    code === 'otp_disabled' ||
    code === 'bad_code_verifier' ||
    code === 'flow_state_not_found' ||
    code === 'flow_state_expired' ||
    code === 'validation_failed_pkce'
  ) {
    return 'link';
  }
  return 'unknown';
}
