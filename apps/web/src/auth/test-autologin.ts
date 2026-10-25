/**
 * Test environment only (owner 2026-10-25): the hosted test site has no login screen and signs in as
 * one Supabase user. Active only when APP_ENV is `test` and both variables are set; null otherwise.
 */
export function testAutoLogin(
  env: Record<string, string | undefined>,
): { email: string; password: string } | null {
  if (env.APP_ENV !== 'test') return null;
  const email = env.SHOEBOX_TEST_AUTOLOGIN_EMAIL;
  const password = env.SHOEBOX_TEST_AUTOLOGIN_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}
