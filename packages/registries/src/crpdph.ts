import {
  CRPDPH_MAX_DICS_PER_CALL,
  type CrpdphAccountNumber,
  type CrpdphClient,
  type CrpdphNespolehlivyPlatce,
  type CrpdphPublishedAccount,
  type CrpdphResponse,
  type CrpdphStatusCode,
  type CrpdphSubject,
  type CrpdphTypSubjektu,
  crpdphUnavailableReason,
  type RegistryResult,
} from './types';

export const CRPDPH_URL =
  'https://mojedane.gov.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP';

const CRPDPH_SOAP_ACTION =
  'http://adis.mfcr.cz/rozhraniCRPDPH/getStatusNespolehlivySubjektRozsirenyV2';

export interface CrpdphClientOptions {
  /** default globalThis.fetch */
  fetch?: typeof fetch;
  /** default CRPDPH_URL */
  baseUrl?: string;
  /** default 5000 */
  timeoutMs?: number;
  /** stamps fetchedAt; default () => new Date() */
  now?: () => Date;
}

const NESPOLEHLIVY: readonly CrpdphNespolehlivyPlatce[] = ['ANO', 'NE', 'NENALEZEN'];
const TYPY: readonly CrpdphTypSubjektu[] = [
  'PLATCE_DPH',
  'IDENTIFIKOVANA_OSOBA',
  'SKUPINA_DPH',
  'NENALEZEN',
  'NESPOLEHLIVA_OSOBA',
];

/** Matches `<tag …>…</tag>` or `<tag …/>`; the namespace prefix is optional. */
function elements(xml: string, tag: string): { attrs: string; body: string }[] {
  const re = new RegExp(
    `<(?:[\\w-]+:)?${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>)`,
    'g',
  );
  const out: { attrs: string; body: string }[] = [];
  for (const m of xml.matchAll(re)) out.push({ attrs: m[1] ?? '', body: m[2] ?? '' });
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(` ${attrs}`);
  return m ? decode(m[1] ?? '') : null;
}

function text(xml: string, tag: string): string | null {
  const el = elements(xml, tag)[0];
  if (!el) return null;
  const t = decode(el.body).trim();
  return t === '' ? null : t;
}

function parseAccount(attrs: string, body: string): CrpdphPublishedAccount | null {
  const standard = elements(body, 'standardniUcet')[0];
  const nonstandard = elements(body, 'nestandardniUcet')[0];
  let ucet: CrpdphAccountNumber;
  if (standard) {
    const cislo = attr(standard.attrs, 'cislo');
    const kodBanky = attr(standard.attrs, 'kodBanky');
    if (cislo === null || kodBanky === null) return null;
    ucet = { kind: 'standard', predcisli: attr(standard.attrs, 'predcisli'), cislo, kodBanky };
  } else if (nonstandard) {
    const cislo = attr(nonstandard.attrs, 'cislo');
    if (cislo === null) return null;
    ucet = { kind: 'nonstandard', cislo };
  } else {
    return null;
  }
  return {
    datumZverejneni: attr(attrs, 'datumZverejneni') ?? '',
    datumZverejneniUkonceni: attr(attrs, 'datumZverejneniUkonceni'),
    ucet,
  };
}

function parseSubject(attrs: string, body: string): CrpdphSubject {
  const nesp = attr(attrs, 'nespolehlivyPlatce');
  const typ = attr(attrs, 'typSubjektu');
  const accounts = elements(body, 'ucet').flatMap((u) => {
    const acc = parseAccount(u.attrs, u.body);
    return acc ? [acc] : [];
  });
  return {
    dic: attr(attrs, 'dic') ?? '',
    nespolehlivyPlatce: NESPOLEHLIVY.find((v) => v === nesp) ?? 'NENALEZEN',
    typSubjektu: TYPY.find((v) => v === typ) ?? 'NENALEZEN',
    datumZverejneniNespolehlivosti: attr(attrs, 'datumZverejneniNespolehlivosti'),
    cisloFu: attr(attrs, 'cisloFu'),
    nazevSubjektu: text(body, 'nazevSubjektu'),
    zverejneneUcty: accounts,
  };
}

/** null when the XML has no <status statusCode=…>. Trims text (nazevSubjektu has trailing spaces). */
export function parseCrpdphResponse(xml: string): {
  statusCode: CrpdphStatusCode;
  statusText: string;
  odpovedGenerovana: string;
  subjects: CrpdphSubject[];
} | null {
  const status = elements(xml, 'status')[0];
  if (!status) return null;
  const code = attr(status.attrs, 'statusCode');
  if (code === null || !/^[0-3]$/.test(code)) return null;
  return {
    statusCode: Number(code) as CrpdphStatusCode,
    statusText: attr(status.attrs, 'statusText') ?? '',
    odpovedGenerovana: attr(status.attrs, 'odpovedGenerovana') ?? '',
    subjects: elements(xml, 'statusSubjektu').map((s) => parseSubject(s.attrs, s.body)),
  };
}

/** Never throws and never logs: every failure becomes an `unavailable` result, bad input rejects with RangeError. */
export function createCrpdphClient(options: CrpdphClientOptions = {}): CrpdphClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? CRPDPH_URL;
  const timeoutMs = options.timeoutMs ?? 5000;
  const now = options.now ?? (() => new Date());

  return {
    async status(dics: readonly string[]): Promise<RegistryResult<CrpdphResponse>> {
      if (
        dics.length === 0 ||
        dics.length > CRPDPH_MAX_DICS_PER_CALL ||
        !dics.every((d) => /^\d{1,10}$/.test(d))
      ) {
        throw new RangeError('CRPDPH: 1 to 100 DIČ, digits only');
      }
      const body =
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
        '<StatusNespolehlivySubjektRozsirenyV2Request xmlns="http://adis.mfcr.cz/rozhraniCRPDPH/">' +
        dics.map((d) => `<dic>${d}</dic>`).join('') +
        '</StatusNespolehlivySubjektRozsirenyV2Request></soapenv:Body></soapenv:Envelope>';

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: CRPDPH_SOAP_ACTION,
          },
          body,
          signal: controller.signal,
        });
        if (!response.ok) return { status: 'unavailable', reason: 'http_error' };
        const parsed = parseCrpdphResponse(await response.text());
        if (!parsed) return { status: 'unavailable', reason: 'http_error' };
        const reason = crpdphUnavailableReason(parsed.statusCode);
        if (reason) return { status: 'unavailable', reason };
        return {
          status: 'ok',
          data: {
            statusCode: parsed.statusCode as 0 | 1,
            statusText: parsed.statusText,
            odpovedGenerovana: parsed.odpovedGenerovana,
            subjects: parsed.subjects,
          },
          fetchedAt: now().toISOString(),
        };
      } catch {
        if (controller.signal.aborted) return { status: 'unavailable', reason: 'timeout' };
        return { status: 'unavailable', reason: 'http_error' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
