# 0036b: Org switcher in the header, fake PostgREST for the e2e, `org.spec.ts`

Status: todo
Ticket: P0-AUTH-02 (part b of 2) | Depends on: 0036a merged into phase/0 | Base commit: head of phase/0 | Branch: task/0036b-org-switcher | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Risk: HIGH (auth). Every file is given in full; the tests are the spec.

## 1. Objective

The app header shows the active organization: nothing for a user without membership, the org name with one membership, a select + "Přepnout" with more than one (M11 §3). Switching calls `setActiveOrg` from 0036a (cookie `shoebox_org`). The e2e fake server gains the three PostgREST routes the lookup and the seeding need, and `org.spec.ts` proves the three header states and the cookie.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0036b step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/`. If `tsc` reports an error inside `apps/web/.next/types/`, run `rm -rf apps/web/.next` and rerun once. **Never run `playwright install`**; run `--project desktop-chromium --project mobile-chromium` only.

**Already in phase/0 (do not change beyond this brief):** 0036a (`apps/web/src/auth/authz.ts` with `OrgContext`, `apps/web/src/auth/org-context.ts` with `getOrgContext()`, `apps/web/src/auth/org-actions.ts` with `setActiveOrg`), 0030d (`apps/web/app/(app)/layout.tsx` header with `<ThemeSwitch>` + `<LogoutButtons>`, `apps/web/e2e/fake-auth-server.mjs`, `apps/web/e2e/fixtures.ts` exporting `test`, `expect`, `LOGGED_OUT`, `supabaseUrl()`, `serviceRoleKey()`), i18n keys `shell.*`. If `apps/web/src/auth/org-context.ts` is missing: STOP.

**Spec (pasted):** **M11 §3:** Header: org name + switcher (only if the user has > 1 membership), search, bell, avatar menu (search, bell and avatar menu are later tickets). **M11 §5.9:** the org switcher in the header lists every org where the user is an accountant (multi-client portal is Later; this is the minimal version). **M11 §12:** catalogs in `packages/i18n/messages/{cs,en}.json`, Czech source, English must have every key; key pattern `<area>.<screen|object>.<element>`; no string literals in JSX text. **07 §3:** tokens only, no raw colors; 44 px targets, visible focus, label on every input (WCAG 2.2 AA). **M12 §4.5 V3.2:** cookies HttpOnly, Secure, Lax. **Backlog P0-AUTH-02 acceptance:** switcher shown only with > 1 membership.

**Rules:** 4 (anonymized test data: the e2e uses `Testovací OSVČ …` names and `@shoebox.test` addresses), 6 (two new strings, both through `packages/i18n`, cs and en), 7 (no dependency, no new screen; the switcher is a header element, not a screen).

**Choices made by the brief writer (verified in a scratch copy: 67 e2e green on both Chromium projects, i18n catalog test, typecheck, biome, lint, depcruise, build clean; do not change):**
- Default (confirm at gate): the switcher is a plain `<form action={setActiveOrg}>` with a native `<select>` (sr-only label "Organizace") and a "Přepnout" button, server component, no JavaScript needed; after switching the user lands on `/inbox` (the layout has no pathname; `next` can come with the avatar menu). A single membership shows the org name as text; none shows nothing.
- The fake Auth server gets a minimal PostgREST stand-in: `POST /rest/v1/organizations`, `POST /rest/v1/memberships` (seeding, as the service role would), `GET /rest/v1/memberships` (the user's own rows only, with the embedded `organizations(name)`). The same `org.spec.ts` seeding calls work against the real local Supabase stack (owner step 1): `organizations` gets `inbound_email_slug` and `inbound_email_secret` for the `not null` columns there, which the fake ignores.
- `org.spec.ts` starts `LOGGED_OUT` and creates its own users (unique e-mail per run), so the shared e2e user keeps 0 memberships and the shell/headers specs are unchanged.
- `getOrgContext()` in the layout costs one Auth + one PostgREST call per page render in addition to the middleware's `getUser()` (TODO noted in 0036a).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/i18n/messages/cs.json` | edit (1 anchor) | `shell.org.label`, `shell.org.switch` |
| `packages/i18n/messages/en.json` | edit (1 anchor) | the same keys in English |
| `apps/web/src/auth/org-switcher.tsx` | new | header org name / switcher |
| `apps/web/app/(app)/layout.tsx` | edit (3 anchors) | `getOrgContext()` + `<OrgSwitcher>` |
| `apps/web/e2e/fake-auth-server.mjs` | edit (2 anchors) | PostgREST stand-in |
| `apps/web/e2e/org.spec.ts` | new | 3 tests |

