import { z } from 'zod';

export const challengeIdSchema = z.string().min(1).max(128);

/** Shape of `PublicKeyCredential.toJSON()`; only the shape is checked here, Supabase verifies the signature. */
export const credentialSchema = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  response: z.looseObject({}),
});

export type PasskeyErrorCode = 'cancelled' | 'expired' | 'unsupported' | 'unknown';

export type PasskeyResult = { status: 'ok' } | { status: 'error'; code: PasskeyErrorCode };

/**
 * Browser (DOMException `name`) and Supabase (`code`) failures to a user-facing code:
 * NotAllowedError / AbortError / code ERROR_CEREMONY_ABORTED -> cancelled;
 * code webauthn_challenge_expired -> expired; NotSupportedError / SecurityError -> unsupported;
 * anything else, null or undefined -> unknown.
 */
export function mapPasskeyError(
  error: { code?: string | null | undefined; name?: string | null | undefined } | null | undefined,
): PasskeyErrorCode {
  const name = error?.name ?? undefined;
  const code = error?.code ?? undefined;
  if (name === 'NotAllowedError' || name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED') {
    return 'cancelled';
  }
  if (code === 'webauthn_challenge_expired') return 'expired';
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'unsupported';
  return 'unknown';
}

/** True when the scope has the JSON WebAuthn helpers this app uses and `navigator.credentials`. */
export function passkeySupported(scope: {
  PublicKeyCredential?: unknown;
  navigator?: { credentials?: unknown };
}): boolean {
  try {
    const pkc = scope.PublicKeyCredential as
      | { parseCreationOptionsFromJSON?: unknown; parseRequestOptionsFromJSON?: unknown }
      | undefined;
    return (
      typeof pkc?.parseCreationOptionsFromJSON === 'function' &&
      typeof pkc?.parseRequestOptionsFromJSON === 'function' &&
      scope.navigator?.credentials !== undefined
    );
  } catch {
    return false;
  }
}
