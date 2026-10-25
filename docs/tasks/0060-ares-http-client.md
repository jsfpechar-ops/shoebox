# 0060: ARES HTTP client

Status: todo
Ticket: P1-ONB-01 (onboarding from IČO) | Depends on: none | Base commit: 37d843b | Branch: claude/project-thread-e840r7 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the real ARES client to `packages/registries`, implementing the existing `AresClient` interface over `fetch`. Onboarding (0062) uses it so the user types only an IČO and we fill in name, address, DIČ and VAT registration.

## 2. Context

- `packages/registries/src/types.ts` already has `AresClient`, `AresSubject`, `AresAddress`, `RegistryResult<T>`, `RegistryUnavailableReason`. Every failure degrades to `unavailable`; a lookup never throws.
- ARES REST (checked 2026-10-25 against the live service): `GET https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}`, `Accept: application/json`. 200 → JSON subject (fixture below). 404 → `{"kod":"NENALEZENO",...}`. Other fields we use: `sidlo.nazevUlice`, `sidlo.cisloDomovni` (number), `sidlo.cisloOrientacni` (number, optional), `sidlo.nazevObce`, `sidlo.nazevCastiObce`, `sidlo.psc` (number, e.g. `17000`), `financniUrad` (3-digit string), `czNace2008` (string[]), `seznamRegistraci.stavZdrojeDph` (`"AKTIVNI"` when VAT-registered).
- IČO checksum (mod 11): weights 8,7,6,5,4,3,2 on digits 1–7; `r = sum % 11`; check digit = `r === 0 ? 1 : r === 1 ? 0 : 11 - r`; it must equal digit 8. `27082440` and `12345679` are valid; `12345678` is not.
- Hard rules: no new npm dependency (use global `fetch`, `AbortController`). No document content or subject data in logs: the client logs nothing.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/registries/src/types.ts` | edit | optional ARES fields |
| `packages/registries/src/ico.ts` | new | `isValidIco` |
| `packages/registries/src/ares.ts` | new | `createAresClient` |
| `packages/registries/src/index.ts` | edit | exports |
| `packages/registries/test/fixtures/ares-27082440.json` | new | fixture (public company, not personal data) |
| `packages/registries/test/ares.test.ts` | new | tests below |

No other file may change.

## 4. Steps

1. `types.ts`: replace the `AresAddress` interface and add three optional fields at the end of `AresSubject` (all optional so `@shoebox/testkit` fakes still compile):

```ts
export interface AresAddress {
  textovaAdresa: string | null;
  kodStatu: string | null;
  nazevUlice?: string | null;
  /** Číslo popisné. */
  cisloDomovni?: number | null;
  cisloOrientacni?: number | null;
  nazevObce?: string | null;
  nazevCastiObce?: string | null;
  /** 5 digits as a number, e.g. 17000. */
  psc?: number | null;
}
```
and inside `AresSubject`, after `datumZaniku`:
```ts
  /** 3-digit code of the tax office (finanční úřad), or null. */
  financniUrad?: string | null;
  czNace2008?: readonly string[];
  /** `seznamRegistraci.stavZdrojeDph === 'AKTIVNI'`: registered for VAT (payer or identified person). */
  dphAktivni?: boolean;
