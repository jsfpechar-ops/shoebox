# 0039: host the prototype page on Render (password, PORT, blueprint)

Status: review
Ticket: PROTO-02 | Depends on: 0038a–d merged (#72) | Branch: task/0039-proto-render | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The owner chose Render (2026-10-18) to open the prototype page from anywhere. Add an optional password (HTTP Basic, `PROTO_PASSWORD`), listen on the host's `PORT` on `0.0.0.0`, and add a `render.yaml` blueprint (Frankfurt, free plan). Locally nothing changes: no `PORT` and no password means `127.0.0.1:4000`, open.

## 2. Context

- `scripts/proto/serve.ts` (0038d) serves the page with `node:http`; `main()` listens on `PROTO_PORT` (4000) at `127.0.0.1`.
- Unit tests under `scripts/test/**/*.test.ts` run in the root Vitest `unit` project; they must not import `@shoebox/*` (no alias there), so the new helpers live in their own file with only `node:crypto`.
- Render sets `PORT` (default 10000) and needs the server on `0.0.0.0`. The free plan sleeps after idle time.
- decisions.md already has the owner line (orchestrator adds it on this branch before the executor starts).

## 3. Files

| Path | Action | What |
|---|---|---|
| `scripts/proto/auth.ts` | new | `AUTH_REALM`, `isAuthorized`, `listenAddress` |
| `scripts/test/proto-auth.test.ts` | new | 7 tests |
| `scripts/proto/serve.ts` | edit | import, `password` option, 401 check, listen address |
| `render.yaml` | new | Render blueprint |

No other file may change.

## 4. Steps

Line map: Step 1 code: the block right under "Step 1"; Step 2 code under "Step 2"; Step 3 has four edits (a)–(d); Step 4 code under "Step 4".

Setup: `git fetch origin task/0039-proto-render && git checkout -B task/0039-proto-render origin/task/0039-proto-render && pnpm install --frozen-lockfile 2>&1 | tail -3`.

Rules: one Write call per new file, contents exactly as given; Edit tool with the exact anchors. After each step's command shows the expected result, commit `0039 step k`.

### Step 1: create `scripts/proto/auth.ts`

```ts
// Hosting helpers for the prototype page (decisions 2026-10-18 [proto], Render). HTTP Basic auth:
// any user name, the password must equal PROTO_PASSWORD; without a password the page is open
// (local use). Hashing both sides first makes the comparison constant-time and length-blind.
import { createHash, timingSafeEqual } from 'node:crypto';

/** Title of the browser's password prompt. */
export const AUTH_REALM = 'Shoebox prototyp';

const digest = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();

/** True when no password is configured or the `Authorization: Basic …` header carries it. */
export function isAuthorized(header: string | undefined, password: string | undefined): boolean {
  if (password === undefined || password === '') return true;
  if (header === undefined || !header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(password));
}

/** Render (and Cloud Run) set PORT and need 0.0.0.0; locally the default port on 127.0.0.1. */
export function listenAddress(
  env: Readonly<Record<string, string | undefined>>,
  defaultPort: number,
): { port: number; host: string } {
  const raw = env.PORT;
  if (raw === undefined || raw === '') return { port: defaultPort, host: '127.0.0.1' };
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a TCP port, got "${raw}"`);
  }
  return { port, host: '0.0.0.0' };
}
```

Command: `pnpm exec tsc -p scripts/proto/tsconfig.json 2>&1 | tail -3` → no output.

### Step 2: create `scripts/test/proto-auth.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { isAuthorized, listenAddress } from '../proto/auth';

const basic = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;

describe('isAuthorized', () => {
  it('lets everything through when no password is set', () => {
    expect(isAuthorized(undefined, undefined)).toBe(true);
    expect(isAuthorized(undefined, '')).toBe(true);
  });

  it('accepts the right password with any user name', () => {
    expect(isAuthorized(basic('josef', 'tajne-heslo'), 'tajne-heslo')).toBe(true);
    expect(isAuthorized(basic('', 'tajne-heslo'), 'tajne-heslo')).toBe(true);
  });

  it('accepts a password that contains a colon', () => {
    expect(isAuthorized(basic('u', 'a:b'), 'a:b')).toBe(true);
  });

  it('rejects no header, another scheme, a wrong password and no colon', () => {
    const noColon = `Basic ${Buffer.from('tajne-heslo', 'utf8').toString('base64')}`;
    expect(isAuthorized(undefined, 'tajne-heslo')).toBe(false);
    expect(isAuthorized('Bearer tajne-heslo', 'tajne-heslo')).toBe(false);
    expect(isAuthorized(basic('josef', 'spatne'), 'tajne-heslo')).toBe(false);
    expect(isAuthorized(noColon, 'tajne-heslo')).toBe(false);
  });
});

