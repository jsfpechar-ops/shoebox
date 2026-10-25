import { defineConfig, devices } from '@playwright/test';

/**
 * M12 §4.1: E2E for apps/web. Every test runs axe through the auto fixture in apps/web/e2e/fixtures.ts.
 * Auth (P0-AUTH-01): the `setup` project signs the e2e user in once and the browser projects start from
 * that storage state. Without SUPABASE_URL the fake Auth + inbox server (apps/web/e2e/fake-auth-server.mjs)
 * stands in for the Supabase CLI; with it (CI, owner) the same tests run against the real local stack.
 */
const port = 3100;
const isCI = Boolean(process.env.CI);
const fakeAuthPort = 54329;
const supabaseUrl = process.env.SUPABASE_URL ?? `http://127.0.0.1:${fakeAuthPort}`;
export const STORAGE_STATE = 'test-results/.auth/user.json';

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
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: 'node apps/web/e2e/fake-auth-server.mjs',
      url: `http://127.0.0.1:${fakeAuthPort}/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @shoebox/web build && pnpm --filter @shoebox/web exec next start --port ${port}`,
      // A public page: /api/health answers 503 without a database, which Playwright would not treat as ready.
      url: `http://localhost:${port}/prihlaseni`,
      reuseExistingServer: !isCI,
      timeout: 240_000,
      env: {
        NEXT_TELEMETRY_DISABLED: '1',
        SUPABASE_URL: supabaseUrl,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? 'e2e-anon-key',
        APP_URL: `http://localhost:${port}`,
      },
    },
  ],
});
