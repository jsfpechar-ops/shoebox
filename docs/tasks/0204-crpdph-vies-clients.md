# 0204: CRPDPH and VIES clients

Status: todo
Ticket: P1-REG-02 | Depends on: none | Base commit: 496b1e9 | Branch: task/0204-crpdph-vies | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0204-report.md

## 1. Objective

Clients for the Czech VAT payer register (CRPDPH: is the supplier a VAT payer, is it an unreliable payer, which bank accounts are published) and the EU VIES check. They let the app warn before the user pays an unreliable payer or a non-published account. They never throw and never block a document.

## 2. Context

Interfaces already exist in `packages/registries/src/types.ts`: `CrpdphClient`, `CrpdphResponse`, `CrpdphSubject`, `CrpdphPublishedAccount`, `CrpdphAccountNumber`, `crpdphUnavailableReason`, `CRPDPH_MAX_DICS_PER_CALL`, `ViesClient`, `ViesResult`, `ViesRequester`, `RegistryResult`. Do not change them. Copy the style of `packages/registries/src/ares.ts` (options with `fetch`, `baseUrl`, `timeoutMs`, `now`; AbortController timeout; every failure becomes `unavailable`).

Verified by the orchestrator on 2026-10-26 (live calls):
- CRPDPH endpoint `https://mojedane.gov.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP` (the WSDL `soap:address`; the old `adisrws.mfcr.cz` host no longer answers POSTs). Header `SOAPAction: http://adis.mfcr.cz/rozhraniCRPDPH/getStatusNespolehlivySubjektRozsirenyV2`, `Content-Type: text/xml; charset=utf-8`. Body:
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><StatusNespolehlivySubjektRozsirenyV2Request xmlns="http://adis.mfcr.cz/rozhraniCRPDPH/"><dic>…</dic><dic>…</dic></StatusNespolehlivySubjektRozsirenyV2Request></soapenv:Body></soapenv:Envelope>`
  The answer is the `CRPDPH_OK` fixture in the test below (shape copied from the live answer, values synthetic).
- VIES: `POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`, JSON `{countryCode, vatNumber, requesterMemberStateCode, requesterNumber}`. OK answer: `{countryCode, vatNumber, requestDate, valid, requestIdentifier, name, address, …}`; `requestIdentifier` and `name` may be `""` or `"---"` (map both to null). Outage answer: `{"actionSucceed":false,"errorWrappers":[{"error":"MS_UNAVAILABLE"}]}`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/registries/src/crpdph.ts` | new | `createCrpdphClient`, `parseCrpdphResponse` |
| `packages/registries/src/vies.ts` | new | `createViesClient` |
| `packages/registries/test/crpdph-vies.test.ts` | new | tests below, verbatim |
| `packages/registries/src/index.ts` | edit | `export * from './crpdph';` and `export * from './vies';` |

No other file may change. No new dependency: parse the XML with small regexes over the fixed tag and attribute names (namespace prefixes optional).

## 4. Steps

1. `crpdph.ts`:

```ts
export const CRPDPH_URL = 'https://mojedane.gov.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP';
export interface CrpdphClientOptions { fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number; now?: () => Date }
/** null when the XML has no <status statusCode=…>. Trims text (nazevSubjektu has trailing spaces). */
export function parseCrpdphResponse(xml: string): { statusCode: 0 | 1 | 2 | 3; statusText: string; odpovedGenerovana: string; subjects: CrpdphSubject[] } | null;
export function createCrpdphClient(options?: CrpdphClientOptions): CrpdphClient;
```
   `status(dics)`: RangeError (reject) if 0 or more than `CRPDPH_MAX_DICS_PER_CALL` items or any item not `^\d{1,10}$`. HTTP not ok, unparsable XML, timeout → `unavailable` (`http_error` / `timeout`). Status code 2/3 → `unavailable` with `crpdphUnavailableReason`. Else `ok` with `fetchedAt`. A subject with `typSubjektu="NENALEZEN"` stays in `subjects`. `datumZverejneniNespolehlivosti` from that attribute or null; `datumZverejneniUkonceni` from that attribute or null; missing `predcisli` → null.

2. `vies.ts`:

```ts
export const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
export interface ViesClientOptions { fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number; now?: () => Date }
export function createViesClient(options?: ViesClientOptions): ViesClient;
```
   `check`: body as in §2. An answer with `errorWrappers`: error `INVALID_INPUT` → `ok` with `valid: false` (name/address null, `requestDate` = now ISO, `requestIdentifier` null); any other error → `unavailable` `vies_unavailable`. HTTP not ok → `unavailable` `http_error`. Timeout → `timeout`.

