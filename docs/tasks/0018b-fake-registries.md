# 0018b: Fake registries in testkit (replay and outages)

Status: review
Ticket: P0-TEST-02 (part b of 2) | Depends on: 0018a (pushed on the same branch) | Base commit: head of task/0018-registries | Branch: task/0018-registries | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add `createFakeRegistries` to `@shoebox/testkit`: fake ARES, CRPDPH, VIES and ČNB clients that replay recorded answers with no network and can simulate outages and CRPDPH status codes. The validation tests and the eval runner use them, so a registry outage can be tested and never blocks a user's document.

## 2. Context

Work mechanically: write each file with **one Write call** using the exact content below, do not re-read a file you just wrote, do not explore the repo. Commit after each step as `0018b step k`.

Spec lines (pasted; do not open `docs/v3/`):

- M12 §4.10 Runner step 2: "Ingests every file through the real pipeline with fake registries (`packages/testkit/fakes`, recorded ARES/VIES/CRPDPH/ČNB responses) and the LLM in the chosen mode." This repo keeps them in `packages/testkit/src/registries/` (parallel briefs 0019/0020 also add to testkit; the folder avoids conflicts).
- M03 §4.3: every client returns `RegistryResult<T> = {status:'ok', data, fetchedAt} | {status:'not_found', fetchedAt} | {status:'unavailable', reason, cachedData?, cachedAt?}`. CRPDPH takes ≤ 100 DIČ per call, digits without `CZ`. CRPDPH `statusCode 2|3` is a failure (2 = outage 00:00–00:10, 3 = service unavailable); `1` = OK but only the first 100 answered.
- M03 §9.1 item 3: "Registry outage simulation (ARES/CRPDPH/VIES fake returning 503/timeout): documents still reach `ready`". The fake's `unavailable` mode stands for HTTP 5xx (`reason: 'http_error'`), `timeout` for a timeout.
- 06 §3 drift monitors compare live answers with "the recorded contract". The recorded answers are passed in as `RegistryRecordings`; the golden-set recordings themselves come with the eval tickets.
- Hard rule 4: test data is fictitious. The test uses invented IČO with valid checksums (`12345679`, `87654326`), not real companies or people.

The interfaces come from brief 0018a (`packages/registries/src/types.ts`, exported from `@shoebox/registries`): `RegistryResult`, `RegistrySource`, `REGISTRY_SOURCES`, `AresSubject`, `CrpdphSubject`, `CrpdphResponse`, `CrpdphStatusCode`, `CRPDPH_MAX_DICS_PER_CALL`, `crpdphUnavailableReason`, `ViesRequester`, `ViesResult`, `CnbDailyRates`, `RegistryClients`. If `packages/registries/src/types.ts` does not exist on the branch, STOP (§8).

Excerpt the step-1 edit anchors on (`packages/testkit/package.json`):

```json
  "dependencies": {
    "@shoebox/domain": "workspace:*"
  },
```

Excerpt the step-4 edit anchors on (`packages/testkit/src/index.ts`, the last export line; other briefs may have added lines above or below it):

```ts
export * from './ids';
```

