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
