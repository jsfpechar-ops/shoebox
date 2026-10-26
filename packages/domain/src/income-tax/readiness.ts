import type { LegalDate } from '../dates/index';
import type { TaxRegime, VatStatus } from '../enums/index';
import type { Money } from '../money/index';
import type { FlatRate } from './answers';
export interface ProfileSegment {
  readonly validFrom: LegalDate;
  readonly validTo: LegalDate | null;
  readonly entityType: string;
  readonly taxRegime: TaxRegime;
  readonly vatStatus: VatStatus;
  readonly pausalRate: FlatRate | null;
  readonly pausalDanBand: 1 | 2 | 3 | null;
  readonly hasAccountant: boolean;
}
export interface ReadinessInput {
  readonly year: number;
  readonly profiles: readonly ProfileSegment[];
  readonly ledger: { readonly staleEntries: number; readonly documentsFinalizedAfterBuild: number };
  readonly pendingDocuments: number;
  readonly unpaidIssued: number;
  readonly unexplainedTransactions: { readonly count: number; readonly sum: Money };
  readonly businessFlagUnknown: { readonly count: number; readonly sum: Money };
}
export type ReadinessCode =
  | 'P_YEAR_OPEN'
  | 'P_REGIME_UNSUPPORTED'
  | 'P_REGIME_CHANGED'
  | 'P_LEDGER_STALE'
  | 'P_PENDING_DOCUMENTS'
  | 'P_UNPAID_ISSUED'
  | 'P_UNEXPLAINED_TX'
  | 'P_BUSINESS_FLAG_UNKNOWN';
export type ReadinessSeverity = 'blocking' | 'warning' | 'info';
export interface ReadinessCheck {
  readonly code: ReadinessCode;
  readonly severity: ReadinessSeverity;
  readonly params: Readonly<Record<string, string | number>>;
}

/** Segments whose `[validFrom, validTo ?? ∞]` overlaps the calendar year; sorted by validFrom. */
export function segmentsInYear(
  profiles: readonly ProfileSegment[],
  year: number,
): ProfileSegment[] {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return profiles
    .filter((s) => s.validFrom <= yearEnd && (s.validTo === null || s.validTo >= yearStart))
    .slice()
    .sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
}

/** M06 §4.1 readiness checks, returned in table order. Only P_REGIME_UNSUPPORTED is blocking. */
export function checkPodkladyReadiness(input: ReadinessInput, today: LegalDate): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const segments = segmentsInYear(input.profiles, input.year);

  if (today < `${input.year + 1}-01-01`) {
    checks.push({ code: 'P_YEAR_OPEN', severity: 'info', params: { date: today } });
  }

  const unsupported = segments.find((s) => s.taxRegime === 'ucetnictvi' || s.entityType !== 'osvc');
  if (unsupported) {
    checks.push({
      code: 'P_REGIME_UNSUPPORTED',
      severity: 'blocking',
      params: { regime: unsupported.taxRegime, entityType: unsupported.entityType },
    });
  }

  const regimes: string[] = [];
  for (const s of segments) {
    if (!regimes.includes(s.taxRegime)) regimes.push(s.taxRegime);
  }
  if (regimes.length > 1) {
    checks.push({
      code: 'P_REGIME_CHANGED',
      severity: 'warning',
      params: { regimes: regimes.join(',') },
    });
  }

  const { staleEntries, documentsFinalizedAfterBuild } = input.ledger;
  if (staleEntries > 0 || documentsFinalizedAfterBuild > 0) {
    checks.push({
      code: 'P_LEDGER_STALE',
      severity: 'warning',
      params: { staleEntries, documentsFinalizedAfterBuild },
    });
  }

  if (input.pendingDocuments > 0) {
    checks.push({
      code: 'P_PENDING_DOCUMENTS',
      severity: 'warning',
      params: { count: input.pendingDocuments },
    });
  }

  if (input.unpaidIssued > 0) {
    checks.push({
      code: 'P_UNPAID_ISSUED',
      severity: 'warning',
      params: { count: input.unpaidIssued },
    });
  }

  if (input.unexplainedTransactions.count > 0) {
    checks.push({
      code: 'P_UNEXPLAINED_TX',
      severity: 'warning',
      params: {
        count: input.unexplainedTransactions.count,
        sum: input.unexplainedTransactions.sum.toFixed2(),
      },
    });
  }

  if (input.businessFlagUnknown.count > 0) {
    checks.push({
      code: 'P_BUSINESS_FLAG_UNKNOWN',
      severity: 'warning',
      params: {
        count: input.businessFlagUnknown.count,
        sum: input.businessFlagUnknown.sum.toFixed2(),
      },
    });
  }

  return checks;
}

export function isBlocked(checks: readonly ReadinessCheck[]): boolean {
  return checks.some((c) => c.severity === 'blocking');
}
