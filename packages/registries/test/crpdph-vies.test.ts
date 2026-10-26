import { describe, expect, it } from 'vitest';
import { createCrpdphClient, createViesClient, parseCrpdphResponse } from '../src/index';

// Synthetic values in the live answer's shape (hard rule 4).
const CRPDPH_OK = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body><StatusNespolehlivySubjektRozsirenyResponse xmlns="http://adis.mfcr.cz/rozhraniCRPDPH/"><status odpovedGenerovana="2026-10-26" statusCode="0" statusText="OK"/><statusSubjektu typSubjektu="PLATCE_DPH" dic="25596641" nespolehlivyPlatce="NE" cisloFu="13"><zverejneneUcty><ucet datumZverejneni="2013-04-09"><standardniUcet predcisli="19" cislo="2000145399" kodBanky="0800"/></ucet><ucet datumZverejneni="2015-08-06" datumZverejneniUkonceni="2020-01-01"><nestandardniUcet cislo="SK3112000000198742637541"/></ucet></zverejneneUcty><nazevSubjektu>TESTOVACI FIRMA S.R.O.     </nazevSubjektu></statusSubjektu><statusSubjektu typSubjektu="NESPOLEHLIVA_OSOBA" dic="00006947" nespolehlivyPlatce="ANO" datumZverejneniNespolehlivosti="2024-05-01" cisloFu="7"><nazevSubjektu>JINA FIRMA</nazevSubjektu></statusSubjektu></StatusNespolehlivySubjektRozsirenyResponse></soapenv:Body></soapenv:Envelope>`;

const status = (code: number) =>
  `<Envelope><Body><R><status odpovedGenerovana="2026-10-26" statusCode="${code}" statusText="X"/></R></Body></Envelope>`;

function fakeFetch(
  body: string,
  init: { status?: number } = {},
  seen: unknown[] = [],
): typeof fetch {
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
          ucet: { kind: 'nonstandard', cislo: 'SK3112000000198742637541' },
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
    expect(url).toBe(
      'https://mojedane.gov.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP',
    );
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
    expect(
      await createCrpdphClient({ fetch: fakeFetch('', { status: 503 }) }).status(['1']),
    ).toEqual({
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
      new Promise((_r, reject) =>
        req.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      )) as unknown as typeof fetch;
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
    const r = await createViesClient({ fetch: fakeFetch(body, {}, seen), now: NOW }).check(
      'DE',
      '123456789',
      ME,
    );
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
    const err = (e: string) =>
      JSON.stringify({ actionSucceed: false, errorWrappers: [{ error: e }] });
    expect(
      await createViesClient({ fetch: fakeFetch(err('MS_UNAVAILABLE')) }).check('DE', '1', ME),
    ).toEqual({
      status: 'unavailable',
      reason: 'vies_unavailable',
    });
    const r = await createViesClient({ fetch: fakeFetch(err('INVALID_INPUT')), now: NOW }).check(
      'DE',
      'x',
      ME,
    );
    expect(r.status === 'ok' && r.data.valid).toBe(false);
  });
  it('maps HTTP errors', async () => {
    expect(
      await createViesClient({ fetch: fakeFetch('', { status: 500 }) }).check('DE', '1', ME),
    ).toEqual({
      status: 'unavailable',
      reason: 'http_error',
    });
  });
});
