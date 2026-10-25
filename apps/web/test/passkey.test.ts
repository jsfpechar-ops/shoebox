import { describe, expect, it } from 'vitest';
import {
  challengeIdSchema,
  credentialSchema,
  mapPasskeyError,
  passkeySupported,
} from '../src/auth/passkey';
import { afterLinkSignIn, PASSKEY_OFFER_PATH } from '../src/auth/session';

const fn = () => undefined;

describe('passkeySupported (no polyfill: browsers without JSON WebAuthn get e-mail only)', () => {
  it('needs both JSON parsers and navigator.credentials', () => {
    const full = {
      PublicKeyCredential: { parseCreationOptionsFromJSON: fn, parseRequestOptionsFromJSON: fn },
      navigator: { credentials: {} },
    };
    expect(passkeySupported(full)).toBe(true);
    expect(passkeySupported({ navigator: { credentials: {} } })).toBe(false);
    expect(
      passkeySupported({ ...full, PublicKeyCredential: { parseCreationOptionsFromJSON: fn } }),
    ).toBe(false);
    expect(passkeySupported({ PublicKeyCredential: full.PublicKeyCredential, navigator: {} })).toBe(
      false,
    );
    expect(passkeySupported({})).toBe(false);
  });
});

describe('mapPasskeyError (no provider details reach the user)', () => {
  it('maps browser and Supabase failures', () => {
    expect(mapPasskeyError({ name: 'NotAllowedError' })).toBe('cancelled');
    expect(mapPasskeyError({ name: 'AbortError' })).toBe('cancelled');
    expect(mapPasskeyError({ code: 'ERROR_CEREMONY_ABORTED' })).toBe('cancelled');
    expect(mapPasskeyError({ code: 'webauthn_challenge_expired' })).toBe('expired');
    expect(mapPasskeyError({ name: 'NotSupportedError' })).toBe('unsupported');
    expect(mapPasskeyError({ name: 'SecurityError' })).toBe('unsupported');
    expect(mapPasskeyError({ code: 'unexpected_failure' })).toBe('unknown');
    expect(mapPasskeyError(null)).toBe('unknown');
    expect(mapPasskeyError(undefined)).toBe('unknown');
  });
});

describe('server action input (M12 §4.5 V5.1)', () => {
  it('accepts a toJSON() credential, rejects other shapes', () => {
    const ok = { id: 'abc', rawId: 'abc', type: 'public-key', response: { clientDataJSON: 'x' } };
    expect(credentialSchema.safeParse(ok).success).toBe(true);
    expect(credentialSchema.safeParse({ ...ok, type: 'password' }).success).toBe(false);
    expect(credentialSchema.safeParse({ ...ok, id: '' }).success).toBe(false);
    expect(credentialSchema.safeParse('abc').success).toBe(false);
    expect(challengeIdSchema.safeParse('').success).toBe(false);
    expect(challengeIdSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});

describe('afterLinkSignIn (the offer is asked once per browser)', () => {
  it('sends to the offer without an answer, keeping next', () => {
    expect(PASSKEY_OFFER_PATH).toBe('/pristupovy-klic');
    expect(afterLinkSignIn('/inbox', undefined)).toBe('/pristupovy-klic');
    expect(afterLinkSignIn('/prehled?tab=x', undefined)).toBe(
      '/pristupovy-klic?next=%2Fprehled%3Ftab%3Dx',
    );
    expect(afterLinkSignIn('/prehled', 'garbage')).toBe('/pristupovy-klic?next=%2Fprehled');
  });

  it('goes straight to next after "later" or "done", never off-site', () => {
    expect(afterLinkSignIn('/prehled', 'later')).toBe('/prehled');
    expect(afterLinkSignIn('/prehled', 'done')).toBe('/prehled');
    expect(afterLinkSignIn('https://evil.example', 'done')).toBe('/inbox');
    expect(afterLinkSignIn('//evil.example', undefined)).toBe('/pristupovy-klic');
  });
});
