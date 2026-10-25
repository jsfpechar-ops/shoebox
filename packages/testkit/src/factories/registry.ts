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
