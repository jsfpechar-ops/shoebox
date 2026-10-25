import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAresClient, isValidIco } from '../src/index';

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'ares-27082440.json'), 'utf8');
const NOW = () => new Date('2026-10-25T10:00:00.000Z');

function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL) => {
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
    const slow = ((_: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
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