No other file may change. Quote paths with `(app)` in shell commands.

## 4. Steps

Line map of this brief (read a step's code with `Read offset/limit`, not the whole file):
Step 1 code: lines 57–65
Step 2 code: lines 73–112
Step 3 code: lines 122–138
Step 4 code: lines 148–197
Step 5 code: lines 205–311

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0036b-org-switcher origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/web/src/auth/org-context.ts apps/web/src/auth/org-actions.ts apps/web/e2e/fake-auth-server.mjs`. Expected: the three paths. Otherwise STOP.

**Step 1: i18n keys (edit, one anchor in each of two files).**

`packages/i18n/messages/cs.json`, anchor (verbatim): `  "shell.theme.dark": "Tmavý",`. Insert right after that line:

```json
  "shell.org.label": "Organizace",
  "shell.org.switch": "Přepnout",
```

`packages/i18n/messages/en.json`, anchor (verbatim): `  "shell.theme.dark": "Dark",`. Insert right after that line:

```json
  "shell.org.label": "Organization",
  "shell.org.switch": "Switch",
```

Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -5 && grep -c 'shell.org' packages/i18n/messages/cs.json packages/i18n/messages/en.json`. Expected: all i18n tests passed; `2` for each file. Commit.

**Step 2: `apps/web/src/auth/org-switcher.tsx` (new).**

```tsx
import { t } from '@shoebox/i18n';
import type { OrgContext } from './authz';
import { setActiveOrg } from './org-actions';

// Server component (no @shoebox/ui import: the ui index pulls Radix, client only). Tokens only (07 §3).
const control =
  'min-h-11 rounded-control border border-input bg-card px-3 text-body text-foreground transition-opacity duration-200 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Header org name + switcher (M11 §3): nothing without a membership, the name with one, a select and
 * "Přepnout" with more than one. Plain form + server action, so it works without JavaScript.
 */
export function OrgSwitcher({ context }: { context: OrgContext | null }) {
  const active = context?.active;
  if (!context || !active) return null;
  if (context.memberships.length === 1) {
    return (
      <p data-slot="org-name" className="text-body text-muted-foreground">
        {active.orgName}
      </p>
    );
  }
  return (
    <form action={setActiveOrg} className="flex items-center gap-2" data-slot="org-switcher">
      <label htmlFor="org-switcher" className="sr-only">
        {t('shell.org.label')}
      </label>
      <select id="org-switcher" name="orgId" defaultValue={active.orgId} className={control}>
        {context.memberships.map((membership) => (
          <option key={membership.orgId} value={membership.orgId}>
            {membership.orgName}
          </option>
        ))}
      </select>
      <button type="submit" className={`${control} hover:opacity-80`}>
        {t('shell.org.switch')}
      </button>
    </form>
  );
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 3: `apps/web/app/(app)/layout.tsx` (edit, three anchors).**

Anchor A (verbatim): `import { LogoutButtons } from '../../src/auth/logout-buttons';`. Insert right after that line:

```tsx
import { getOrgContext } from '../../src/auth/org-context';
import { OrgSwitcher } from '../../src/auth/org-switcher';
```

Anchor B (verbatim): `  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);`. Insert right after that line:

```tsx
  const context = await getOrgContext();
