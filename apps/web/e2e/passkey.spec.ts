import type { Page } from '@playwright/test';
import { expect, LOGGED_OUT, loginWithLink, test, uniqueEmail } from './fixtures';

/**
 * ADR-012 passkeys end to end with Chromium's virtual authenticator (a DevTools feature, so
 * Chromium only). The fake Auth server keeps credential ids and never checks signatures.
 */
test.use({ storageState: LOGGED_OUT });

async function virtualAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test('add a passkey after the e-mail link, then sign in with one tap', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'virtual authenticator is Chromium-only');
  await virtualAuthenticator(page);
  const email = uniqueEmail('e2e-passkey');

  await loginWithLink(page, email, '/inbox', true);
  await page.getByRole('button', { name: 'Turn on fingerprint or face sign-in' }).click();
  await expect(page).toHaveURL('/inbox');

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/prihlaseni?reason=signed_out');
  await page.getByRole('button', { name: 'Sign in with fingerprint or face' }).click();
  await expect(page).toHaveURL('/inbox');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
});

test('login page: passkey button first, the e-mail form stays', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the JSON WebAuthn helpers are checked in Chromium');
  await page.goto('/prihlaseni');
  const passkey = page.getByRole('button', { name: 'Sign in with fingerprint or face' });
  await expect(passkey).toBeVisible();
  await expect(page.getByText('Or we e-mail you a link:')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Sign in with a link' })).toBeVisible();
  const passkeyBox = await passkey.boundingBox();
  const emailBox = await page.getByLabel('E-mail').boundingBox();
  expect(passkeyBox && emailBox && passkeyBox.y < emailBox.y).toBe(true);
});
