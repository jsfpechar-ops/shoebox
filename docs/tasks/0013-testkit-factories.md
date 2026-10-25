# 0013: Testkit scaffold: fake clock, deterministic ids, factory registry

Status: done
Ticket: P0-TEST-01 | Depends on: none (P0-REPO-01, P0-DOM-03 merged) | Base commit: head of phase/0 | Branch: task/0013-testkit-factories | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Give `@shoebox/testkit` a fake `Clock` that moves only when a test says so, deterministic UUID-shaped ids, and one shared registry of tenant-table factories with `factoryFor(table)` that throws for an unknown table. The RLS suite (P0-DB-03) iterates this registry so that a tenant table without a factory fails CI, which keeps every org's data provably isolated.

## 2. Context

Work mechanically: write each file with **one Write call** using the exact content below, do not re-read a file you just wrote, do not explore the repo. Commit after each step as `0013 step k`.

Spec lines (pasted; do not open `docs/v3/`):

- 03 ADR-010: `packages/testkit/` holds "factories, golden-set loader, fake registries".
- M12 §4.4 RLS test suite item 2: "fixture factory creates org A and org B with one row in every tenant table (from `packages/testkit` factories; **a missing factory fails the test**)."
- Backlog P0-TEST-01 goal: "a fake `Clock`, deterministic ids and a registry where every tenant table has one factory (the RLS suite iterates it)."
- Backlog standing rule: a later schema change ships "with RLS policies, a testkit factory and an RLS case in the same PR". Migration slices P0-DB-04..08 add their factories under `packages/testkit/src/factories/`.

**Generic on purpose.** No DB schema exists yet (P0-DB-01 is being written in parallel). The registry stores plain rows (`Record<string, unknown>`, snake_case column names as in 05); it registers **no tables** in this brief. Drizzle row types and the first real factories come with the migration slices.

The domain `Clock` the fake must satisfy (excerpt, `packages/domain/src/clock/index.ts`, exported from `@shoebox/domain`):

```ts
export interface Clock {
  /** The current instant as milliseconds since the Unix epoch (UTC). */
  now(): number;
}
```

Excerpt the step-1 edit anchors on (`packages/testkit/package.json`):

```json
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
```

Excerpt the step-6 edit anchors on (`packages/testkit/src/index.ts`, the whole file):

```ts
export const packageName = '@shoebox/testkit' as const;
```

`@shoebox/domain` is a workspace package, not a new vendor: adding it as `workspace:*` needs no decisions line. Only the `importers: packages/testkit` block of `pnpm-lock.yaml` changes (4 added lines, `link:../domain`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/testkit/package.json` | edit | add `dependencies: { "@shoebox/domain": "workspace:*" }` |
| `pnpm-lock.yaml` | regenerated | by `pnpm install`; only the testkit importer changes |
| `packages/testkit/src/clock.ts` | new | `fakeClock`, `FakeClock`, `FAKE_CLOCK_START` |
| `packages/testkit/src/ids.ts` | new | `createIdGenerator`, `IdGenerator` |
| `packages/testkit/src/factories/registry.ts` | new | `createFactoryRegistry`, `FactoryRegistry`, `TenantFactory`, `FactoryContext`, `Row` |
| `packages/testkit/src/factories/index.ts` | new | shared `tenantFactories` registry and `factoryFor` |
| `packages/testkit/src/index.ts` | edit | re-export the three modules |
| `packages/testkit/test/factories.test.ts` | new | the acceptance tests |

No other file may change. `docs/tasks/0013-report.md` is written in §9.

## 4. Steps

0. **Setup.** `git fetch origin phase/0 && git checkout -b task/0013-testkit-factories origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3`
   Expected: `Done in …`.

1. **Edit `packages/testkit/package.json`.** Replace the anchor's line `  },` that closes `"scripts"` so the file reads:

```json
{
  "name": "@shoebox/testkit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Factories, golden-set loader, fake registries.",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@shoebox/domain": "workspace:*"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

   Then run `pnpm install 2>&1 | tail -3 && git diff --stat 2>&1 | tail -5`
   Expected: `Done in …`; diff stat shows `packages/testkit/package.json` (3 +) and `pnpm-lock.yaml` (4 +) only. Commit `0013 step 1`.

2. **New `packages/testkit/src/clock.ts`** (exact content):

```ts
import type { Clock } from '@shoebox/domain';

/** Default start of every fake clock: a fixed instant, never the wall clock. */
export const FAKE_CLOCK_START = '2026-01-01T00:00:00.000Z';

/** A `Clock` for tests: it moves only when the test says so. */
export interface FakeClock extends Clock {
  /** Moves the clock forward by `ms` milliseconds (a non-negative integer). */
  advance(ms: number): void;
  /** Jumps to an instant: an ISO 8601 string with an offset or `Z`, or epoch milliseconds. */
  set(instant: string | number): void;
}

function toEpochMs(instant: string | number): number {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) {
    throw new RangeError(`fakeClock: not a valid instant: ${String(instant)}`);
  }
  return ms;
}

/** Creates a fake clock frozen at `start` (default `FAKE_CLOCK_START`). */
export function fakeClock(start: string | number = FAKE_CLOCK_START): FakeClock {
  let current = toEpochMs(start);
  return {
    now: () => current,
    advance(ms: number) {
      if (!Number.isSafeInteger(ms) || ms < 0) {
        throw new RangeError(`fakeClock.advance: ms must be a non-negative integer, got ${ms}`);
      }
      current += ms;
    },
    set(instant: string | number) {
      current = toEpochMs(instant);
    },
  };
}
```

   Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -10`. Expected: no `error TS`. Commit `0013 step 2`.

3. **New `packages/testkit/src/ids.ts`** (exact content):

```ts
/** Deterministic UUID-shaped ids for tests: the same seed always yields the same sequence. */
export interface IdGenerator {
  /** The next id: `ssssssss-0000-4000-8000-nnnnnnnnnnnn` (s = seed, n = counter, both hex). */
  next(): string;
  /** Starts the sequence again from 1. */
  reset(): void;
}

const MAX_SEED = 0xffffffff;

function hex(value: number, width: number): string {
  return value.toString(16).padStart(width, '0');
}

/** Creates a generator; use a different `seed` (0..0xffffffff) per org so ids never collide. */
export function createIdGenerator(seed = 0): IdGenerator {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`createIdGenerator: seed must be an integer 0..${MAX_SEED}, got ${seed}`);
  }
  let counter = 0;
  return {
    next() {
      counter += 1;
      return `${hex(seed, 8)}-0000-4000-8000-${hex(counter, 12)}`;
    },
    reset() {
      counter = 0;
    },
  };
}
```

   Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -10`. Expected: no `error TS`. Commit `0013 step 3`.