describe('listenAddress', () => {
  it('uses the default port on 127.0.0.1 without PORT', () => {
    expect(listenAddress({}, 4000)).toEqual({ port: 4000, host: '127.0.0.1' });
    expect(listenAddress({ PORT: '' }, 4000)).toEqual({ port: 4000, host: '127.0.0.1' });
  });

  it('binds 0.0.0.0 on the PORT the host gives', () => {
    expect(listenAddress({ PORT: '10000' }, 4000)).toEqual({ port: 10000, host: '0.0.0.0' });
  });

  it('refuses a PORT that is not a port', () => {
    expect(() => listenAddress({ PORT: 'abc' }, 4000)).toThrow('PORT must be a TCP port');
    expect(() => listenAddress({ PORT: '70000' }, 4000)).toThrow('PORT must be a TCP port');
  });
});
```

Command: `pnpm exec vitest run --project unit scripts/test/proto-auth.test.ts 2>&1 | tail -6` → `Tests  7 passed (7)`.

### Step 3: edit `scripts/proto/serve.ts` (four edits)

(a) Anchor (verbatim, one line): `import { catalogs, createT, type Locale, type MessageKey } from '@shoebox/i18n';`
Replace with the same line followed by a new line `import { AUTH_REALM, isAuthorized, listenAddress } from './auth';` (so `./auth` comes right before the `./pipeline` import).

(b) Anchor (verbatim): `  readonly now?: () => number;` (inside `ProtoServerOptions`). Replace with:

```ts
  readonly now?: () => number;
  /** HTTP Basic password for the hosted page (PROTO_PASSWORD); unset or empty = open. */
  readonly password?: string;
```

(c) Anchor (verbatim, three lines):

```ts
  return createServer((request, response) => {
    void handle(request, response);
  });
```

Replace with:

```ts
  return createServer((request, response) => {
    if (!isAuthorized(request.headers.authorization, options.password)) {
      response.writeHead(401, { 'www-authenticate': `Basic realm="${AUTH_REALM}", charset="UTF-8"` });
      response.end();
      return;
    }
    void handle(request, response);
  });
```

(d) Anchor (verbatim, four lines):

```ts
  const server = createProtoServer({ getClient });
  return new Promise((resolve) => {
    server.listen(PROTO_PORT, '127.0.0.1', () => {
      process.stdout.write(`proto page: http://localhost:${PROTO_PORT}\n`);
```

Replace with:

```ts
  const server = createProtoServer({ getClient, password: process.env.PROTO_PASSWORD });
  const { port, host } = listenAddress(process.env, PROTO_PORT);
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      process.stdout.write(`proto page: http://localhost:${port}\n`);
```

Command: `pnpm exec biome check --write scripts/proto scripts/test/proto-auth.test.ts 2>&1 | tail -3` (formatting changes from Biome are allowed in these files, nothing else) then `pnpm exec tsc -p scripts/proto/tsconfig.json 2>&1 | tail -3` → no output.

### Step 4: create `render.yaml` at the repo root, probe the server

```yaml
# Render blueprint for the hosted prototype page only (decisions 2026-10-18 [proto]).
# Production stays on Cloud Run europe-west1. Secrets are entered in the Render dashboard.
services:
  - type: web
    name: shoebox-proto
    runtime: node
    region: frankfurt
    plan: free
    branch: phase/0
    autoDeploy: true
    buildCommand: npx --yes pnpm@10.28.0 install --frozen-lockfile
    startCommand: node scripts/proto-serve.mjs
    envVars:
      - key: NODE_VERSION
        value: "22"
      - key: SHOEBOX_LLM_MODEL
        value: gemini-3.8-flash
      - key: GEMINI_API_KEY
        sync: false
      - key: PROTO_PASSWORD
        sync: false
```

Probe (one Bash call; no API key exists, never call a real API):
`PW=probe BAD=wrong; (PORT=4123 PROTO_PASSWORD="$PW" node scripts/proto-serve.mjs > /tmp/p0039.log 2>&1 &) ; sleep 8; curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:4123/; curl -s -o /dev/null -w '%{http_code} ' -u "x:$BAD" http://127.0.0.1:4123/; curl -s -o /dev/null -w '%{http_code}\n' -u "x:$PW" http://127.0.0.1:4123/; pkill -f proto-serve.mjs; head -2 /tmp/p0039.log`
Expected: `401 401 200` and `proto page: http://localhost:4123`. Then without env: `(node scripts/proto-serve.mjs > /tmp/p0039b.log 2>&1 &) ; sleep 8; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/; pkill -f proto-serve.mjs` → `200`.

### Step 5: guards, report, push

`pnpm lint 2>&1 | tail -4 && pnpm depcruise 2>&1 | tail -2 && python3 scripts/pii_guard.py 2>&1 | tail -1 && python3 scripts/context_lint.py 2>&1 | tail -1 && git diff --stat origin/phase/0 | tail -6` → lint and depcruise clean, `pii_guard: OK`, `context lint: OK`, only the files of §3 plus decisions.md, this brief and the report. Write the report (§9), set Status to `review`, commit, `git push -u origin task/0039-proto-render 2>&1 | tail -5`. Do not open a PR.

## 5. Do not touch

Everything not in §3. No new dependency. Never write a key or password into any file.

## 6. Commands

See the steps. Unit test: `pnpm exec vitest run --project unit scripts/test/proto-auth.test.ts`.

## 7. Acceptance

- [ ] 7 tests pass; tsc clean; Biome clean.
- [ ] Probe: `401 401 200` with `PROTO_PASSWORD`, `200` locally without it.
- [ ] `render.yaml` present; no secret values in it.

## 8. Stop and ask

- An anchor does not match exactly once: STOP.
- The probe does not give the expected codes: STOP, paste the log's last lines.

## 9. Report

`docs/tasks/0039-report.md`: Status, branch, commits, command results (last lines), probe codes, deviations.

## Risk list (for the reviewer)

- Basic auth over Render's HTTPS only; the password is shared, not per user (prototype).
- `npx pnpm@10.28.0` in the build command: [verify] on the first Render deploy log.

## Owner steps

See the orchestrator's reply in the project (Render sign-up, Blueprint from `render.yaml`, enter `GEMINI_API_KEY` and `PROTO_PASSWORD`).
