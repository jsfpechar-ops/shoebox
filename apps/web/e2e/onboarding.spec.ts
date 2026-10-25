import { expect, test } from './fixtures';

test.describe('onboarding /vitejte', () => {
  test('shows the heading, the first question and the IČO field', async ({ page }) => {
    await page.goto('/vitejte');
    await expect(
      page.getByRole('heading', { level: 1, name: "Let's set up your business" }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'What is your IČO?' })).toBeVisible();
    await expect(page.getByText('Step 1 of 3')).toBeVisible();
    await expect(page.getByLabel('Your IČO (company ID)')).toBeVisible();
  });

  test('an invalid IČO shows the message on its own and no VAT question', async ({
    page,
  }, testInfo) => {
    await page.goto('/vitejte');
    await page.getByLabel('Your IČO (company ID)').fill('12345678');
    await expect(page.getByRole('status')).toContainText('This IČO does not have the right format');
    await expect(page.getByRole('group', { name: 'Are you a VAT payer?' })).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: testInfo.outputPath('onboarding-375.png'), fullPage: true });
  });

  test('the "?" beside IČO opens the help text and is at least 44 px', async ({ page }) => {
    await page.goto('/vitejte');
    const help = page.getByRole('button', { name: 'What is IČO?' });
    const box = await help.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await help.click();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('eight-digit number', { exact: false })).toBeVisible();
  });
});
