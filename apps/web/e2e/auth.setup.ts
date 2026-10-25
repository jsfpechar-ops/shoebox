import { expect, test as setup } from '@playwright/test';
import { E2E_USER, loginWithLink, STORAGE_STATE } from './fixtures';

/**
 * Runs once before the browser projects (playwright.config.ts `dependencies: ['setup']`): signs the
 * e2e user in with the e-mail link (ADR-012: passkey and e-mail only; the link creates the user on
 * first use) and stores the HttpOnly session cookies for every other test.
 */
setup('sign the e2e user in with the e-mail link', async ({ page }) => {
  await loginWithLink(page, E2E_USER.email);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
  await page.context().storageState({ path: STORAGE_STATE });
});
