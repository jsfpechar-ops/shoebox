# 0023d: Playwright + axe: playwright.config.ts and the shell E2E

Status: review
Ticket: P0-UI-03 (part d of 4) | Depends on: 0023c merged into phase/0 | Base commit: head of phase/0 | Branch: task/0023d-web-e2e | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add Playwright with an auto-run axe fixture (projects `desktop-chromium`, `mobile-webkit`, `mobile-chromium`) and `apps/web/e2e/shell.spec.ts`, which proves the shell: 4 nav items, skip link, landmarks, theme switch, no horizontal scroll at 320 and 375 px, no Google font request and 0 axe violations in light and dark. From now on every screen ships with an E2E test that fails on an accessibility regression.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. For a file marked "full content" Read it once, then Write it exactly. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0023d step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/` (they are ignored once 0023a is merged). If `tsc` reports an error inside `apps/web/.next/types/`, that is stale build output: run `rm -rf apps/web/.next` and rerun the command once.

**Browsers (this machine):** Chromium is preinstalled at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH` is set; `chromium-1194`). **Never run `playwright install`.** `@playwright/test` is pinned to 1.56.1 because that version uses Chromium build 1194. WebKit is not installed here, so you run only `desktop-chromium` and `mobile-chromium`; `mobile-webkit` runs in CI (P0-CI-03 installs browsers there). Running with `--project` filters is not "skipping".

**Already in phase/0 (from 0023a–c, do not change):** `apps/web` (Next.js 15.5.27) with the shell, `/inbox`, `/prehled`, `/ucetni`, `/nastaveni`, the theme switch and the `/` redirect; `apps/web/package.json` has `"e2e": "playwright test --config ../../playwright.config.ts"`; `apps/web/tsconfig.json` includes `e2e`; `.gitignore` has `test-results/` and `playwright-report/`. If `apps/web/src/shell/theme-switch.tsx` is missing: STOP.

**What the shell renders (for reading the tests):** skip link "Přeskočit na obsah" → `main#obsah`; `header` with the app name and the select labelled "Vzhled" (options Podle systému / Světlý / Tmavý, values `system`/`light`/`dark`; cookie `theme`); `nav` labelled "Hlavní navigace" with 4 links carrying `data-nav-item` and a mobile-only "+" link labelled "Přidat doklad"; each page has one `h1` and a `<title>` equal to the screen name.

**Spec M12 §4.1 (pasted):** `playwright.config.ts` at the repo root: projects `desktop-chromium`, `mobile-webkit` (iPhone 14), `mobile-chromium` (Pixel 7); `@axe-core/playwright` fixture auto-run. Root script `e2e` = `turbo run e2e`.

**Spec 07 §5 App shell (pasted):** Desktop: a left rail with the four screens: Inbox, Přehled, Pro účetní, Nastavení. Mobile: a bottom bar with the same four, plus a central "+" button. No hamburger menus. Breakpoints 375 / 768 / 1024 / 1440; content max-width 1200 px. Radius 8 px controls, 12 px cards; borders over shadows.

**Spec M11 §3 (pasted):** routes `/` (redirect: owner/member → `/prehled` if any document else `/inbox`; accountant → `/ucetni`), `/inbox`, `/prehled`, `/ucetni`, `/nastaveni`. Navigation: desktop = left rail (64 px, icons + labels on hover; expanded 200 px at wide screens); mobile = bottom tab bar with 4 tabs and a centre button. Later tickets put screens under `apps/web/app/(app)/` (P1-UI-02 adds the "+" menu Nahrát · Vyfotit · Přidat ručně).

**Spec 07 §8 / M11 §9 Accessibility (pasted):** everything reachable by keyboard in visual order; a skip link "Přeskočit na obsah"; landmarks `header`, `nav`, `main`; one `h1` per screen; `lang="cs"`. Focus: a 3 px ring in `--ring` with a 2 px offset, never removed, not obscured by sticky bars (2.4.11). Targets ≥ 44 × 44 px. Reflow: works at 320 px width with no horizontal page scroll. Testing: axe in every Playwright E2E (0 violations).

**Spec 07 §4 (pasted):** Inter via `next/font`, subsets `latin` + `latin-ext` (Czech diacritics), self-hosted, so no requests to Google at runtime. Nothing below 14 px; weights 400/500/600.

**Rules:** every user-facing string through `packages/i18n` (rule 6; the Biome plugin `no-jsx-literal-text` covers `apps/web/**`: JSX text and string-literal `aria-label|title|placeholder|alt` are errors, `aria-label={t('…')}` is fine). Tokens only: color classes are `bg-background`, `bg-card`, `bg-muted`, `bg-primary`, `text-foreground`, `text-muted-foreground`, `text-primary`, `text-primary-foreground`, `border-border`, `border-input`, `ring-ring` (from `@shoebox/ui/theme.css`); no hex, no `rgb()`. Rule 7: no dependency beyond those named in this brief.