3. Test file, verbatim:

```ts
import { describe, expect, it } from 'vitest';
import { createCrpdphClient, createViesClient, parseCrpdphResponse } from '../src/index';

// Synthetic values in the live answer's shape (hard rule 4).
const CRPDPH_OK = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body><StatusNespolehlivySubjektRozsirenyResponse xmlns="http://adis.mfcr.cz/rozhraniCRPDPH/"><status odpovedGenerovana="2026-10-26" statusCode="0" statusText="OK"/><statusSubjektu typSubjektu="PLATCE_DPH" dic="25596641" nespolehlivyPlatce="NE" cisloFu="13"><zverejneneUcty><ucet datumZverejneni="2013-04-09"><standardniUcet predcisli="19" cislo="2000145399" kodBanky="0800"/></ucet><ucet datumZverejneni="2015-08-06" datumZverejneniUkonceni="2020-01-01"><nestandardniUcet cislo="SK2909000000005033845424"/></ucet></zverejneneUcty><nazevSubjektu>TESTOVACI FIRMA S.R.O.     </nazevSubjektu></statusSubjektu><statusSubjektu typSubjektu="NESPOLEHLIVA_OSOBA" dic="00006947" nespolehlivyPlatce="ANO" datumZverejneniNespolehlivosti="2024-05-01" cisloFu="7"><nazevSubjektu>JINA FIRMA</nazevSubjektu></statusSubjektu></StatusNespolehlivySubjektRozsirenyResponse></soapenv:Body></soapenv:Envelope>`;

const status = (code: number) =>
  `<Envelope><Body><R><status odpovedGenerovana="2026-10-26" statusCode="${code}" statusText="X"/></R></Body></Envelope>`;

function fakeFetch(body: string, init: { status?: number } = {}, seen: unknown[] = []): typeof fetch {
  return (async (url: unknown, req: unknown) => {
    seen.push({ url, req });
    return new Response(body, { status: init.status ?? 200 });
  }) as typeof fetch;
}

const NOW = () => new Date('2026-10-26T08:00:00Z');

describe('parseCrpdphResponse', () => {
  it('reads subjects, accounts and the unreliable flag', () => {
    const r = parseCrpdphResponse(CRPDPH_OK);
    expect(r?.statusCode).toBe(0);
    expect(r?.subjects).toHaveLength(2);
    const [a, b] = r?.subjects ?? [];
    expect(a).toEqual({
      dic: '25596641',
      nespolehlivyPlatce: 'NE',
      typSubjektu: 'PLATCE_DPH',
      datumZverejneniNespolehlivosti: null,
      cisloFu: '13',
      nazevSubjektu: 'TESTOVACI FIRMA S.R.O.',
      zverejneneUcty: [
        {
          datumZverejneni: '2013-04-09',
          datumZverejneniUkonceni: null,
          ucet: { kind: 'standard', predcisli: '19', cislo: '2000145399', kodBanky: '0800' },
        },
        {
          datumZverejneni: '2015-08-06',
          datumZverejneniUkonceni: '2020-01-01',
          ucet: { kind: 'nonstandard', cislo: 'SK2909000000005033845424' },
        },
      ],
    });
    expect(b?.nespolehlivyPlatce).toBe('ANO');
    expect(b?.datumZverejneniNespolehlivosti).toBe('2024-05-01');
    expect(b?.zverejneneUcty).toEqual([]);
  });
  it('returns null for junk', () => {
    expect(parseCrpdphResponse('<html>busy</html>')).toBeNull();
  });
});