```

Anchor C (verbatim): `        <p className="text-card-title">{t('shell.app.name')}</p>`. Replace with:

```tsx
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-card-title">{t('shell.app.name')}</p>
          <OrgSwitcher context={context} />
        </div>
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5 && grep -c 'OrgSwitcher\|getOrgContext' 'apps/web/app/(app)/layout.tsx'`. Expected: no `error TS`; `4`. Commit.

**Step 4: `apps/web/e2e/fake-auth-server.mjs` (edit, two anchors).**

Anchor A (verbatim): `const messages = []; // Mailpit-shaped, newest first`. Insert right after that line:

```js
const orgs = new Map(); // id -> { id, name } (PostgREST stand-in for the org switcher e2e)
const memberships = []; // { org_id, user_id, role, created_at }
```

Anchor B (verbatim, two lines):

```js
  if (pathname === '/auth/v1/user' && method === 'GET') {
    const found = sessionFromBearer(req);
```

Insert right BEFORE those two lines (keep them):

```js
  // PostgREST stand-in, only what org-context.ts and org.spec.ts use: the service role seeds
  // organizations and memberships; a user reads `memberships?select=org_id,role,organizations(name)&user_id=eq.<id>`.
  if (pathname === '/rest/v1/organizations' && method === 'POST') {
    const body = await readBody(req);
    const org = { id: body.id ?? randomUUID(), name: String(body.name ?? '') };
    orgs.set(org.id, org);
    return json(res, 201, [org]);
  }
  if (pathname === '/rest/v1/memberships' && method === 'POST') {
    const body = await readBody(req);
    const row = {
      org_id: body.org_id,
      user_id: body.user_id,
      role: body.role,
      created_at: new Date().toISOString(),
    };
    memberships.push(row);
    return json(res, 201, [row]);
  }
  if (pathname === '/rest/v1/memberships' && method === 'GET') {
    const found = sessionFromBearer(req);
    if (!found) return json(res, 401, { code: 'PGRST301', message: 'JWT expired or invalid' });
    const filter = url.searchParams.get('user_id') ?? '';
    const wanted = filter.startsWith('eq.') ? filter.slice(3) : '';
    // RLS stand-in: a user sees only their own rows (the real policy shows whole orgs; the app filters by user_id).
    if (wanted !== found.session.userId) return json(res, 200, []);
    const rows = memberships
      .filter((m) => m.user_id === wanted)
      .map((m) => ({
        org_id: m.org_id,
        role: m.role,
        organizations: orgs.has(m.org_id) ? { name: orgs.get(m.org_id).name } : null,
      }));
    return json(res, 200, rows);
  }

```

Command: `node --check apps/web/e2e/fake-auth-server.mjs && grep -c '/rest/v1/' apps/web/e2e/fake-auth-server.mjs`. Expected: no syntax error; `3`. Commit.

**Step 5: `apps/web/e2e/org.spec.ts` (new).**

```ts
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, LOGGED_OUT, serviceRoleKey, supabaseUrl, test } from './fixtures';

/**
 * P0-AUTH-02: active org and switcher (M11 §3). Users and memberships are seeded through the service
 * role (fake server, or PostgREST of the local Supabase CLI with SUPABASE_URL); every test signs its
 * own user in, so the shared e2e session stays untouched. Anonymized names only.
 */
test.use({ storageState: LOGGED_OUT });

const PASSWORD = 'e2e-password-123456';
const serviceHeaders = () => ({
  apikey: serviceRoleKey(),
  Authorization: `Bearer ${serviceRoleKey()}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
});

