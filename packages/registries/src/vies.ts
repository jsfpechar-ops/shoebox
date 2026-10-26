import type { RegistryResult, ViesClient, ViesRequester, ViesResult } from './types';

export const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

export interface ViesClientOptions {
  /** default globalThis.fetch */
  fetch?: typeof fetch;
  /** default VIES_URL */
  baseUrl?: string;
  /** default 5000 */
  timeoutMs?: number;
  /** stamps fetchedAt; default () => new Date() */
  now?: () => Date;
}

/** VIES prints `---` or an empty string for names and addresses it does not publish. */
function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' || t === '---' ? null : t;
}

/** Never throws and never logs: every failure becomes an `unavailable` result. */
export function createViesClient(options: ViesClientOptions = {}): ViesClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? VIES_URL;
  const timeoutMs = options.timeoutMs ?? 5000;
  const now = options.now ?? (() => new Date());

  return {
    async check(
      countryCode: string,
      vatNumber: string,
      requester: ViesRequester,
    ): Promise<RegistryResult<ViesResult>> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            countryCode,
            vatNumber,
            requesterMemberStateCode: requester.countryCode,
            requesterNumber: requester.vatNumber,
          }),
          signal: controller.signal,
        });
        if (!response.ok) return { status: 'unavailable', reason: 'http_error' };
        const body = (await response.json()) as Record<string, unknown> | null;
        if (typeof body !== 'object' || body === null) {
          return { status: 'unavailable', reason: 'http_error' };
        }

        const wrappers = Array.isArray(body.errorWrappers) ? body.errorWrappers : [];
        if (wrappers.length > 0) {
          const code = (wrappers[0] as { error?: unknown } | null)?.error;
          if (code === 'INVALID_INPUT') {
            return {
              status: 'ok',
              data: {
                countryCode,
                vatNumber,
                valid: false,
                requestDate: now().toISOString(),
                requestIdentifier: null,
                name: null,
                address: null,
              },
              fetchedAt: now().toISOString(),
            };
          }
          return { status: 'unavailable', reason: 'vies_unavailable' };
        }

        if (typeof body.valid !== 'boolean') return { status: 'unavailable', reason: 'http_error' };
        return {
          status: 'ok',
          data: {
            countryCode: typeof body.countryCode === 'string' ? body.countryCode : countryCode,
            vatNumber: typeof body.vatNumber === 'string' ? body.vatNumber : vatNumber,
            valid: body.valid,
            requestDate:
              typeof body.requestDate === 'string' ? body.requestDate : now().toISOString(),
            requestIdentifier: clean(body.requestIdentifier),
            name: clean(body.name),
            address: clean(body.address),
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