4. **New `packages/testkit/src/factories/registry.ts`** (exact content):

```ts
import type { FakeClock } from '../clock';
import type { IdGenerator } from '../ids';

/**
 * One database row as a plain object, keyed by column name (snake_case, as in 05).
 * Generic on purpose: the Drizzle row types arrive with the migration slices (P0-DB-01, DB-04..).
 */
export type Row = Record<string, unknown>;

/** What every factory receives: the org it builds for, an id source and a clock. */
export interface FactoryContext {
  orgId: string;
  ids: IdGenerator;
  clock: FakeClock;
}

/** Builds one valid row of a tenant table for `ctx.orgId`; `overrides` replace columns. */
export type TenantFactory<R extends Row = Row> = (ctx: FactoryContext, overrides?: Partial<R>) => R;

export interface FactoryRegistry {
  /** Registers the factory of one tenant table. Throws on a bad name or a second factory. */
  define<R extends Row>(table: string, factory: TenantFactory<R>): void;
  /** The factory of `table`. Throws when none is registered (the RLS suite relies on this). */
  factoryFor(table: string): TenantFactory;
  /** Builds one row and checks that the factory set `org_id` to `ctx.orgId`. */
  build(table: string, ctx: FactoryContext, overrides?: Row): Row;
  has(table: string): boolean;
  /** Registered table names, sorted. */
  tables(): string[];
}

const TABLE_NAME = /^[a-z][a-z0-9_]*$/;

export function createFactoryRegistry(): FactoryRegistry {
  const factories = new Map<string, TenantFactory>();

  function factoryFor(table: string): TenantFactory {
    const factory = factories.get(table);
    if (factory === undefined) {
      throw new Error(
        `testkit: no factory for table "${table}"; add one in packages/testkit/src/factories/`,
      );
    }
    return factory;
  }

  return {
    define<R extends Row>(table: string, factory: TenantFactory<R>) {
      if (!TABLE_NAME.test(table)) {
        throw new Error(`testkit: "${table}" is not a snake_case table name`);
      }
      if (factories.has(table)) {
        throw new Error(`testkit: factory for table "${table}" is already defined`);
      }
      factories.set(table, factory as TenantFactory);
    },
    factoryFor,
    build(table: string, ctx: FactoryContext, overrides?: Row) {
      const row = factoryFor(table)(ctx, overrides);
      if (row.org_id !== ctx.orgId) {
        throw new Error(`testkit: factory for "${table}" must set org_id to ctx.orgId`);
      }
      return row;
    },
    has: (table: string) => factories.has(table),
    tables: () => [...factories.keys()].sort(),
  };
}
```

   Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -10`. Expected: no `error TS`. Commit `0013 step 4`.

5. **New `packages/testkit/src/factories/index.ts`** (exact content):

```ts
import { createFactoryRegistry, type FactoryRegistry, type TenantFactory } from './registry';