async function seedUser(
  request: APIRequestContext,
  orgs: ReadonlyArray<{ name: string; role: 'owner' | 'member' | 'accountant' | 'viewer' }>,
): Promise<{ email: string; orgIds: string[] }> {
  const email = `org-${orgs.length}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@shoebox.test`;
  const created = await request.post(`${supabaseUrl()}/auth/v1/admin/users`, {
    headers: serviceHeaders(),
    data: { email, password: PASSWORD, email_confirm: true },
  });
  expect(created.status(), await created.text()).toBe(200);
  const userId = ((await created.json()) as { id: string }).id;

  const orgIds: string[] = [];
  for (const org of orgs) {
    const slug = `e2e-${Math.random().toString(36).slice(2, 10)}`;
    const insertedOrg = await request.post(`${supabaseUrl()}/rest/v1/organizations`, {
      headers: serviceHeaders(),
      data: { name: org.name, inbound_email_slug: slug, inbound_email_secret: slug },
    });
    expect(insertedOrg.status(), await insertedOrg.text()).toBe(201);
    const orgId = ((await insertedOrg.json()) as Array<{ id: string }>)[0]?.id ?? '';
    expect(orgId).toMatch(/^[0-9a-f-]{36}$/);
    const insertedMembership = await request.post(`${supabaseUrl()}/rest/v1/memberships`, {
      headers: serviceHeaders(),
      data: { org_id: orgId, user_id: userId, role: org.role },
    });
    expect(insertedMembership.status(), await insertedMembership.text()).toBe(201);
    orgIds.push(orgId);
  }
  return { email, orgIds };
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/prihlaseni');
  const form = page.getByRole('form', { name: 'Přihlášení heslem' });
  await form.getByLabel('E-mail').fill(email);
  await form.getByLabel('Heslo').fill(PASSWORD);
  await form.getByRole('button', { name: 'Přihlásit se heslem' }).click();
  await expect(page).toHaveURL('/inbox');
}

test('no membership: header shows neither an org name nor a switcher', async ({
  page,
  request,
}) => {
  const { email } = await seedUser(request, []);
  await signIn(page, email);
  const header = page.getByRole('banner');
  await expect(header.getByRole('combobox', { name: 'Organizace' })).toHaveCount(0);
  await expect(header.locator('[data-slot="org-name"]')).toHaveCount(0);
  expect((await page.context().cookies()).some((c) => c.name === 'shoebox_org')).toBe(false);
});

test('one membership: the org name, no switcher', async ({ page, request }) => {
  const { email } = await seedUser(request, [{ name: 'Testovací OSVČ Jedna', role: 'owner' }]);
  await signIn(page, email);
  const header = page.getByRole('banner');
  await expect(header.locator('[data-slot="org-name"]')).toHaveText('Testovací OSVČ Jedna');
  await expect(header.getByRole('combobox', { name: 'Organizace' })).toHaveCount(0);
});

test('two memberships: switcher lists both; "Přepnout" sets the HttpOnly shoebox_org cookie and survives a reload', async ({
  page,
  request,
}) => {
  const { email, orgIds } = await seedUser(request, [
    { name: 'Testovací OSVČ Alfa', role: 'owner' },
    { name: 'Testovací OSVČ Beta', role: 'viewer' },
  ]);
  const [alfa = '', beta = ''] = orgIds;
  await signIn(page, email);
  const header = page.getByRole('banner');
  const select = header.getByRole('combobox', { name: 'Organizace' });
  await expect(select.locator('option')).toHaveText(['Testovací OSVČ Alfa', 'Testovací OSVČ Beta']);
  // No cookie yet: the first (oldest) membership is active.
  await expect(select).toHaveValue(alfa);

  await page.goto('/prehled');
  await select.selectOption(beta);
  await header.getByRole('button', { name: 'Přepnout' }).click();
  await expect(page).toHaveURL('/inbox');
  await expect(header.getByRole('combobox', { name: 'Organizace' })).toHaveValue(beta);

  const cookie = (await page.context().cookies()).find((c) => c.name === 'shoebox_org');
  expect(cookie).toMatchObject({ value: beta, httpOnly: true, sameSite: 'Lax', path: '/' });

  await page.reload();
  await expect(header.getByRole('combobox', { name: 'Organizace' })).toHaveValue(beta);
});
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 6: run the E2E, then format, lint, build (no new file).** Command: `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30`. Expected: `67 passed` (1 setup + 2 × 33: 12 shell, 4 headers, 2 health, 11 auth, 1 auth-live, 3 org), 0 failed, 0 skipped. If only `headers.spec.ts` "no CSP violation during the shell flow (AC-8)" fails, rerun once (known flake K-P05) and note it in the report. Then: `pnpm exec biome check --write apps/web packages/i18n/messages 2>&1 | tail -3 && pnpm lint 2>&1 | tail -6 && pnpm depcruise 2>&1 | tail -3 && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -6 && git status --short | tail -5`. Expected: `No fixes applied`, lint without errors, `no dependency violations found`, the route table printed, `git status` lists nothing. Commit if anything changed. Then look at `test-results/` for the 375 px screenshot from the shell spec (`find test-results -name '375-inbox.png' | head -1`), Read it once and describe the header in one line in the report (the shared e2e user has no membership, so the header must look as before: title, theme select, two logout buttons).

