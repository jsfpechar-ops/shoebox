import { expect, test } from './fixtures';

/** M12 §4.5 "CSP and headers", §9 AC-8, §4.2 health. Header names are case-insensitive in Playwright. */
const screens = ['/inbox', '/prehled', '/ucetni', '/nastaveni'] as const;

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

function nonceOf(csp: string): string {
  const match = /script-src [^;]*'nonce-([A-Za-z0-9+/=]+)'/.exec(csp);
  if (match?.[1] === undefined) throw new Error(`no nonce in CSP: ${csp}`);
  return match[1];
}

test('/inbox carries the CSP with a nonce, HSTS and the M12 header set', async ({ page }) => {
  const response = await page.goto('/inbox');
  if (response === null) throw new Error('no response');
  const headers = response.headers();

  const csp = headers['content-security-policy'] ?? '';
  const nonce = nonceOf(csp);
  expect(nonce.length).toBeGreaterThanOrEqual(22);
  expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  expect(csp).toContain(`style-src 'self' 'nonce-${nonce}' 'sha256-`);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).not.toContain('unsafe-inline');

  expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['permissions-policy']).toBe('camera=(self), microphone=(), geolocation=()');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['x-powered-by']).toBeUndefined();
});

test('the nonce is fresh per request and every inline script carries it', async ({ page }) => {
  const first = await page.goto('/prehled');
  const second = await page.goto('/prehled');
  if (first === null || second === null) throw new Error('no response');
  const nonce = nonceOf(second.headers()['content-security-policy'] ?? '');
  expect(nonceOf(first.headers()['content-security-policy'] ?? '')).not.toBe(nonce);

  // The DOM hides nonce attributes; the IDL property still reads them.
  const inline = await page.evaluate(() =>
    Array.from(document.scripts)
      .filter((script) => !script.src)
      .map((script) => script.nonce),
  );
  expect(inline.length).toBeGreaterThan(0);
  for (const value of inline) expect(value).toBe(nonce);
});

test('no CSP violation during the shell flow (AC-8)', async ({ page, context }) => {
  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push(
        `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`,
      );
    });
  });
  const consoleViolations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) consoleViolations.push(message.text());
  });

  await page.goto('/');
  await expect(page).toHaveURL('/inbox');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const path of screens) {
    await nav.locator(`[data-nav-item][href="${path}"]`).click();
    await expect(page).toHaveURL(path);
  }
  const select = page.getByLabel('Appearance');
  await select.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(select).toHaveValue('dark');
  await select.selectOption('system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');

  expect(await page.evaluate(() => window.__cspViolations ?? [])).toEqual([]);
  expect(consoleViolations).toEqual([]);
});

test('every screen answers with the header set', async ({ request }) => {
  for (const path of screens) {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(headers['strict-transport-security'], path).toContain('max-age=63072000');
    expect(headers['cache-control'], path).toContain('no-store');
  }
});
