import { describe, expect, it } from 'vitest';
import {
  needsOnboarding,
  type SupabaseLike,
  supabaseMembershipCounter,
} from '../src/onboarding/gate';

describe('onboarding gate (M11 §5.5)', () => {
  it('needsOnboarding is true only for zero memberships', async () => {
    expect(await needsOnboarding({ countMemberships: async () => 0 })).toBe(true);
    expect(await needsOnboarding({ countMemberships: async () => 1 })).toBe(false);
    expect(await needsOnboarding({ countMemberships: async () => null })).toBe(false);
  });

  it('supabaseMembershipCounter returns the count on success', async () => {
    const fake = fakeSupabase(async () => ({ count: 0, error: null }));
    expect(await supabaseMembershipCounter(fake).countMemberships()).toBe(0);
  });

  it('supabaseMembershipCounter returns null on a query error', async () => {
    const fake = fakeSupabase(async () => ({ count: null, error: { message: 'boom' } }));
    expect(await supabaseMembershipCounter(fake).countMemberships()).toBe(null);
  });

  it('supabaseMembershipCounter returns null when the query throws', async () => {
    const fake = fakeSupabase(async () => {
      throw new Error('network');
    });
    expect(await supabaseMembershipCounter(fake).countMemberships()).toBe(null);
  });
});

function fakeSupabase(run: () => Promise<{ count: number | null; error: unknown }>): SupabaseLike {
  return {
    from: (table: string) => {
      expect(table).toBe('memberships');
      return {
        select: (_columns: string, options: { count: 'exact'; head: true }) => {
          expect(options).toEqual({ count: 'exact', head: true });
          return run();
        },
      };
    },
  };
}
