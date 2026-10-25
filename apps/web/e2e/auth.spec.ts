import type { Browser, Page } from '@playwright/test';
import { expect, LOGGED_OUT, loginWithLink, test, uniqueEmail } from './fixtures';

/**
 * P0-AUTH-01 (ADR-012, M12 §4.4, §4.5 V3.2–3.4). Every test here starts logged out and signs in on
 * its own with a fresh address and the e-mail link, so ending a session never touches the shared
 * storage state of the other specs. `/inbox` is the default target, so its login URL has no `next`.
 */
test.use({ storageState: LOGGED_OUT });

const IDLE_MS = 12 * 60 * 60 * 1000;

async function login(page: Page, next = '/inbox', email = uniqueEmail()): Promise<void> {
  await loginWithLink(page, email, next);
}

async function freshLogin(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ storageState: LOGGED_OUT });
  const page = await context.newPage();
  await login(page, '/inbox', email);
  return page;
}

test('without a session every app page redirects to the login page with next', async ({ page }) => {
  await page.goto('/inbox');
  await expect(page).toHaveURL('/prihlaseni');
  await page.goto('/prehled?tab=x');
  await expect(page).toHaveURL('/prihlaseni?next=%2Fprehled%3Ftab%3Dx');
  await page.goto('/');
  await expect(page).toHaveURL('/prihlaseni?next=%2F');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
});

test('login page: one labelled form, e-mail only; HTML validation on the e-mail', async ({
  page,
}) => {
  await page.goto('/prihlaseni');
  await expect(page).toHaveTitle('Sign in');
  const forms = page.getByRole('form');
  await expect(forms).toHaveCount(1);
  await expect(forms.nth(0)).toHaveAccessibleName('Sign in with a link');
  const form = forms.nth(0);
  await expect(form.getByLabel('E-mail')).toHaveAttribute('type', 'email');
  await expect(form.getByLabel('E-mail')).toHaveAttribute('required', '');
  await expect(form.getByRole('button', { name: 'Send sign-in link' })).toBeVisible();
  await expect(
    form.getByText('We e-mail you a link. Just click it, no password needed.'),
  ).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('login page fits 375 px without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/prihlaseni');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('next is never an off-site URL (open redirect)', async ({ page }) => {
  await page.goto('/prihlaseni?next=https%3A%2F%2Fevil.example%2Fx');
  const values = await page
    .locator('input[name="next"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(values).toEqual(['/inbox']);
  await page.goto('/prihlaseni?next=%2F%2Fevil.example');
  await expect(page.locator('input[name="next"]').first()).toHaveValue('/inbox');
  await page.goto('/prihlaseni?next=%2Fprehled%3Ftab%3Dx');
  await expect(page.locator('input[name="next"]').first()).toHaveValue('/prehled?tab=x');
});

test('a magic link without a code goes back to the login page with a notice', async ({ page }) => {
  await page.goto('/auth/callback?next=%2Fprehled');
  await expect(page).toHaveURL('/prihlaseni?next=%2Fprehled&reason=link');
  await expect(page.getByRole('status').first()).toHaveText(
    'The link is no longer valid. Send yourself a new one.',
  );
  await page.goto('/auth/callback?code=not-a-real-code');
  await expect(page).toHaveURL('/prihlaseni?reason=link');
});

test('e-mail link login: session cookies are HttpOnly, Secure, SameSite=Lax; next is honoured', async ({
  page,
  context,
}) => {
  await login(page, '/prehled');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
  const cookies = await context.cookies();
  const auth = cookies.filter((cookie) => cookie.name.startsWith('sb-'));
  expect(auth.length).toBeGreaterThan(0);
  const lastSeen = cookies.filter((cookie) => cookie.name === 'shoebox_last_seen');
  expect(lastSeen).toHaveLength(1);
  for (const cookie of [...auth, ...lastSeen]) {
    expect(cookie.httpOnly, cookie.name).toBe(true);
    expect(cookie.secure, cookie.name).toBe(true);
    expect(cookie.sameSite, cookie.name).toBe('Lax');
    expect(cookie.path, cookie.name).toBe('/');
  }
  // A signed-in user is sent away from the login page.
  await page.goto('/prihlaseni');
  await expect(page).toHaveURL('/inbox');
});

test('"Odhlásit" ends this browser\'s session', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/prihlaseni?reason=signed_out');
  await expect(page.getByRole('status').first()).toHaveText('You are signed out.');
  await page.goto('/inbox');
  await expect(page).toHaveURL('/prihlaseni');
});

test('"Odhlásit všude" ends the sessions of other browsers too (V3.4)', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail();
  const other = await freshLogin(browser, email);
  await login(page, '/inbox', email);
  await other.goto('/prehled');
  await expect(other).toHaveURL('/prehled');

  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(page).toHaveURL('/prihlaseni?reason=signed_out');

  await other.goto('/inbox');
  await expect(other).toHaveURL('/prihlaseni');
  await other.context().close();
});

test('idle for more than 12 h: signed out with the M11 notice, session really gone', async ({
  page,
  context,
}) => {
  await login(page);
  await page.waitForLoadState('networkidle');
  await context.addCookies([
    {
      name: 'shoebox_last_seen',
      value: String(Date.now() - IDLE_MS - 60_000),
      url: 'http://localhost:3100',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/prehled');
  await expect(page).toHaveURL('/prihlaseni?next=%2Fprehled&reason=idle');
  await expect(page.getByRole('status').first()).toHaveText(
    'For security reasons we signed you out.',
  );
  const cookies = await context.cookies();
  expect(cookies.filter((cookie) => cookie.name.startsWith('sb-'))).toEqual([]);
  await page.goto('/inbox');
  await expect(page).toHaveURL('/prihlaseni');
});

test('an active user keeps the session: last_seen moves forward on every request', async ({
  page,
  context,
}) => {
  await login(page);
  const first = (await context.cookies()).find((c) => c.name === 'shoebox_last_seen')?.value;
  await page.waitForTimeout(1100);
  await page.goto('/nastaveni');
  await expect(page).toHaveURL('/nastaveni');
  const second = (await context.cookies()).find((c) => c.name === 'shoebox_last_seen')?.value;
  expect(Number(second)).toBeGreaterThan(Number(first));
});