describe('createCrpdphClient', () => {
  it('sends a SOAP request with every DIČ and returns ok', async () => {
    const seen: unknown[] = [];
    const c = createCrpdphClient({ fetch: fakeFetch(CRPDPH_OK, {}, seen), now: NOW });
    const r = await c.status(['25596641', '00006947']);
    expect(r.status).toBe('ok');
    const { url, req } = seen[0] as { url: string; req: RequestInit };
    expect(url).toBe('https://mojedane.gov.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP');
    expect(String(req.body)).toContain('<dic>25596641</dic><dic>00006947</dic>');
    expect((req.headers as Record<string, string>).SOAPAction).toBe(
      'http://adis.mfcr.cz/rozhraniCRPDPH/getStatusNespolehlivySubjektRozsirenyV2',
    );
  });
  it('maps outage codes and HTTP errors to unavailable', async () => {
    expect(await createCrpdphClient({ fetch: fakeFetch(status(2)) }).status(['1'])).toEqual({
      status: 'unavailable',
      reason: 'crpdph_outage',
    });
    expect(await createCrpdphClient({ fetch: fakeFetch(status(3)) }).status(['1'])).toEqual({
      status: 'unavailable',
      reason: 'crpdph_unavailable',
    });
    expect(await createCrpdphClient({ fetch: fakeFetch('', { status: 503 }) }).status(['1'])).toEqual({
      status: 'unavailable',
      reason: 'http_error',
    });
  });
  it('rejects bad input', async () => {
    const c = createCrpdphClient({ fetch: fakeFetch(CRPDPH_OK) });
    await expect(c.status([])).rejects.toThrow(RangeError);
    await expect(c.status(['CZ25596641'])).rejects.toThrow(RangeError);
    await expect(c.status(Array.from({ length: 101 }, () => '1'))).rejects.toThrow(RangeError);
  });
  it('times out', async () => {
    const slow = ((_u: unknown, req: RequestInit) =>
      new Promise((_r, reject) => req.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    expect(await createCrpdphClient({ fetch: slow, timeoutMs: 10 }).status(['1'])).toEqual({
      status: 'unavailable',
      reason: 'timeout',
    });
  });
});

describe('createViesClient', () => {
  const ME = { countryCode: 'CZ', vatNumber: '00006947' };
  it('reads a valid answer', async () => {
    const body = JSON.stringify({
      countryCode: 'DE',
      vatNumber: '123456789',
      requestDate: '2026-10-26T00:26:26.112Z',
      valid: true,
      requestIdentifier: 'WAPIAAAAX',
      name: 'Test GmbH',
      address: '---',
    });
    const seen: unknown[] = [];
    const r = await createViesClient({ fetch: fakeFetch(body, {}, seen), now: NOW }).check('DE', '123456789', ME);
    expect(r).toEqual({
      status: 'ok',
      fetchedAt: '2026-10-26T08:00:00.000Z',
      data: {
        countryCode: 'DE',
        vatNumber: '123456789',
        valid: true,
        requestDate: '2026-10-26T00:26:26.112Z',
        requestIdentifier: 'WAPIAAAAX',
        name: 'Test GmbH',
        address: null,
      },
    });
    const { req } = seen[0] as { req: RequestInit };
    expect(JSON.parse(String(req.body))).toEqual({
      countryCode: 'DE',
      vatNumber: '123456789',
      requesterMemberStateCode: 'CZ',
      requesterNumber: '00006947',
    });
  });
  it('maps MS_UNAVAILABLE to unavailable and INVALID_INPUT to invalid', async () => {
    const err = (e: string) => JSON.stringify({ actionSucceed: false, errorWrappers: [{ error: e }] });
    expect(await createViesClient({ fetch: fakeFetch(err('MS_UNAVAILABLE')) }).check('DE', '1', ME)).toEqual({
      status: 'unavailable',
      reason: 'vies_unavailable',
    });
    const r = await createViesClient({ fetch: fakeFetch(err('INVALID_INPUT')), now: NOW }).check('DE', 'x', ME);
    expect(r.status === 'ok' && r.data.valid).toBe(false);
  });
  it('maps HTTP errors', async () => {
    expect(await createViesClient({ fetch: fakeFetch('', { status: 500 }) }).check('DE', '1', ME)).toEqual({
      status: 'unavailable',
      reason: 'http_error',
    });
  });
});
```

   Implement until these tests pass; do not edit the test file.

4. Index exports.

## 5. Do not touch

Everything outside §3, including `types.ts`. Hard rules 4 and 7. Never call the live services from tests.

## 6. Commands

```
pnpm --filter @shoebox/registries test 2>&1 | tail -30
pnpm --filter @shoebox/registries typecheck 2>&1 | tail -30
pnpm exec biome check packages/registries 2>&1 | tail -30
```

## 7. Acceptance

- [ ] §6 passes.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0204-report.md`, 200 tokens at most. Set `Status: review`.

## Risk list (for the reviewer)

None beyond correctness; nothing here sends user data except DIČ/VAT numbers to public registries.
