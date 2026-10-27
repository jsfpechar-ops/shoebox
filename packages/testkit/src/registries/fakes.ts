import type { Clock } from '@shoebox/domain';
import {
  type AresSubject,
  type CnbDailyRates,
  CRPDPH_MAX_DICS_PER_CALL,
  type CrpdphResponse,
  type CrpdphStatusCode,
  type CrpdphSubject,
  crpdphUnavailableReason,
  REGISTRY_SOURCES,
  type RegistryClients,
  type RegistryResult,
  type RegistrySource,
  type ViesRequester,
  type ViesResult,
} from '@shoebox/registries';
import { fakeClock } from '../clock';

/** Recorded registry answers the fakes replay, keyed as each registry is queried. */
export interface RegistryRecordings {
  /** Key: IČO (8 digits). */
  ares?: Readonly<Record<string, AresSubject>>;
  /** Key: DIČ digits without `CZ`. An unknown DIČ answers `NENALEZEN`. */
  crpdph?: Readonly<Record<string, CrpdphSubject>>;
  /** Key: country code + VAT number, e.g. `DE123456789`. An unknown number answers `valid: false`. */
  vies?: Readonly<Record<string, ViesResult>>;
  /** Key: `YYYY-MM-DD`. */
  cnb?: Readonly<Record<string, CnbDailyRates>>;
}

/** `recorded` replays; `unavailable` answers like an HTTP 5xx; `timeout` like a timeout. */
export type FakeRegistryMode = 'recorded' | 'unavailable' | 'timeout';

export interface FakeRegistryCall {
  source: RegistrySource;
  key: string;
}

export interface FakeRegistries extends RegistryClients {
  /** Switches one source, or all four when `source` is omitted. */
  simulate(mode: FakeRegistryMode, source?: RegistrySource): void;
  /** Makes CRPDPH answer with this status code (default 0). */
  simulateCrpdphStatus(code: CrpdphStatusCode): void;
  /** Every lookup in call order, outages included. */
  readonly calls: readonly FakeRegistryCall[];
}

export interface FakeRegistriesOptions {
  /** Stamps `fetchedAt`; default `fakeClock()`. */
  clock?: Clock;
}

const DIC_DIGITS = /^\d{1,10}$/;

/** Fake ARES/CRPDPH/VIES/ČNB clients: no network, deterministic, outages on demand. */
export function createFakeRegistries(
  recordings: RegistryRecordings = {},
  options: FakeRegistriesOptions = {},
): FakeRegistries {
  const clock = options.clock ?? fakeClock();
  const modes: Record<RegistrySource, FakeRegistryMode> = {
    ares: 'recorded',
    crpdph: 'recorded',
    vies: 'recorded',
    cnb: 'recorded',
  };
  let crpdphStatus: CrpdphStatusCode = 0;
  const calls: FakeRegistryCall[] = [];

  const now = (): string => new Date(clock.now()).toISOString();
  const ok = <T>(data: T): Promise<RegistryResult<T>> =>
    Promise.resolve({ status: 'ok', data, fetchedAt: now() });
  const notFound = <T>(): Promise<RegistryResult<T>> =>
    Promise.resolve({ status: 'not_found', fetchedAt: now() });

  /** Records the call; returns the simulated outage, or null to replay. */
  function lookup<T>(source: RegistrySource, key: string): Promise<RegistryResult<T>> | null {
    calls.push({ source, key });
    const mode = modes[source];
    if (mode === 'unavailable')
      return Promise.resolve({ status: 'unavailable', reason: 'http_error' });
    if (mode === 'timeout') return Promise.resolve({ status: 'unavailable', reason: 'timeout' });
    return null;
  }

  function notFoundSubject(dic: string): CrpdphSubject {
    return {
      dic,
      nespolehlivyPlatce: 'NENALEZEN',
      typSubjektu: 'NENALEZEN',
      datumZverejneniNespolehlivosti: null,
      cisloFu: null,
      nazevSubjektu: null,
      zverejneneUcty: [],
    };
  }

  return {
    ares: {
      subject(ico: string) {
        const down = lookup<AresSubject>('ares', ico);
        if (down) return down;
        const subject = recordings.ares?.[ico];
        return subject ? ok(subject) : notFound();
      },
      searchByName() {
        return ok([]);
      },
    },
    crpdph: {
      status(dics: readonly string[]) {
        if (dics.length === 0 || dics.length > CRPDPH_MAX_DICS_PER_CALL) {
          return Promise.reject(
            new RangeError(`CRPDPH takes 1 to ${CRPDPH_MAX_DICS_PER_CALL} DIČ, got ${dics.length}`),
          );
        }
        const bad = dics.find((dic) => !DIC_DIGITS.test(dic));
        if (bad !== undefined) {
          return Promise.reject(new RangeError(`CRPDPH takes DIČ digits without CZ, got ${bad}`));
        }
        const down = lookup<CrpdphResponse>('crpdph', dics.join(','));
        if (down) return down;
        const reason = crpdphUnavailableReason(crpdphStatus);
        if (reason) return Promise.resolve({ status: 'unavailable', reason });
        const statusCode = crpdphStatus === 1 ? 1 : 0;
        return ok<CrpdphResponse>({
          statusCode,
          statusText: statusCode === 1 ? 'OK, too many DIC' : 'OK',
          odpovedGenerovana: now().slice(0, 10),
          subjects: dics.map((dic) => recordings.crpdph?.[dic] ?? notFoundSubject(dic)),
        });
      },
    },
    vies: {
      check(countryCode: string, vatNumber: string, _requester: ViesRequester) {
        const key = `${countryCode}${vatNumber}`;
        const down = lookup<ViesResult>('vies', key);
        if (down) return down;
        const recorded = recordings.vies?.[key];
        return ok<ViesResult>(
          recorded ?? {
            countryCode,
            vatNumber,
            valid: false,
            requestDate: now(),
            requestIdentifier: null,
            name: null,
            address: null,
          },
        );
      },
    },
    cnb: {
      daily(date: string) {
        const down = lookup<CnbDailyRates>('cnb', date);
        if (down) return down;
        const rates = recordings.cnb?.[date];
        return rates ? ok(rates) : notFound();
      },
    },
    simulate(mode: FakeRegistryMode, source?: RegistrySource) {
      for (const s of REGISTRY_SOURCES) {
        if (source === undefined || source === s) modes[s] = mode;
      }
    },
    simulateCrpdphStatus(code: CrpdphStatusCode) {
      crpdphStatus = code;
    },
    get calls() {
      return calls;
    },
  };
}
