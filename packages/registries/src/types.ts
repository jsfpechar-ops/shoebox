/**
 * Typed client interfaces for the public registries (M03 §4.3). The real ARES/CRPDPH/VIES/ČNB
 * clients come in a later ticket; `@shoebox/testkit` provides fakes that replay recorded responses
 * and simulate outages. Field names follow the registries' own payloads.
 * Dates are `YYYY-MM-DD` strings, instants ISO 8601 UTC strings. A ČNB rate is a decimal string,
 * never a float.
 */

export type RegistrySource = 'ares' | 'crpdph' | 'vies' | 'cnb';

export const REGISTRY_SOURCES: readonly RegistrySource[] = ['ares', 'crpdph', 'vies', 'cnb'];

/** Why a lookup failed. Every failure degrades to "neověřeno"; it never blocks a document. */
export type RegistryUnavailableReason =
  /** No answer within `registry.timeout_ms`. */
  | 'timeout'
  /** HTTP 5xx or a transport error. */
  | 'http_error'
  /** CRPDPH `statusCode 2`: technological outage 00:00–00:10. */
  | 'crpdph_outage'
  /** CRPDPH `statusCode 3`: service unavailable. */
  | 'crpdph_unavailable'
  /** VIES `MS_UNAVAILABLE`, `SERVICE_UNAVAILABLE`, `TIMEOUT` or `*_MAX_CONCURRENT_*`. */
  | 'vies_unavailable';

/** M03 §4.3: what every registry client returns. */
export type RegistryResult<T> =
  | { status: 'ok'; data: T; fetchedAt: string }
  | { status: 'not_found'; fetchedAt: string }
  | { status: 'unavailable'; reason: RegistryUnavailableReason; cachedData?: T; cachedAt?: string };

// ARES (REST, `GET /ekonomicke-subjekty/{ico}`)

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

export interface AresSubject {
  /** 8 digits. */
  ico: string;
  obchodniJmeno: string;
  sidlo: AresAddress;
  /** Full DIČ with the `CZ` prefix, or null. */
  dic: string | null;
  pravniForma: string | null;
  datumVzniku: string | null;
  datumZaniku: string | null;
  /** 3-digit code of the tax office (finanční úřad), or null. */
  financniUrad?: string | null;
  czNace2008?: readonly string[];
  /** `seznamRegistraci.stavZdrojeDph === 'AKTIVNI'`: registered for VAT (payer or identified person). */
  dphAktivni?: boolean;
}

export interface AresClient {
  /** HTTP 404 → `not_found`. */
  subject(ico: string): Promise<RegistryResult<AresSubject>>;
}

// CRPDPH (SOAP, `getStatusNespolehlivySubjektRozsirenyV2`)

/** 0 OK; 1 OK but only the first 100 DIČ answered; 2 outage 00:00–00:10; 3 service unavailable. */
export type CrpdphStatusCode = 0 | 1 | 2 | 3;

export type CrpdphNespolehlivyPlatce = 'ANO' | 'NE' | 'NENALEZEN';

export type CrpdphTypSubjektu =
  | 'PLATCE_DPH'
  | 'IDENTIFIKOVANA_OSOBA'
  | 'SKUPINA_DPH'
  | 'NENALEZEN'
  | 'NESPOLEHLIVA_OSOBA';

export type CrpdphAccountNumber =
  | { kind: 'standard'; predcisli: string | null; cislo: string; kodBanky: string }
  | { kind: 'nonstandard'; cislo: string };

export interface CrpdphPublishedAccount {
  datumZverejneni: string;
  datumZverejneniUkonceni: string | null;
  ucet: CrpdphAccountNumber;
}

export interface CrpdphSubject {
  /** 1–10 digits, without the `CZ` prefix. */
  dic: string;
  nespolehlivyPlatce: CrpdphNespolehlivyPlatce;
  typSubjektu: CrpdphTypSubjektu;
  /** Present only when `nespolehlivyPlatce` is `ANO`. */
  datumZverejneniNespolehlivosti: string | null;
  cisloFu: string | null;
  nazevSubjektu: string | null;
  zverejneneUcty: CrpdphPublishedAccount[];
}

/** A successful CRPDPH answer; status codes 2 and 3 become `unavailable` results instead. */
export interface CrpdphResponse {
  statusCode: 0 | 1;
  statusText: string;
  odpovedGenerovana: string;
  subjects: CrpdphSubject[];
}

/** CRPDPH answers at most this many DIČ per call (API limit, not a law value). */
export const CRPDPH_MAX_DICS_PER_CALL = 100;

/** Maps a CRPDPH status code to the failure it means, or null when the answer is usable. */
export function crpdphUnavailableReason(code: CrpdphStatusCode): RegistryUnavailableReason | null {
  if (code === 2) return 'crpdph_outage';
  if (code === 3) return 'crpdph_unavailable';
  return null;
}

export interface CrpdphClient {
  /** 1 to `CRPDPH_MAX_DICS_PER_CALL` DIČ, digits only without `CZ`; otherwise rejects with RangeError. */
  status(dics: readonly string[]): Promise<RegistryResult<CrpdphResponse>>;
}

// VIES (REST, `POST check-vat-number`)

export interface ViesRequester {
  countryCode: string;
  vatNumber: string;
}

export interface ViesResult {
  countryCode: string;
  vatNumber: string;
  valid: boolean;
  requestDate: string;
  /** Proof of the check; present when a requester was sent and the number is valid. */
  requestIdentifier: string | null;
  name: string | null;
  address: string | null;
}

export interface ViesClient {
  /** An invalid number is `ok` with `valid: false`, not `not_found`. */
  check(
    countryCode: string,
    vatNumber: string,
    requester: ViesRequester,
  ): Promise<RegistryResult<ViesResult>>;
}

// ČNB daily fixing (`GET /cnbapi/exrates/daily?date=YYYY-MM-DD`)

export interface CnbRate {
  currencyCode: string;
  /** Unit count the rate is quoted for (1, or 100 for JPY/HUF). */
  amount: number;
  /** CZK per `amount` units, a decimal string with a dot (e.g. `"24.335"`). Never a float. */
  rate: string;
}

export interface CnbDailyRates {
  validFor: string;
  order: number;
  rates: CnbRate[];
}

export interface CnbClient {
  /** No fixing recorded for that date → `not_found`. */
  daily(date: string): Promise<RegistryResult<CnbDailyRates>>;
}

/** All four clients, as the pipeline and the eval runner receive them. */
export interface RegistryClients {
  ares: AresClient;
  crpdph: CrpdphClient;
  vies: ViesClient;
  cnb: CnbClient;
}
