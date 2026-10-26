import { describe, expect, it } from 'vitest';
import { testAutoLogin } from '../src/auth/test-autologin';

const creds = {
  SHOEBOX_TEST_AUTOLOGIN_EMAIL: 'test@example.com',
  SHOEBOX_TEST_AUTOLOGIN_PASSWORD: 'pw',
};

describe('testAutoLogin', () => {
  it('is off outside the test environment', () => {
    expect(testAutoLogin({ ...creds, APP_ENV: 'production' })).toBeNull();
    expect(testAutoLogin({ ...creds })).toBeNull();
  });

  it('is off when a variable is missing', () => {
    expect(
      testAutoLogin({ APP_ENV: 'test', SHOEBOX_TEST_AUTOLOGIN_EMAIL: 'test@example.com' }),
    ).toBeNull();
  });

  it('returns the credentials in the test environment', () => {
    expect(testAutoLogin({ ...creds, APP_ENV: 'test' })).toEqual({
      email: 'test@example.com',
      password: 'pw',
    });
  });
});