export type { FactoryContext, FactoryRegistry, Row, TenantFactory } from './registry';
export { createFactoryRegistry } from './registry';

/**
 * The one registry of tenant-table factories that the RLS suite (packages/db/test/rls) iterates.
 * Empty until the migration slices land: each slice adds `src/factories/<area>.ts` exporting its
 * factories and registers them below with `tenantFactories.define('<table>', <factory>)`.
 */
export const tenantFactories: FactoryRegistry = createFactoryRegistry();

/** The factory of a tenant table from the shared registry; throws for an unknown table. */
export function factoryFor(table: string): TenantFactory {
  return tenantFactories.factoryFor(table);
}
```

   Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -10`. Expected: no `error TS`. Commit `0013 step 5`.

6. **Edit `packages/testkit/src/index.ts`.** Replace the whole file (anchor in §2) with:

```ts
export const packageName = '@shoebox/testkit' as const;
export * from './clock';
export * from './factories/index';
export * from './ids';
```

   Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -10`. Expected: no `error TS`. Commit `0013 step 6`.

7. **New `packages/testkit/test/factories.test.ts`** (exact content; the tests are the spec, do not edit them):

```ts
import type { Clock } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  createFactoryRegistry,
  createIdGenerator,
  FAKE_CLOCK_START,
  type FactoryContext,
  factoryFor,
  fakeClock,
  tenantFactories,
} from '../src/index';

const ORG_A = '00000001-0000-4000-8000-000000000001';

function ctx(orgId = ORG_A): FactoryContext {
  return { orgId, ids: createIdGenerator(1), clock: fakeClock() };
}

