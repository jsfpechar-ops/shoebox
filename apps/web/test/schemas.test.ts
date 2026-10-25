import { describe, expect, it } from 'vitest';
import { emailSchema, magicLinkSchema, mapAuthError } from '../src/auth/schemas';

describe('login input (M12 §4.5 V5.1: zod on every server action)', () => {
  it('normalizes e-mail: trim, lower-case', () => {
    expect(emailSchema.parse('  Josef@Example.CZ ')).toBe('josef@example.cz');
  });

  it('rejects malformed e-mail', () => {
    for (const bad of [
      '',
      'josef',
      'josef@',
      '@example.cz',
      'a b@example.cz',
      `${'a'.repeat(250)}@x.cz`,
    ]) {
      expect(emailSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('magic link needs only an e-mail', () => {
    expect(magicLinkSchema.parse({ email: 'a@b.cz' })).toEqual({ email: 'a@b.cz' });
    expect(magicLinkSchema.safeParse({}).success).toBe(false);
  });
});

describe('mapAuthError (M11 §7: no provider details reach the user)', () => {
  it('maps Supabase codes to the form codes', () => {
    expect(mapAuthError({ code: 'over_email_send_rate_limit', status: 429 })).toBe('rate_limited');
    expect(mapAuthError({ code: 'over_request_rate_limit' })).toBe('rate_limited');
    expect(mapAuthError({ status: 429 })).toBe('rate_limited');
    expect(mapAuthError({ code: 'validation_failed' })).toBe('invalid_email');
    expect(mapAuthError({ code: 'otp_expired' })).toBe('link');
    expect(mapAuthError({ code: 'bad_code_verifier' })).toBe('link');
    expect(mapAuthError({ code: 'flow_state_not_found' })).toBe('link');
  });

  it('everything else, including password-era codes and network failures, is unknown', () => {
    expect(mapAuthError(null)).toBe('unknown');
    expect(mapAuthError(undefined)).toBe('unknown');
    expect(mapAuthError({})).toBe('unknown');
    expect(mapAuthError({ code: 'invalid_credentials', status: 400 })).toBe('unknown');
    expect(mapAuthError({ code: 'weak_password' })).toBe('unknown');
    expect(mapAuthError({ code: 'unexpected_failure', status: 500 })).toBe('unknown');
  });
});
