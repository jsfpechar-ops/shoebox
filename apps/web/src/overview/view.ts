import {
  computeLedgerTotals,
  computeLimitMeters,
  computeOverviewTotals,
  type createCzRules,
  type Deadline,
  type LedgerTotalsEntry,
  type LegalDate,
  type LimitMeter,
  mergeOverviewTotals,
  type MergedOverviewTotals,
  type OverviewDocument,
  type OverviewTotals,
  upcomingDeadlines,
} from '@shoebox/domain';
import type { OverviewProfile } from './rows';

/** Everything the Přehled screen shows, computed from the profile and this year's documents. */
export interface OverviewView {
  readonly asOf: LegalDate;
  readonly profile: OverviewProfile | null;
  readonly totals: MergedOverviewTotals;
  readonly meters: readonly LimitMeter[];
  readonly deadlines: readonly Deadline[];
  readonly nextPayment: Deadline | null;
  readonly pausal: boolean;
}

/** Pure: the profile, the documents and the date in, the view out. */
export function buildOverviewView(input: {
  readonly profile: OverviewProfile | null;
  readonly documents: readonly OverviewDocument[];
  readonly ledgerEntries?: readonly LedgerTotalsEntry[];
  readonly asOf: LegalDate;
  readonly rules: ReturnType<typeof createCzRules>;
}): OverviewView {
  const { profile, documents, asOf, rules } = input;
  const documentTotals = computeOverviewTotals(documents, profile?.vatStatus ?? 'neplatce', asOf);
  const totals = mergeOverviewTotals(documentTotals, computeLedgerTotals(input.ledgerEntries ?? [], asOf));
  // Meters stay hidden until at least one counted document exists (M11 §8 empty states).
  const meters =
    profile === null || totals.countedCount === 0
      ? []
      : computeLimitMeters(
          profile,
          { incomeYtd: totals.ytd.income, turnoverYtd: totals.turnoverYtd },
          rules.at(asOf),
        );
  const deadlines = profile === null ? [] : upcomingDeadlines(profile, asOf, rules);
  // The control statement (kh) is a filing, not a payment.
  const nextPayment = deadlines.find((deadline) => deadline.kind !== 'kh') ?? null;
  const pausal =
    profile !== null &&
    (profile.taxRegime === 'pausalni_vydaje' || profile.taxRegime === 'pausalni_dan');
  return { asOf, profile, totals, meters, deadlines, nextPayment, pausal };
}
