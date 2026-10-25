import {
  expect,
  LOGGED_OUT,
  loginWithLink,
  magicLinkIn,
  requestLink,
  test,
  uniqueEmail,
} from './fixtures';

/**
 * The magic-link flow end to end, read from the local inbox (ADR-012). Runs against the fake Auth +
 * inbox server by default and against the Supabase CLI (Mailpit on 54324) when SUPABASE_URL and
 * INBOX_URL are set, so CI and the owner verify the real provider with the same test.
 */
test.use({ storageState: LOGGED_OUT });

test('magic link from the local inbox logs in, with HttpOnly Secure Lax cookies', async ({
  page,
  context,
}) => {
  const email = uniqueEmail('e2e-magic');
  const link = await magicLinkIn(await requestLink(page, email, '/prehled'));
  await expect(page).toHaveURL('/prihlaseni?next=%2Fprehled');
  // Same browser context as the request: the PKCE verifier cookie is here.
  await page.goto(link);
  // First e-mail-link sign-in in this browser: the passkey offer, then "Teď ne" goes on to next.
  await expect(page).toHaveURL('/pristupovy-klic?next=%2Fprehled');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Next time without e-mail');
  await expect(
    page.getByRole('button', { name: 'Turn on fingerprint or face sign-in' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page).toHaveURL('/prehled');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');

  const cookies = await context.cookies();
  const auth = cookies.filter((cookie) => cookie.name.startsWith('sb-'));
  expect(auth.length).toBeGreaterThan(0);
  for (const cookie of [...auth, ...cookies.filter((c) => c.name === 'shoebox_passkey_offer')]) {
    expect(cookie.httpOnly, cookie.name).toBe(true);
    expect(cookie.secure, cookie.name).toBe(true);
    expect(cookie.sameSite, cookie.name).toBe('Lax');
  }

  // The link is single use.
  await page.goto(link);
  await expect(page).toHaveURL(/\/prihlaseni\?.*reason=link|\/inbox/);
});

test('the passkey offer is asked once per browser: after "Teď ne" the link goes straight on', async ({
  page,
}) => {
  const email = uniqueEmail('e2e-offer');
  await loginWithLink(page, email, '/inbox', true);
  await expect(page).toHaveURL('/pristupovy-klic');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page).toHaveURL('/inbox');

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/prihlaseni?reason=signed_out');
  const link = await magicLinkIn(await requestLink(page, email, '/prehled'));
  await page.goto(link);
  await expect(page).toHaveURL('/prehled');
});

test('the passkey offer needs a session', async ({ page }) => {
  await page.goto('/pristupovy-klic');
  await expect(page).toHaveURL('/prihlaseni?next=%2Fpristupovy-klic');
});
