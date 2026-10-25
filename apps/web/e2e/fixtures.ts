import AxeBuilder from '@axe-core/playwright';
import { type BrowserContextOptions, test as base, expect, type Page } from '@playwright/test';

/** WCAG 2.2 AA (07 §8). */
export const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** axe on the current page; returns `rule: targets` per violation, so a failure names the element. */
export async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

/** Auto fixture (M12 §4.1): after every passing test, axe checks the page it ended on. */
export const test = base.extend<{ autoAxe: undefined }>({
  autoAxe: [
    async ({ page }, use, testInfo) => {
      await use(undefined);
      if (testInfo.status !== testInfo.expectedStatus || !page.url().startsWith('http')) return;
      expect(await axeViolations(page), `axe on ${page.url()}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// Auth (P0-AUTH-01). The same values drive the fake server and a real Supabase CLI stack.
/** Where the setup project stores the signed-in session for the browser projects. */
export const STORAGE_STATE = 'test-results/.auth/user.json';
/** A session-less browser for tests that start logged out. */
export const LOGGED_OUT: NonNullable<BrowserContextOptions['storageState']> = {
  cookies: [],
  origins: [],
};
export const E2E_USER = { email: 'e2e@shoebox.test' } as const;
export const supabaseUrl = (): string => process.env.SUPABASE_URL ?? 'http://127.0.0.1:54329';
export const serviceRoleKey = (): string =>
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'e2e-service-key';
/** Mailpit API of the Supabase CLI (port 54324) or the fake server's copy of it. */
export const inboxUrl = (): string => process.env.INBOX_URL ?? 'http://127.0.0.1:54329';

interface InboxMessage {
  ID: string;
  To: Array<{ Address: string }>;
}

async function inboxIds(address: string): Promise<string[]> {
  const response = await fetch(`${inboxUrl()}/api/v1/messages`);
  const body = (await response.json()) as { messages: InboxMessage[] };
  return body.messages
    .filter((message) => message.To.some((to) => to.Address.toLowerCase() === address))
    .map((message) => message.ID);
}

/** The verify link, from the text part or (Supabase's HTML-only template) the HTML part. */
export async function magicLinkIn(id: string): Promise<string> {
  const response = await fetch(`${inboxUrl()}/api/v1/message/${id}`);
  const body = (await response.json()) as { Text?: string; HTML?: string };
  const haystack = `${body.Text ?? ''}\n${(body.HTML ?? '').replaceAll('&amp;', '&')}`;
  const match = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/.exec(haystack);
  if (!match) throw new Error(`no verify link in message ${id}`);
  return match[0];
}

/** A fresh address per test, so parallel tests never read each other's link. */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@shoebox.test`;
}

/**
 * Asks for a sign-in link on the login page and returns the id of the NEW inbox message for
 * `email` (messages that were already there are ignored).
 */
export async function requestLink(page: Page, email: string, next = '/inbox'): Promise<string> {
  const address = email.toLowerCase();
  const before = new Set(await inboxIds(address));
  await page.goto(
    next === '/inbox' ? '/prihlaseni' : `/prihlaseni?next=${encodeURIComponent(next)}`,
  );
  const form = page.getByRole('form', { name: 'Sign in with a link' });
  await form.getByLabel('E-mail').fill(email);
  await form.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(form.getByRole('status')).toHaveText(
    `We sent a link to ${address}. It is valid for an hour.`,
  );
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        id = (await inboxIds(address)).find((candidate) => !before.has(candidate));
        return id !== undefined;
      },
      { timeout: 15_000, message: `no new inbox message for ${address}` },
    )
    .toBe(true);
  if (!id) throw new Error('unreachable');
  return id;
}

/**
 * Signs in through the e-mail link in this page's browser context and waits for `next`. The passkey
 * offer (0044b) is pre-answered with "later" unless `offer` is true, so other specs land on `next`.
 */
export async function loginWithLink(
  page: Page,
  email: string,
  next = '/inbox',
  offer = false,
): Promise<void> {
  const link = await magicLinkIn(await requestLink(page, email, next));
  if (!offer) {
    await page.context().addCookies([
      {
        name: 'shoebox_passkey_offer',
        value: 'later',
        url: 'http://localhost:3100',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
  }
  // Same browser context as the request: the PKCE verifier cookie is here.
  await page.goto(link);
  await expect(page).toHaveURL(offer ? /\/pristupovy-klic/ : next);
}