## 5. Do not touch

`apps/web/middleware.ts`, `apps/web/src/auth/{session,schemas,last-seen,actions,guard,login-form,logout-buttons,authz,org-context,org-actions}.*`, `apps/web/src/supabase/**`, `apps/web/app/(auth)/**`, `apps/web/app/auth/**`, `apps/web/e2e/{fixtures,auth.setup,shell.spec,headers.spec,health.spec,auth.spec,auth-live.spec}.ts`, `playwright.config.ts`, `packages/**` except the two message catalogs, `.github/**`. No dependency. Hard rules 4, 6, 7, 8. Never `playwright install`.

## 6. Commands

- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → all passed (en has every cs key).
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30` → 67 passed.
- `pnpm lint 2>&1 | tail -30` → no errors; `pnpm depcruise 2>&1 | tail -30` → no violations.
- `NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -30` → compiled.

## 7. Acceptance (P0-AUTH-02, part b)

- [ ] `org.spec.ts`: no membership → no org name, no combobox, no `shoebox_org` cookie; one membership → the org name, no combobox; two memberships → combobox "Organizace" with both names, first org active without a cookie, "Přepnout" sets `shoebox_org` HttpOnly, Lax, path `/` to the chosen id, lands on `/inbox`, the choice survives a reload.
- [ ] Shell, headers, auth specs unchanged and green (the shared e2e user has no membership).
- [ ] The two new strings exist in cs and en; no string literal in JSX.
- [ ] axe 0 violations on every page (auto fixture), the select has a label, 44 px targets (`min-h-11`).
- [ ] 67 E2E passed on the two Chromium projects; `mobile-webkit` listed for CI; the real Supabase run is the owner's step.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found verbatim, or 0036a is not in phase/0;
- a test fails twice (except the one K-P05 rerun above), or a test this brief wrote seems wrong;
- the setup project fails (0030c regression);
- port 54329 or 3100 is taken by a stray process (`pkill -f fake-auth-server.mjs; pkill -f 'next start'` once, then retry once);
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0036b-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; the screenshot line; deviations; questions. Then `git add -A && git commit -qm "0036b report" && git push -u origin task/0036b-org-switcher 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `org-switcher.tsx`: renders only from `context` (server-resolved memberships), never from a cookie value; the `<option>` values are the user's own org ids; the label exists (sr-only); token classes only.
- `layout.tsx`: only the two imports, one `await getOrgContext()` and the header slot change; `getByRole('banner')` still counts 1.
- `fake-auth-server.mjs`: test-only; the GET route returns rows only for the bearer's own user id; never deployed.
- `org.spec.ts`: own users per test; names anonymized; no real e-mail is sent (fake server; Mailpit locally).
- Not verified locally: the real Supabase CLI run (owner step 1: the `organizations` insert there needs the two `inbound_email_*` columns the spec provides; a 409/400 would mean a schema drift to report), `mobile-webkit`.

## Owner steps

1. Local verification of the real stack (once, after the merge): `supabase start`; from `supabase status` copy the `anon key` and `service_role key`; run `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service_role> INBOX_URL=http://127.0.0.1:54324 pnpm exec playwright test org.spec.ts --project desktop-chromium 2>&1 | tail -20`. Expected `4 passed` (1 setup + 3). Paste the last lines to the orchestrator. This proves the PostgREST membership query against the real RLS policies.
2. Gate decision to confirm: the minimal native-select switcher landing on `/inbox` (M11 §3 avatar-menu version comes with the UI tickets) and the `shoebox_org` cookie as the place of the active org (no column in `memberships.prefs`).
