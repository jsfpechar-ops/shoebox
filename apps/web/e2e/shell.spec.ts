import { axeViolations, expect, test } from './fixtures';

/** The four screens (07 §5, M11 §3). Czech words are the spec, so they are literal here. */
const screens = [
  { path: '/inbox', name: 'Inbox' },
  { path: '/prehled', name: 'Overview' },
  { path: '/ucetni', name: 'For the accountant' },
  { path: '/nastaveni', name: 'Settings' },
] as const;

const GOOGLE_FONT_HOST = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

test('/ redirects to the Inbox', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/inbox');
});

test('nav has the four screens in order and opens each one', async ({ page }) => {
  await page.goto('/inbox');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const items = nav.locator('[data-nav-item]');
  await expect(items).toHaveCount(4);
  await expect(items).toHaveText(screens.map((screen) => screen.name));

  for (const screen of screens) {
    const link = nav.getByRole('link', { name: screen.name, exact: true });
    await link.click();
    await expect(page).toHaveURL(screen.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(screen.name);
    await expect(page).toHaveTitle(screen.name);
    await expect(link).toHaveAttribute('aria-current', 'page');
  }
});

test('mobile: bottom bar with "+"; desktop: left rail without it; no hamburger', async ({
  page,
  isMobile,
}) => {
  await page.goto('/prehled');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const add = nav.getByRole('link', { name: 'Add document' });
  const box = await nav.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error('nav or viewport not measurable');

  if (isMobile) {
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
    expect(Math.round(box.width)).toBe(viewport.width);
    await expect(add).toBeVisible();
  } else {
    expect(box.x).toBe(0);
    expect(box.width).toBeLessThanOrEqual(200);
    await expect(add).toBeHidden();
  }
  await expect(page.locator('[aria-expanded]')).toHaveCount(0);
});

test('skip link "Přeskočit na obsah" is the first Tab stop and moves focus to main', async ({
  page,
  browserName,
}) => {
  await page.goto('/prehled');
  // WebKit moves focus to links only with Alt+Tab (Safari default).
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#obsah')).toBeFocused();
});

test('landmarks: one header, nav and main; one h1; lang="cs"', async ({ page }) => {
  for (const screen of screens) {
    await page.goto(screen.path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('navigation')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  }
});

test('theme switch: light, dark and system; the choice survives a reload', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/nastaveni');
  const html = page.locator('html');
  const select = page.getByLabel('Appearance');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const themeCookie = async () =>
    (await context.cookies()).find((cookie) => cookie.name === 'theme')?.value;

  await expect(select.locator('option')).toHaveText(['System', 'Light', 'Dark']);
  await expect(select).toHaveValue('system');
  await expect(html).not.toHaveAttribute('data-theme');
  const light = await background();

  await select.selectOption('dark');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const dark = await background();
  expect(dark).not.toBe(light);
  await expect.poll(themeCookie).toBe('dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(select).toHaveValue('dark');

  await page.emulateMedia({ colorScheme: 'dark' });
  await select.selectOption('light');
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await background()).toBe(light);
  await expect.poll(themeCookie).toBe('light');

  await select.selectOption('system');
  await expect(html).not.toHaveAttribute('data-theme');
  expect(await background()).toBe(dark);
  await expect.poll(themeCookie).toBeUndefined();
});

for (const width of [320, 375]) {
  test(`no horizontal scroll and Czech nav labels fit at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    for (const screen of screens) {
      await page.goto(screen.path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, screen.path).toBeLessThanOrEqual(0);
      const clipped = await page
        .locator('[data-nav-item]')
        .evaluateAll((links) =>
          links.filter((link) => link.scrollWidth > link.clientWidth).map((l) => l.textContent),
        );
      expect(clipped, screen.path).toEqual([]);
    }
  });
}

test('system font only: no web font is downloaded (07 §4)', async ({ page }) => {
  const google: string[] = [];
  page.on('request', (request) => {
    if (GOOGLE_FONT_HOST.test(new URL(request.url()).hostname)) google.push(request.url());
  });
  for (const screen of screens) {
    await page.goto(screen.path);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
  }
  expect(google).toEqual([]);
  const fontFiles = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /\.(woff2?|ttf|otf)(\?|$)/.test(name)),
  );
  expect(fontFiles).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: 0 violations on every screen (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const screen of screens) {
      await page.goto(screen.path);
      expect(await axeViolations(page), `${screen.path} ${scheme}`).toEqual([]);
    }
  });
}

test('screenshots of every screen at 375 and 1440 px for the report', async ({
  page,
}, testInfo) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    for (const screen of screens) {
      await page.goto(screen.path);
      await page.screenshot({
        path: testInfo.outputPath(`${width}${screen.path.replace('/', '-')}.png`),
      });
    }
  }
});
