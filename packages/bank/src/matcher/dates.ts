import { addDays, type DocumentClass, type LegalDate } from '@shoebox/domain';
import { MATCHER_CONFIG, type MatcherConfig } from './config';

export type WindowKind = 'transfer' | 'card' | 'payout' | 'filing';

/** Whole days from `from` to `to` (to − from). */
export function daysBetween(from: LegalDate, to: LegalDate): number {
  const ms = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export function windowKindOf(
  t: { cardMerchant?: string },
  d: { cls: DocumentClass; paymentMethod?: string },
): WindowKind {
  if (t.cardMerchant || d.paymentMethod === 'card') return 'card';
  if (d.cls === 'platform_statement' || d.cls === 'settlement_statement') return 'payout';
  if (d.cls === 'government_filing') return 'filing';
  return 'transfer';
}

export interface DateFactor {
  readonly f: number;
  readonly outside: boolean;
  readonly anchorDistanceDays: number;
}

const NEUTRAL: DateFactor = { f: 0, outside: false, anchorDistanceDays: 0 };

export function dateFactor(
  kind: WindowKind,
  bookedOn: LegalDate,
  d: { issueDate?: LegalDate; dueDate?: LegalDate; servicePeriodTo?: LegalDate },
  cfg: MatcherConfig = MATCHER_CONFIG,
): DateFactor {
  const x = bookedOn;
  const w = cfg.windows;
  if (kind === 'transfer') {
    const issue = d.issueDate;
    if (!issue) return NEUTRAL;
    const w0 = w.transfer;
    const due = d.dueDate ?? addDays(issue, w0.defaultDueDays);
    const plateauEnd = daysBetween(issue, due) + w0.plateauAfterDue;
    const span = w0.after - w0.plateauAfterDue;
    const xi = daysBetween(issue, x);
    if (xi >= 0 && xi <= plateauEnd) return { f: 1, outside: false, anchorDistanceDays: 0 };
    if (xi < 0 && xi >= -w0.before)
      return { f: 1 - -xi / w0.before, outside: false, anchorDistanceDays: -xi };
    if (xi > plateauEnd && xi <= plateauEnd + span) {
      const r = xi - plateauEnd;
      return { f: 1 - r / span, outside: false, anchorDistanceDays: r };
    }
    if (xi < 0) return { f: 0, outside: true, anchorDistanceDays: -xi };
    return { f: 0, outside: true, anchorDistanceDays: xi - plateauEnd };
  }
  if (kind === 'card') {
    const issue = d.issueDate;
    if (!issue) return NEUTRAL;
    const w0 = w.card;
    const xi = daysBetween(issue, x);
    const dist = Math.abs(xi);
    if (dist <= w0.plateau) return { f: 1, outside: false, anchorDistanceDays: dist };
    if (xi < 0 && xi >= -w0.before) {
      return {
        f: (xi + w0.before) / (w0.before - w0.plateau),
        outside: false,
        anchorDistanceDays: dist,
      };
    }
    if (xi > 0 && xi <= w0.after) {
      return {
        f: (w0.after - xi) / (w0.after - w0.plateau),
        outside: false,
        anchorDistanceDays: dist,
      };
    }
    return { f: 0, outside: true, anchorDistanceDays: dist };
  }
  if (kind === 'payout') {
    const anchor = d.dueDate ?? d.servicePeriodTo ?? d.issueDate;
    if (!anchor) return NEUTRAL;
    const w0 = w.payout;
    const dist = Math.abs(daysBetween(anchor, x));
    if (dist <= w0.after)
      return { f: 1 - dist / w0.after, outside: false, anchorDistanceDays: dist };
    return { f: 0, outside: true, anchorDistanceDays: dist };
  }
  const periodEnd = d.servicePeriodTo ?? d.issueDate;
  if (!periodEnd) return NEUTRAL;
  const due = d.dueDate ?? addDays(periodEnd, w.transfer.defaultDueDays);
  const hi = addDays(due, w.filing.after);
  const fromStart = daysBetween(periodEnd, x);
  if (fromStart >= 0 && daysBetween(x, hi) >= 0)
    return { f: 1, outside: false, anchorDistanceDays: 0 };
  return {
    f: 0,
    outside: true,
    anchorDistanceDays: fromStart < 0 ? -fromStart : daysBetween(hi, x),
  };
}