`@shoebox/registries` is a workspace package, not a new vendor: adding it as `workspace:*` needs no decisions line. Only the `importers: packages/testkit` block of `pnpm-lock.yaml` changes (about 3 added lines, `link:../registries`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/testkit/package.json` | edit | add `"@shoebox/registries": "workspace:*"` to `dependencies` |
| `pnpm-lock.yaml` | regenerated | by `pnpm install`; only the testkit importer changes |
| `packages/testkit/src/registries/fakes.ts` | new | `createFakeRegistries`, `FakeRegistries`, `RegistryRecordings`, `FakeRegistryMode`, `FakeRegistryCall`, `FakeRegistriesOptions` |
| `packages/testkit/src/registries/index.ts` | new | re-export `./fakes` |
| `packages/testkit/src/index.ts` | edit | one line `export * from './registries/index';` |
| `packages/testkit/test/registries-fakes.test.ts` | new | the acceptance tests |

No other file may change. `docs/tasks/0018b-report.md` is written in §9.

## 4. Steps

0. **Setup.** `git fetch origin task/0018-registries && git checkout task/0018-registries && git pull --ff-only origin task/0018-registries 2>&1 | tail -3 && pnpm install --frozen-lockfile 2>&1 | tail -3`
   Expected: on branch `task/0018-registries`, `packages/registries/src/types.ts` present (`ls packages/registries/src`), `Done in …`.

1. **Edit `packages/testkit/package.json`.** Replace the anchor with:

```json
  "dependencies": {
    "@shoebox/domain": "workspace:*",
    "@shoebox/registries": "workspace:*"
  },
```

   Then run `pnpm install 2>&1 | tail -3 && git diff --stat 2>&1 | tail -5`
   Expected: `Done in …`; diff stat shows `packages/testkit/package.json` and `pnpm-lock.yaml` only (a few lines each). Commit `0018b step 1`.

2. **New `packages/testkit/src/registries/fakes.ts`** (exact content):

```ts
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
```

   Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -10`. Expected: no `error TS`. Commit `0018b step 2`.

3. **New `packages/testkit/src/registries/index.ts`** (exact content):

```ts
export * from './fakes';
```

   Commit `0018b step 3`.

4. **Edit `packages/testkit/src/index.ts`.** Insert exactly one line `export * from './registries/index';` directly after the **last** existing `export` line (after the anchor if nothing follows it), then run `pnpm exec biome check --write packages/testkit/src/index.ts 2>&1 | tail -3 && pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -10`. Expected: biome done, no `error TS`. Commit `0018b step 4`.

5. **New `packages/testkit/test/registries-fakes.test.ts`** (exact content; implement until these tests pass, do not edit the test file):

```ts
import type { AresSubject, CnbDailyRates, CrpdphSubject, ViesResult } from '@shoebox/registries';
import { describe, expect, it } from 'vitest';
import { createFakeRegistries, fakeClock, type RegistryRecordings } from '../src/index';

// Fictitious subjects (valid IČO checksums, not real companies). No personal data.
const ACME: AresSubject = {
  ico: '12345679',
  obchodniJmeno: 'Testovací Dodavatel s.r.o.',
  sidlo: { textovaAdresa: 'Testovací 1, 110 00 Praha 1', kodStatu: 'CZ' },
  dic: 'CZ12345679',
  pravniForma: '112',
  datumVzniku: '2015-03-01',
  datumZaniku: null,
};

const UNRELIABLE: CrpdphSubject = {
  dic: '87654326',
  nespolehlivyPlatce: 'ANO',
  typSubjektu: 'NESPOLEHLIVA_OSOBA',
  datumZverejneniNespolehlivosti: '2025-06-01',
  cisloFu: '451',
  nazevSubjektu: 'Fiktivní Plátce a.s.',
  zverejneneUcty: [
    {
      datumZverejneni: '2024-01-15',
      datumZverejneniUkonceni: null,
      ucet: { kind: 'standard', predcisli: null, cislo: '123456789', kodBanky: '0100' },
    },
  ],
};

const VIES_DE: ViesResult = {
  countryCode: 'DE',
  vatNumber: '999999999',
  valid: true,
  requestDate: '2026-01-01T00:00:00.000Z',
  requestIdentifier: 'WAPIAAAAFAKE0001',
  name: 'Fiktive GmbH',
  address: 'Teststraße 1, 10115 Berlin',
};

const RATES: CnbDailyRates = {
  validFor: '2026-01-02',
  order: 1,
  rates: [
    { currencyCode: 'EUR', amount: 1, rate: '24.335' },
    { currencyCode: 'JPY', amount: 100, rate: '15.120' },
  ],
};

const RECORDINGS: RegistryRecordings = {
  ares: { [ACME.ico]: ACME },
  crpdph: { [UNRELIABLE.dic]: UNRELIABLE },
  vies: { DE999999999: VIES_DE },
  cnb: { '2026-01-02': RATES },
};

const ME = { countryCode: 'CZ', vatNumber: '12345679' };

describe('fake ARES', () => {
  it('returns the recorded subject for a known IČO', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    expect(await fakes.ares.subject('12345679')).toEqual({
      status: 'ok',
      data: ACME,
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns not_found for an unknown IČO', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    expect(await fakes.ares.subject('87654326')).toEqual({
      status: 'not_found',
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('stamps fetchedAt from the given clock', async () => {
    const clock = fakeClock('2026-05-04T10:00:00.000Z');
    const fakes = createFakeRegistries(RECORDINGS, { clock });
    clock.advance(1000);
    const result = await fakes.ares.subject('12345679');
    expect(result.status === 'ok' && result.fetchedAt).toBe('2026-05-04T10:00:01.000Z');
  });
});

describe('simulate', () => {
  it("simulate('unavailable') makes every source answer unavailable", async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulate('unavailable');
    expect(await fakes.ares.subject('12345679')).toEqual({
      status: 'unavailable',
      reason: 'http_error',
    });
    expect((await fakes.crpdph.status(['87654326'])).status).toBe('unavailable');
    expect((await fakes.vies.check('DE', '999999999', ME)).status).toBe('unavailable');
    expect((await fakes.cnb.daily('2026-01-02')).status).toBe('unavailable');
  });

  it("simulate('timeout', source) affects only that source", async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulate('timeout', 'ares');
    expect(await fakes.ares.subject('12345679')).toEqual({
      status: 'unavailable',
      reason: 'timeout',
    });
    expect((await fakes.cnb.daily('2026-01-02')).status).toBe('ok');
  });

  it("simulate('recorded') restores replay", async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulate('unavailable');
    fakes.simulate('recorded');
    expect((await fakes.ares.subject('12345679')).status).toBe('ok');
  });

  it('records every call in order, outages included', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    await fakes.ares.subject('12345679');
    fakes.simulate('unavailable', 'vies');
    await fakes.vies.check('DE', '999999999', ME);
    expect(fakes.calls).toEqual([
      { source: 'ares', key: '12345679' },
      { source: 'vies', key: 'DE999999999' },
    ]);
  });
});

describe('fake CRPDPH', () => {
  it('returns recorded subjects and NENALEZEN for unknown DIČ, in request order', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    const result = await fakes.crpdph.status(['11111111', '87654326']);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data.statusCode).toBe(0);
    expect(result.data.subjects[1]).toEqual(UNRELIABLE);
    expect(result.data.subjects[0]).toMatchObject({
      dic: '11111111',
      nespolehlivyPlatce: 'NENALEZEN',
      typSubjektu: 'NENALEZEN',
      zverejneneUcty: [],
    });
  });

  it('status code 1 is an ok answer that carries statusCode 1', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulateCrpdphStatus(1);
    const result = await fakes.crpdph.status(['87654326']);
    expect(result.status === 'ok' && result.data.statusCode).toBe(1);
  });

  it('status code 2 is the nightly outage', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulateCrpdphStatus(2);
    expect(await fakes.crpdph.status(['87654326'])).toEqual({
      status: 'unavailable',
      reason: 'crpdph_outage',
    });
  });

  it('status code 3 is service unavailable', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    fakes.simulateCrpdphStatus(3);
    expect(await fakes.crpdph.status(['87654326'])).toEqual({
      status: 'unavailable',
      reason: 'crpdph_unavailable',
    });
  });

  it('rejects a DIČ with the CZ prefix and more than 100 DIČ', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    await expect(fakes.crpdph.status(['CZ87654326'])).rejects.toThrow(RangeError);
    const tooMany = Array.from({ length: 101 }, (_, i) => String(10000000 + i));
    await expect(fakes.crpdph.status(tooMany)).rejects.toThrow(RangeError);
    await expect(fakes.crpdph.status([])).rejects.toThrow(RangeError);
  });
});

describe('fake VIES and ČNB', () => {
  it('VIES replays a recorded valid number and answers valid:false for an unknown one', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    expect(await fakes.vies.check('DE', '999999999', ME)).toEqual({
      status: 'ok',
      data: VIES_DE,
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
    const unknown = await fakes.vies.check('AT', 'U00000000', ME);
    expect(unknown.status === 'ok' && unknown.data.valid).toBe(false);
  });

  it('ČNB replays a recorded fixing with string rates and answers not_found otherwise', async () => {
    const fakes = createFakeRegistries(RECORDINGS);
    const result = await fakes.cnb.daily('2026-01-02');
    expect(result.status === 'ok' && result.data.rates[0]?.rate).toBe('24.335');
    expect((await fakes.cnb.daily('2026-01-03')).status).toBe('not_found');
  });
});
```

   Run `pnpm --filter @shoebox/testkit test registries-fakes 2>&1 | tail -30`. Expected: `Tests  14 passed`, 0 failed. Commit `0018b step 5`.

## 5. Do not touch

- Everything outside §3, in particular `packages/registries/**` (done in 0018a), `packages/testkit/src/llm*`, `packages/testkit/src/eval/**` and their tests (briefs 0019/0020 in parallel), `packages/domain/**`, root config, CI files.
- No npm dependency other than `@shoebox/registries` `workspace:*` (hard rule 7). No network access in the fakes.
- No real personal data or real company identifiers in the test (hard rule 4). Never push to `main` (hard rule 8).

## 6. Commands

From the repo root:

- `pnpm --filter @shoebox/testkit test registries-fakes 2>&1 | tail -30`: 14 passed, 0 failed.
- `pnpm --filter @shoebox/testkit test 2>&1 | tail -30`: all testkit tests pass.
- `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`: no `error TS`.
- `pnpm lint 2>&1 | tail -30`: no errors.
- `pnpm depcruise 2>&1 | tail -30`: `no dependency violations found`.

## 7. Acceptance

Mirrors the ticket; the ticket names the file `fake-registries.test.ts` and the folder `src/fakes/`; this repo uses `test/registries-fakes.test.ts` and `src/registries/` to avoid clashes with parallel briefs.

- [ ] `packages/testkit/test/registries-fakes.test.ts`: a known IČO returns the recorded subject.
- [ ] Same file: `simulate('unavailable')` returns `{status:'unavailable'}` (with `reason: 'http_error'`).
- [ ] Same file: CRPDPH status codes 1/2/3 are representable (1 → `ok` with `statusCode: 1`; 2 → `unavailable` `crpdph_outage`; 3 → `unavailable` `crpdph_unavailable`).
- [ ] Testkit typecheck, `pnpm lint` and `pnpm depcruise` clean.
- [ ] `git diff --stat origin/phase/0` lists only the 0018a and 0018b §3 files (plus the two reports).
- Not in this brief (later tickets): the real ARES/CRPDPH/VIES/ČNB clients, `registry_cache` lookup policy, and the recorded golden-set responses (eval tickets).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found, or `packages/registries/src/types.ts` is missing;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- `pnpm install` changes anything in `pnpm-lock.yaml` besides the testkit importer, or a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0018b-report.md` (600 tokens at most), set `Status: review` in this brief, commit `0018b report`, then `git push -u origin task/0018-registries 2>&1 | tail -5`. The orchestrator opens and merges one PR for 0018a and 0018b. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -30`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

- `packages/testkit/src/registries/fakes.ts`: outages must return `unavailable` (never throw, never `not_found`); an unknown CRPDPH DIČ answers `NENALEZEN`; `fetchedAt` comes from the injected clock, never the wall clock.
- `pnpm-lock.yaml`: only the `packages/testkit` importer gains `@shoebox/registries: link:../registries`. Briefs 0019 (and maybe 0020) may also edit `packages/testkit/package.json` and the lockfile; on a merge conflict, keep both dependency lines and re-run `pnpm install` on the merged branch rather than hand-editing the lockfile.
- `packages/testkit/test/registries-fakes.test.ts`: identifiers must stay fictitious (hard rule 4).

## Owner steps

None for this brief.