```
Run `pnpm --filter @shoebox/registries typecheck 2>&1 | tail -30` → no errors.

2. `src/ico.ts`: `export function isValidIco(value: string): boolean` — true only for exactly 8 ASCII digits passing the checksum in §2.

3. `src/ares.ts`:
```ts
export const ARES_BASE_URL = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest';
export interface AresClientOptions {
  fetch?: typeof fetch;            // default globalThis.fetch
  baseUrl?: string;                // default ARES_BASE_URL
  timeoutMs?: number;              // default 5000
  now?: () => Date;                // stamps fetchedAt; default () => new Date()
}
export function createAresClient(options?: AresClientOptions): AresClient;
```
Behavior of `subject(ico)`:
- `ico` not valid per `isValidIco` → `{ status: 'not_found', fetchedAt }` without any request.
- GET `${baseUrl}/ekonomicke-subjekty/${ico}` with header `Accept: application/json` and an `AbortController` timeout.
- 404 → `not_found`. Abort/timeout → `unavailable`, reason `timeout`. Any other non-2xx, a network error, or a body that is not an object with string `ico` and string `obchodniJmeno` → `unavailable`, reason `http_error`.
- 200 → `ok` with `data` mapped: `ico`, `obchodniJmeno` trimmed and with runs of spaces collapsed to one; `sidlo` with the 8 address fields (missing → `null`); `dic` (missing → null); `pravniForma`, `datumVzniku`, `datumZaniku` (missing → null); `financniUrad` (missing → null); `czNace2008` (missing → `[]`); `dphAktivni: body.seznamRegistraci?.stavZdrojeDph === 'AKTIVNI'`. `fetchedAt` = `now().toISOString()`.
- Never throws, never logs.

4. `src/index.ts`: add `export * from './ares';` and `export * from './ico';`.

5. Fixture `test/fixtures/ares-27082440.json`, exactly:
```json
{
  "ico": "27082440",
  "obchodniJmeno": "Alza.cz  a.s.",
  "sidlo": {
    "kodStatu": "CZ",
    "nazevObce": "Praha",
    "nazevCastiObce": "Holešovice",
    "nazevUlice": "Jankovcova",
    "cisloDomovni": 1522,
    "cisloOrientacni": 53,
    "psc": 17000,
    "textovaAdresa": "Jankovcova 1522/53, Holešovice, 17000 Praha 7"
  },
  "pravniForma": "121",
  "financniUrad": "013",
  "datumVzniku": "2003-08-26",
  "dic": "CZ27082440",
  "czNace2008": ["532", "26110", "26300"],
  "seznamRegistraci": { "stavZdrojeDph": "AKTIVNI", "stavZdrojeRzp": "AKTIVNI" }
}
```
(The double space in the name is deliberate: it tests the collapse.)

6. `test/ares.test.ts` (write exactly; implement until it passes; do not edit it):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAresClient, isValidIco } from '../src/index';

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'ares-27082440.json'), 'utf8');
const NOW = () => new Date('2026-10-25T10:00:00.000Z');

function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return respond(url);
  }) as typeof fetch;
  return { fn, calls };
}

describe('isValidIco', () => {
  it('accepts valid and rejects invalid IČO', () => {
    expect(isValidIco('27082440')).toBe(true);
    expect(isValidIco('12345679')).toBe(true);
    expect(isValidIco('12345678')).toBe(false);
    expect(isValidIco('2708244')).toBe(false);
    expect(isValidIco('2708244O')).toBe(false);
    expect(isValidIco(' 27082440')).toBe(false);
  });
});

describe('createAresClient', () => {
  it('maps a found subject', async () => {
    const f = fakeFetch(() => new Response(FIXTURE, { status: 200 }));
    const r = await createAresClient({ fetch: f.fn, now: NOW }).subject('27082440');
    expect(f.calls).toEqual([
      'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/27082440',
    ]);
    expect(r).toEqual({
      status: 'ok',
      fetchedAt: '2026-10-25T10:00:00.000Z',
      data: {
        ico: '27082440',
        obchodniJmeno: 'Alza.cz a.s.',
        sidlo: {
          textovaAdresa: 'Jankovcova 1522/53, Holešovice, 17000 Praha 7',
          kodStatu: 'CZ',
          nazevUlice: 'Jankovcova',
          cisloDomovni: 1522,
          cisloOrientacni: 53,
          nazevObce: 'Praha',
          nazevCastiObce: 'Holešovice',
          psc: 17000,
        },
        dic: 'CZ27082440',
        pravniForma: '121',
        datumVzniku: '2003-08-26',
        datumZaniku: null,
        financniUrad: '013',
        czNace2008: ['532', '26110', '26300'],
        dphAktivni: true,
      },
    });
  });

  it('404 is not_found', async () => {
    const f = fakeFetch(() => new Response('{"kod":"NENALEZENO"}', { status: 404 }));
    const r = await createAresClient({ fetch: f.fn, now: NOW }).subject('12345679');
    expect(r).toEqual({ status: 'not_found', fetchedAt: '2026-10-25T10:00:00.000Z' });
  });

  it('an invalid IČO is not_found without a request', async () => {
    const f = fakeFetch(() => new Response(FIXTURE, { status: 200 }));
    const r = await createAresClient({ fetch: f.fn, now: NOW }).subject('12345678');
    expect(r.status).toBe('not_found');
    expect(f.calls).toEqual([]);
  });

  it('5xx, network error and a bad body are unavailable http_error', async () => {
    for (const respond of [
      () => new Response('oops', { status: 503 }),
      () => Promise.reject(new TypeError('fetch failed')),
      () => new Response('{"foo":1}', { status: 200 }),
      () => new Response('not json', { status: 200 }),
    ]) {
      const f = fakeFetch(respond);
      const r = await createAresClient({ fetch: f.fn, now: NOW }).subject('27082440');
      expect(r).toEqual({ status: 'unavailable', reason: 'http_error' });
    }
  });

  it('a slow answer is unavailable timeout', async () => {
    const slow = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as typeof fetch;
    const r = await createAresClient({ fetch: slow, now: NOW, timeoutMs: 20 }).subject('27082440');
    expect(r).toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('missing optional fields become null or empty', async () => {
    const body = JSON.stringify({ ico: '27082440', obchodniJmeno: 'X', sidlo: {} });
    const f = fakeFetch(() => new Response(body, { status: 200 }));
    const r = await createAresClient({ fetch: f.fn, now: NOW }).subject('27082440');
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.data.dic).toBeNull();
    expect(r.data.sidlo.psc).toBeNull();
    expect(r.data.czNace2008).toEqual([]);
    expect(r.data.dphAktivni).toBe(false);
  });
});
```

## 5. Do not touch

Everything outside §3, in particular `packages/testkit` and `apps/`. No new dependency. No live network call in tests.

## 6. Commands

- `pnpm --filter @shoebox/registries test -- ares 2>&1 | tail -30` → all pass.
- `pnpm --filter @shoebox/registries typecheck 2>&1 | tail -30` → no errors.
- `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30` → no errors (fakes still compile).
- `pnpm exec biome ci packages/registries 2>&1 | tail -30` → clean.

## 7. Acceptance

- [ ] All four commands in §6 pass.
- [ ] `git diff --stat` lists only §3 files plus the report.

## 8. Stop and ask

Stop and write the report if: an excerpt is not found; a test fails twice or seems wrong; 25 tool calls or about 50k tokens; a new dependency seems needed; a file outside §3 needs a change; a step is unclear.

## 9. Report

Write `docs/tasks/0060-report.md` (600 tokens at most) and set `Status: review`: files changed, each command with its last 5 lines, §7 ticked, deviations, questions.

## Risk list (for the reviewer)

`src/ares.ts` (never throws, timeout cleared, nothing logged).

## Owner steps

None.
