/** Counts the signed-in user's memberships. `null` = the query failed. */
export interface MembershipCounter {
  countMemberships(): Promise<number | null>;
}

/** M11 §5.5 gate: true only when the user has no firm. A failed query never sends the user to onboarding. */
export async function needsOnboarding(counter: MembershipCounter): Promise<boolean> {
  const count = await counter.countMemberships();
  return count === 0;
}

/** The part of the Supabase client the gate uses; kept minimal so tests can pass a fake. */
export interface SupabaseLike {
  from(table: string): {
    select(
      columns: string,
      options: { count: 'exact'; head: true },
    ): PromiseLike<{ count: number | null; error: unknown }>;
  };
}

/** RLS limits `memberships` to the user's own orgs, so the count is the user's firm count. */
export function supabaseMembershipCounter(supabase: SupabaseLike): MembershipCounter {
  return {
    async countMemberships() {
      try {
        const { count, error } = await supabase
          .from('memberships')
          .select('org_id', { count: 'exact', head: true });
        return error === null && typeof count === 'number' ? count : null;
      } catch {
        return null;
      }
    },
  };
}