**Dependencies (approved in decisions.md, P0-OWN-01 line "Playwright + @axe-core/playwright"):** `@playwright/test` 1.56.1 and `@axe-core/playwright` 4.13.0 (matches the approved `axe-core` 4.13.0), root `devDependencies`. Nothing else.

**Choices made by the brief writer (do not change):**
- The web server for tests is a production build (`next build` + `next start` on port 3100), started by Playwright and reused if one already runs. The first run builds (about 40 s).
- The axe fixture runs after every passing test on the page the test ended on (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`); two extra tests run axe on all four screens in light and in dark. A violation message names the rule and the element.
- Czech words in the spec are literal: they are the spec (07 §8, M11 §3). E2E files are not JSX, so the i18n lint does not apply.
- WebKit moves focus to links only with Alt+Tab; the skip-link test presses Alt+Tab there.
- `turbo.json` passes `PLAYWRIGHT_BROWSERS_PATH` and `CI` into the `e2e` task (Turbo 2 strict env mode drops them otherwise: Playwright then looks in `~/.cache` and fails).
- The last test writes 375 and 1440 px screenshots of every screen into `test-results/` (git-ignored) for the report.

Hard rules: 6, 7 (no dependency beyond the two above). Never `playwright install`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `package.json` | edit | `@axe-core/playwright`, `@playwright/test` devDependencies |
| `pnpm-lock.yaml` | generated | by `pnpm install` |
| `turbo.json` | edit | `passThroughEnv` for `e2e` |
| `playwright.config.ts` | new | 3 projects, web server |
| `apps/web/e2e/fixtures.ts` | new | `test` with auto axe, `axeViolations`, `expect` |
| `apps/web/e2e/shell.spec.ts` | new | the shell E2E (12 tests) |

No other file may change.

## 4. Steps

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0023d-web-e2e origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls /opt/pw-browsers && echo $PLAYWRIGHT_BROWSERS_PATH`. Expected: `chromium-1194` among the folders and `/opt/pw-browsers`. If either is missing: STOP (do not install browsers).

**Step 1: `package.json` (edit, repo root).** Anchor (verbatim): `    "@biomejs/biome": "catalog:",`. Replace that line with:

```json
    "@axe-core/playwright": "4.13.0",
    "@biomejs/biome": "catalog:",
    "@playwright/test": "1.56.1",
```

Command: `pnpm install 2>&1 | tail -5`. Expected: `+ @axe-core/playwright 4.13.0`, `+ @playwright/test 1.56.1`, `Done in …`, no `ERR_PNPM`. Commit (includes `pnpm-lock.yaml`).

**Step 2: `turbo.json` (edit).** Anchor (verbatim, two lines):

```json
    "e2e": {
      "cache": false
```

Replace with:

```json
    "e2e": {
      "cache": false,
      "passThroughEnv": ["CI", "PLAYWRIGHT_BROWSERS_PATH"]
```

Command: `node -e "console.log(JSON.parse(require('fs').readFileSync('turbo.json','utf8')).tasks.e2e)" 2>&1 | tail -3`. Expected: `{ cache: false, passThroughEnv: [ 'CI', 'PLAYWRIGHT_BROWSERS_PATH' ] }`.

**Step 3: `playwright.config.ts` (new, repo root).**

```ts
import { defineConfig, devices } from '@playwright/test';

/** M12 §4.1: E2E for apps/web. Every test runs axe through the auto fixture in apps/web/e2e/fixtures.ts. */
const port = 3100;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './apps/web/e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm --filter @shoebox/web build && pnpm --filter @shoebox/web exec next start --port ${port}`,
    url: `http://localhost:${port}/inbox`,
    reuseExistingServer: !isCI,
    timeout: 240_000,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
```

Command: `pnpm exec playwright test --list --project desktop-chromium 2>&1 | tail -3`. Expected: `Error: No tests found` and `Total: 0 tests in 0 files` (no spec yet); no config or syntax error.

**Step 4: `apps/web/e2e/fixtures.ts` (new).**

```ts
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';

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
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 5: `apps/web/e2e/shell.spec.ts` (new).** Do not edit the test file.

```ts
import { axeViolations, expect, test } from './fixtures';

/** The four screens (07 §5, M11 §3). Czech words are the spec, so they are literal here. */
const screens = [
  { path: '/inbox', name: 'Inbox' },
  { path: '/prehled', name: 'Přehled' },
  { path: '/ucetni', name: 'Pro účetní' },
  { path: '/nastaveni', name: 'Nastavení' },
] as const;

const GOOGLE_FONT_HOST = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

test('/ redirects to the Inbox', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/inbox');
});

test('nav has the four screens in order and opens each one', async ({ page }) => {
  await page.goto('/inbox');
  const nav = page.getByRole('navigation', { name: 'Hlavní navigace' });
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
  const nav = page.getByRole('navigation', { name: 'Hlavní navigace' });
  const add = nav.getByRole('link', { name: 'Přidat doklad' });
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
  const skip = page.getByRole('link', { name: 'Přeskočit na obsah' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#obsah')).toBeFocused();
});

test('landmarks: one header, nav and main; one h1; lang="cs"', async ({ page }) => {
  for (const screen of screens) {
    await page.goto(screen.path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'cs');
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
  const select = page.getByLabel('Vzhled');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const themeCookie = async () =>
    (await context.cookies()).find((cookie) => cookie.name === 'theme')?.value;

  await expect(select.locator('option')).toHaveText(['Podle systému', 'Světlý', 'Tmavý']);
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

test('Inter is self-hosted: no request to Google font hosts', async ({ page, baseURL }) => {
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
      .filter((name) => name.endsWith('.woff2')),
  );
  expect(fontFiles.length).toBeGreaterThan(0);
  for (const file of fontFiles) expect(file.startsWith(`${baseURL}/`)).toBe(true);
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
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 6: run the E2E (no new file).** Command: `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30`. Expected: `24 passed`, 0 failed, 0 skipped. A failure in the app (not in the test) is a bug of 0023a–c: STOP and report it with the failing assertion; do not change files outside §3.

**Step 7: through Turbo (no new file).** Command: `pnpm turbo run e2e --filter @shoebox/web -- --project desktop-chromium 2>&1 | tail -5`. Expected: `Tasks:    1 successful, 1 total`.

**Step 8: format, lint, screenshots (no new file).** Command: `pnpm exec biome check --write playwright.config.ts apps/web/e2e 2>&1 | tail -3 && pnpm lint 2>&1 | tail -8 && pnpm --filter @shoebox/web typecheck 2>&1 | tail -3 && find test-results -name '375-*.png' 2>&1 | tail -8`. Expected: lint without errors, no `error TS`, four `375-*.png` paths (step 7 ran `desktop-chromium` last). Look at `375-inbox.png` once (Read the image) and describe it in one line in the report. Commit if anything changed (PNG files are git-ignored).

## 5. Do not touch

Everything under `apps/web/app/**` and `apps/web/src/**`, `apps/web/package.json`, `apps/web/tsconfig.json`, `.gitignore`, `.github/**` (CI wiring is P0-CI-03), `packages/**`. Hard rules 6 and 7. Never run `playwright install`, never add a browser.

## 6. Commands

- `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30` → 24 passed.
- `pnpm turbo run e2e --filter @shoebox/web -- --project desktop-chromium 2>&1 | tail -30` → 1 successful.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm lint 2>&1 | tail -30` → no errors.

## 7. Acceptance

- [ ] `playwright.config.ts` has the projects `desktop-chromium`, `mobile-webkit`, `mobile-chromium` and the axe fixture runs automatically (`{ auto: true }`).
- [ ] `apps/web/e2e/shell.spec.ts`: 4 nav items; skip link "Přeskočit na obsah"; landmarks; theme switch light/dark/system; no horizontal scroll at 320 and 375 px; no request to Google font hosts; axe 0 violations (light and dark). 24 passed on the two Chromium projects.
- [ ] `mobile-webkit` not run locally (no WebKit here); listed in the report for P0-CI-03.
- 07 §9 pre-delivery checklist (now checked by the E2E run):
- [ ] Only tokens from 07 §3; no raw hex outside `tokens.css`.
- [ ] Lucide icons only, no emoji; status = icon + word + color.
- [ ] Hover and press states with a 150–250 ms transition; reduced motion respected.
- [ ] Visible focus on every interactive element; keyboard path works end to end.
- [ ] Targets ≥ 44 px; works at 375 px with no horizontal page scroll.
- [ ] Light and dark both checked; text contrast ≥ 4.5:1 (body ≥ 7:1).
- [ ] Amounts tabular, right-aligned, Czech format.
- [ ] Click budget (07 §2) met for the flow touched.
- [ ] Czech labels fit at 375 px (Czech runs ~20 % longer than English).
- [ ] axe 0 violations; 375 px screenshot in the report.
- Amounts and click budget: not applicable (no amounts, no flow). Screenshot: `test-results/…/375-inbox.png` described in the report.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found verbatim, or the brief this one depends on is not in phase/0;
- a test fails twice, or a test this brief wrote seems wrong;
- `next build` fails to download Inter from Google (network error): STOP, do not switch to another font loader;
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency or lockfile change beyond this brief seems needed;
- a file outside §3 needs a change (including Next rewriting `apps/web/tsconfig.json`);
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.
- `mobile-webkit` would need WebKit installed: never install it; note it in the report.

## 9. Report

Write `docs/tasks/0023d-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0023d report" && git push -u origin task/0023d-web-e2e 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `fixtures.ts`: the auto fixture really fails the test on a violation (verified by the brief writer: removing the "+" `aria-label` fails with `link-name`).
- `playwright.config.ts`: `reuseExistingServer` only outside CI; `forbidOnly` in CI.
- `pnpm-lock.yaml`: only Playwright, axe and their transitive packages (Next gains `@playwright/test` as a resolved optional peer).
- Not verified locally: `mobile-webkit` (Alt+Tab skip link, select on iOS). First CI run of P0-CI-03 is the check.

## Owner steps

None. (P0-CI-03 adds the CI job that installs browsers, including WebKit, and runs all three projects.)
