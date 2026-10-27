import { isValidIco } from './ico';
import type { AresAddress, AresClient, AresNameHit, AresSubject, RegistryResult } from './types';

export const ARES_BASE_URL = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest';

export interface AresClientOptions {
  /** default globalThis.fetch */
  fetch?: typeof fetch;
  /** default ARES_BASE_URL */
  baseUrl?: string;
  /** default 5000 */
  timeoutMs?: number;
  /** stamps fetchedAt; default () => new Date() */
  now?: () => Date;
}

/** Loose shape of the ARES 200 body; only `ico` and `obchodniJmeno` are checked. */
interface RawAresSubject {
  ico: string;
  obchodniJmeno: string;
  sidlo?: Partial<Record<keyof AresAddress, unknown>> & Record<string, unknown>;
  dic?: string | null;
  pravniForma?: string | null;
  datumVzniku?: string | null;
  datumZaniku?: string | null;
  financniUrad?: string | null;
  czNace2008?: unknown;
  seznamRegistraci?: { stavZdrojeDph?: unknown };
}

function isRawSubject(body: unknown): body is RawAresSubject {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.ico === 'string' && typeof b.obchodniJmeno === 'string';
}

function mapSubject(raw: RawAresSubject): AresSubject {
  const s = raw.sidlo ?? {};
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    ico: raw.ico,
    obchodniJmeno: raw.obchodniJmeno.trim().replace(/ +/g, ' '),
    sidlo: {
      textovaAdresa: str(s.textovaAdresa),
      kodStatu: str(s.kodStatu),
      nazevUlice: str(s.nazevUlice),
      cisloDomovni: num(s.cisloDomovni),
      cisloOrientacni: num(s.cisloOrientacni),
      nazevObce: str(s.nazevObce),
      nazevCastiObce: str(s.nazevCastiObce),
      psc: num(s.psc),
    },
    dic: str(raw.dic),
    pravniForma: str(raw.pravniForma),
    datumVzniku: str(raw.datumVzniku),
    datumZaniku: str(raw.datumZaniku),
    financniUrad: str(raw.financniUrad),
    czNace2008: Array.isArray(raw.czNace2008)
      ? raw.czNace2008.filter((c): c is string => typeof c === 'string')
      : [],
    dphAktivni: raw.seznamRegistraci?.stavZdrojeDph === 'AKTIVNI',
  };
}

/** Never throws and never logs: every failure becomes a `not_found` or `unavailable` result. */
export function createAresClient(options: AresClientOptions = {}): AresClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? ARES_BASE_URL;
  const timeoutMs = options.timeoutMs ?? 5000;
  const now = options.now ?? (() => new Date());

  return {
    async searchByName(name: string): Promise<RegistryResult<readonly AresNameHit[]>> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(`${baseUrl}/ekonomicke-subjekty/vyhledat`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ obchodniJmeno: name, pocet: 10 }),
          signal: controller.signal,
        });
        if (!response.ok) return { status: 'unavailable', reason: 'http_error' };
        const body: unknown = await response.json();
        const list = (body as { ekonomickeSubjekty?: unknown } | null)?.ekonomickeSubjekty;
        if (!Array.isArray(list)) return { status: 'unavailable', reason: 'http_error' };
        const hits: AresNameHit[] = [];
        for (const item of list) {
          if (isRawSubject(item)) {
            const dic = (item as { dic?: unknown }).dic;
            hits.push({
              ico: item.ico,
              name: item.obchodniJmeno.trim().replace(/ +/g, ' '),
              dic: typeof dic === 'string' ? dic : null,
            });
          }
        }
        return { status: 'ok', data: hits, fetchedAt: now().toISOString() };
      } catch {
        if (controller.signal.aborted) return { status: 'unavailable', reason: 'timeout' };
        return { status: 'unavailable', reason: 'http_error' };
      } finally {
        clearTimeout(timer);
      }
    },

    async subject(ico: string): Promise<RegistryResult<AresSubject>> {
      if (!isValidIco(ico)) return { status: 'not_found', fetchedAt: now().toISOString() };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(`${baseUrl}/ekonomicke-subjekty/${ico}`, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (response.status === 404) return { status: 'not_found', fetchedAt: now().toISOString() };
        if (!response.ok) return { status: 'unavailable', reason: 'http_error' };
        const body: unknown = await response.json();
        if (!isRawSubject(body)) return { status: 'unavailable', reason: 'http_error' };
        return { status: 'ok', data: mapSubject(body), fetchedAt: now().toISOString() };
      } catch {
        if (controller.signal.aborted) return { status: 'unavailable', reason: 'timeout' };
        return { status: 'unavailable', reason: 'http_error' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
