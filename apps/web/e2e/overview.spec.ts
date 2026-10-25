import { expect, test } from './fixtures';

test('Overview without documents: empty state, one way forward, no meters', async ({ page }) => {
  await page.goto('/prehled');
  await expect(page.getByRole('heading', { name: 'No documents yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Upload your first document' })).toHaveAttribute(
    'href',
    '/inbox',
  );
  await expect(page.getByRole('meter')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Next payment' })).toBeVisible();
});
