# 0018a: Registry client interfaces (ARES, CRPDPH, VIES, ČNB)

Status: done
Ticket: P0-TEST-02 (part a of 2) | Depends on: none (P0-REPO-01, P0-TEST-01 merged) | Base commit: head of phase/0 | Branch: task/0018-registries | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Give `@shoebox/registries` the typed client interfaces for ARES, CRPDPH, VIES and ČNB and the shared `RegistryResult<T>` type, so validation and the eval harness can depend on one contract. Brief 0018b then builds the fakes in `@shoebox/testkit` on top of it (same branch, one PR).

## 2. Context

Work mechanically: write each file with **one Write call** using the exact content below, do not re-read a file you just wrote, do not explore the repo. Commit after each step as `0018a step k`.

Spec lines (pasted; do not open `docs/v3/`):

- M03 §4.3: "Clients (`packages/registries`): `AresClient.subject(ico)`, `CrpdphClient.status(dics[])` (`getStatusNespolehlivySubjektRozsirenyV2`, batches of ≤ 100, digits without `CZ`), `ViesClient.check(country, number, requester)` (POST `check-vat-number` with our own VAT ID as requester to obtain `requestIdentifier`). Each returns `RegistryResult<T> = {status:'ok', data:T, fetchedAt} | {status:'not_found', fetchedAt} | {status:'unavailable', reason, cachedData?:T, cachedAt?}`."
- M03 §4.3 step 3: "Failure (timeout, HTTP 5xx, CRPDPH `statusCode 2|3`, VIES `MS_UNAVAILABLE|SERVICE_UNAVAILABLE|TIMEOUT|*_MAX_CONCURRENT_*`) … the dependent rules pass with state 'unverified'". Registries never block a document.
- 03 ADR-010 layout: "registries/ ARES REST, CRPDPH SOAP, VIES REST, ČNB rates clients (+ caching, rate limits)". The real HTTP/SOAP clients, caching and rate limits are **not** in this ticket.
- CRPDPH `status.statusCode` (research, [O] WSDL): `0` OK; `1` OK but only the first 100 DIČ answered; `2` technological outage 0:00–0:10; `3` service unavailable. Subject fields: `dic` (digits without `CZ`), `nespolehlivyPlatce` `ANO|NE|NENALEZEN`, `datumZverejneniNespolehlivosti` (only when `ANO`), `cisloFu`, V2 `typSubjektu` `PLATCE_DPH|IDENTIFIKOVANA_OSOBA|SKUPINA_DPH|NENALEZEN|NESPOLEHLIVA_OSOBA`, `zverejneneUcty/ucet[]` with `datumZverejneni`, `datumZverejneniUkonceni?`, `standardniUcet` (`predcisli?`, `cislo`, `kodBanky`) or `nestandardniUcet` (`cislo`).
- ARES `EkonomickySubjekt` ([O]): `ico`, `obchodniJmeno`, `sidlo`, `pravniForma`, `datumVzniku`, `datumZaniku`, `dic` (with `CZ`). VIES response ([O]): `countryCode`, `vatNumber`, `requestDate`, `valid`, `requestIdentifier`, `name`, `address`. ČNB `exrates/daily` ([O]): `validFor`, `order`, `currencyCode`, `amount`, `rate`.
- Hard rule 1: a rate is never a float in our types; the ČNB `rate` is a decimal string. The 100-DIČ limit is an API limit, not a law value, so it may live in `packages/registries`.

The step-2 edit anchors on `packages/registries/src/index.ts` (the whole file):

```ts
export const packageName = '@shoebox/registries' as const;
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/registries/src/types.ts` | new | `RegistryResult`, the four client interfaces and their data types, `crpdphUnavailableReason` |
| `packages/registries/src/index.ts` | edit | re-export `./types` |

No other file may change. `docs/tasks/0018a-report.md` is written in §9.

## 4. Steps

0. **Setup.** `git fetch origin phase/0 && git checkout -b task/0018-registries origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3`
   Expected: `Done in …`.

1. **New `packages/registries/src/types.ts`** (exact content):

```ts
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
```

   Run `pnpm --filter @shoebox/registries typecheck 2>&1 | tail -10`. Expected: no `error TS`. Commit `0018a step 1`.

2. **Edit `packages/registries/src/index.ts`** so the whole file reads:

```ts
export const packageName = '@shoebox/registries' as const;
export * from './types';
```

   Run `pnpm --filter @shoebox/registries typecheck 2>&1 | tail -10 && pnpm exec biome check packages/registries 2>&1 | tail -5`. Expected: no `error TS`; biome `No fixes applied` / no errors. Commit `0018a step 2`.

## 5. Do not touch

- Everything outside §3, in particular `packages/testkit/**` (brief 0018b, and briefs 0019/0020 in parallel), `packages/validation/**`, root config, CI files, `pnpm-lock.yaml`.
- No npm dependency (hard rule 7). No network code: interfaces and one pure helper only.
- No real personal data (hard rule 4). Never push to `main` (hard rule 8).

## 6. Commands

From the repo root:

- `pnpm --filter @shoebox/registries test 2>&1 | tail -30`: the existing smoke test passes, 0 failed.
- `pnpm --filter @shoebox/registries typecheck 2>&1 | tail -30`: no `error TS`.
- `pnpm lint 2>&1 | tail -30`: no errors.

## 7. Acceptance

- [ ] `packages/registries/src/types.ts` exports `RegistryResult<T>` exactly as M03 §4.3 (`ok` with `data` and `fetchedAt`, `not_found` with `fetchedAt`, `unavailable` with `reason`, optional `cachedData`, `cachedAt`).
- [ ] It exports `AresClient`, `CrpdphClient`, `ViesClient`, `CnbClient` and `RegistryClients`; `CrpdphStatusCode` is `0 | 1 | 2 | 3`.
- [ ] Typecheck and `pnpm lint` clean; `git diff --stat origin/phase/0` lists only the §3 files (plus the report).
- The ticket acceptance test (`fake-registries`) is in brief 0018b.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a command fails twice;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0018a-report.md` (600 tokens at most), set `Status: review` in this brief, commit `0018a report`, then `git push -u origin task/0018-registries 2>&1 | tail -5`. Do not open a PR: brief 0018b continues on this branch and the orchestrator opens one PR after it. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -30`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

- `packages/registries/src/types.ts`: `RegistryResult` must match M03 §4.3; `crpdphUnavailableReason` must map 2 → `crpdph_outage`, 3 → `crpdph_unavailable`, 0 and 1 → null (status 1 is a usable answer); the ČNB `rate` must stay a string.

## Owner steps

None for this brief.