describe('fakeClock', () => {
  it('starts at the fixed default instant, not the wall clock', () => {
    expect(fakeClock().now()).toBe(Date.parse(FAKE_CLOCK_START));
  });

  it('advances deterministically and only when told', () => {
    const clock = fakeClock('2026-03-31T23:59:59.000Z');
    expect(clock.now()).toBe(clock.now());
    clock.advance(1000);
    expect(new Date(clock.now()).toISOString()).toBe('2026-04-01T00:00:00.000Z');
    clock.advance(0);
    expect(new Date(clock.now()).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('two clocks with the same start and steps agree', () => {
    const a = fakeClock(0);
    const b = fakeClock(0);
    for (const step of [5, 60_000, 86_400_000]) {
      a.advance(step);
      b.advance(step);
    }
    expect(a.now()).toBe(b.now());
    expect(a.now()).toBe(86_460_005);
  });

  it('set jumps to an instant with an offset', () => {
    const clock = fakeClock();
    clock.set('2026-07-01T00:00:00+02:00');
    expect(new Date(clock.now()).toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });

  it('rejects a negative or fractional advance and an invalid instant', () => {
    const clock = fakeClock();
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(1.5)).toThrow(RangeError);
    expect(() => fakeClock('not a date')).toThrow(RangeError);
    expect(() => clock.set('2026-13-45')).toThrow(RangeError);
  });

  it('is usable wherever the domain expects a Clock', () => {
    const clock: Clock = fakeClock(42);
    expect(clock.now()).toBe(42);
  });
});

describe('createIdGenerator', () => {
  it('yields the same UUID-shaped sequence for the same seed', () => {
    const a = createIdGenerator(7);
    const b = createIdGenerator(7);
    const first = [a.next(), a.next(), a.next()];
    expect(first).toEqual([b.next(), b.next(), b.next()]);
    expect(first[0]).toBe('00000007-0000-4000-8000-000000000001');
    expect(first[2]).toBe('00000007-0000-4000-8000-000000000003');
    for (const id of first) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('different seeds never collide and reset restarts the sequence', () => {
    const a = createIdGenerator(1);
    const b = createIdGenerator(2);
    expect(a.next()).not.toBe(b.next());
    a.reset();
    expect(a.next()).toBe('00000001-0000-4000-8000-000000000001');
  });

  it('rejects a seed outside 0..0xffffffff', () => {
    expect(() => createIdGenerator(-1)).toThrow(RangeError);
    expect(() => createIdGenerator(0x1_0000_0000)).toThrow(RangeError);
  });
});

describe('factory registry', () => {
  it('factoryFor throws for an unknown table', () => {
    const registry = createFactoryRegistry();
    expect(() => registry.factoryFor('no_such_table')).toThrow(
      /no factory for table "no_such_table"/,
    );
  });

  it('the shared factoryFor throws for an unknown table', () => {
    expect(() => factoryFor('no_such_table')).toThrow(/no factory for table "no_such_table"/);
    expect(tenantFactories.has('no_such_table')).toBe(false);
  });

  it('returns the registered factory and lists tables sorted', () => {
    const registry = createFactoryRegistry();
    registry.define('widgets', (c, overrides) => ({
      id: c.ids.next(),
      org_id: c.orgId,
      created_at: new Date(c.clock.now()).toISOString(),
      ...overrides,
    }));
    registry.define('apples', (c) => ({ id: c.ids.next(), org_id: c.orgId }));
    expect(registry.tables()).toEqual(['apples', 'widgets']);
    expect(registry.has('widgets')).toBe(true);
    const row = registry.factoryFor('widgets')(ctx(), { name: 'x' });
    expect(row).toEqual({
      id: '00000001-0000-4000-8000-000000000001',
      org_id: ORG_A,
      created_at: FAKE_CLOCK_START,
      name: 'x',
    });
  });

  it('rejects a duplicate factory and a non-snake_case table name', () => {
    const registry = createFactoryRegistry();
    registry.define('widgets', (c) => ({ org_id: c.orgId }));
    expect(() => registry.define('widgets', (c) => ({ org_id: c.orgId }))).toThrow(
      /already defined/,
    );
    expect(() => registry.define('Widgets', (c) => ({ org_id: c.orgId }))).toThrow(/snake_case/);
  });

  it('build checks that the row belongs to ctx.orgId', () => {
    const registry = createFactoryRegistry();
    registry.define('good', (c) => ({ org_id: c.orgId }));
    registry.define('bad', () => ({ org_id: 'someone-else' }));
    expect(registry.build('good', ctx())).toEqual({ org_id: ORG_A });
    expect(() => registry.build('bad', ctx())).toThrow(/must set org_id/);
    expect(() => registry.build('missing', ctx())).toThrow(/no factory/);
  });
});
```

   Run `pnpm --filter @shoebox/testkit test -- factories 2>&1 | tail -8`. Expected: `Tests  14 passed (14)`, 0 failed. Commit `0013 step 7`.

8. **Checks.** Run the §6 commands. If `pnpm lint` reports only formatting in a file of §3, run `pnpm exec biome check --write packages/testkit 2>&1 | tail -5` once and re-run `pnpm lint`. Commit `0013 step 8` only if something changed.

9. **Report and push** (§9).

## 5. Do not touch

- Everything outside §3, in particular `packages/domain/**` (brief 0004 changes it in parallel), `packages/db/**` (brief 0014), root config, CI files.
- Do not add any npm dependency other than `@shoebox/domain` `workspace:*` (hard rule 7).
- No wall-clock reads in factories: time comes from `ctx.clock` only. No real personal data in test rows (hard rule 4).
- Never push to `main` (hard rule 8).

## 6. Commands

From the repo root:

- `pnpm --filter @shoebox/testkit test -- factories 2>&1 | tail -30`: all pass, 0 failed.
- `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`: no `error TS`.
- `pnpm lint 2>&1 | tail -30`: no errors (an `info` line is fine).
- `pnpm depcruise 2>&1 | tail -30`: `no dependency violations found`.

## 7. Acceptance

- [ ] `packages/testkit/test/factories.test.ts`: `factoryFor(table)` throws for an unknown table (both a fresh registry and the shared `factoryFor`).
- [ ] Same file: fake clock advances deterministically (same start and steps give the same instant; it never moves on its own).
- [ ] `pnpm --filter @shoebox/testkit typecheck`, `pnpm lint` and `pnpm depcruise` clean.
- [ ] `git diff --stat origin/phase/0` lists only the §3 files (plus the report).
- Not in this brief (later tickets): the factories themselves. The registry is empty; tenancy tables (`memberships`, `taxpayer_profiles`) from P0-DB-01 get their factories at the latest in P0-DB-03, and each slice P0-DB-04..08 adds its own under `src/factories/`.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- `pnpm install` changes anything in `pnpm-lock.yaml` besides the testkit importer, or a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0013-report.md` (600 tokens at most), set `Status: review` in this brief, commit `0013 report`, then `git push -u origin task/0013-testkit-factories 2>&1 | tail -5`. The orchestrator opens and merges the PR. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -30`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

- `packages/testkit/src/factories/registry.ts`: `factoryFor` must throw (never return a no-op) for an unknown table; the RLS suite's "missing factory fails" guarantee depends on it. `build` must reject a row whose `org_id` is not `ctx.orgId`.
- `pnpm-lock.yaml`: only the `packages/testkit` importer gains `@shoebox/domain: link:../domain`. Brief 0004 also touches the lockfile; on a merge conflict, re-run `pnpm install` on the merged branch rather than hand-editing.

## Owner steps

None for this brief.
