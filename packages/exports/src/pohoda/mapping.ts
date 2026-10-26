import { findCategory, type VatTreatment } from '@shoebox/domain';
import type { PohodaProfile } from './types';

/** Category group name used as the fallback key in `profile.accounting` (§4.7.5 b). */
export function groupOf(categoryCode: string): string | null {
  return findCategory(categoryCode)?.group ?? null;
}

export type ClassificationVat =
  | { kind: 'type'; value: 'nonSubsume' }
  | { kind: 'ids'; value: string };

const ALWAYS_NON_SUBSUME: ReadonlySet<VatTreatment> = new Set([
  'rcv_foreign_vat_charged',
  'rcv_out_of_scope',
  'iss_no_vat',
]);

export function resolveClassificationVAT(
  profile: PohodaProfile,
  treatment: VatTreatment,
): ClassificationVat | null {
  if (profile.vatStatus === 'neplatce' || ALWAYS_NON_SUBSUME.has(treatment)) {
    return { kind: 'type', value: 'nonSubsume' };
  }
  const ids = profile.classificationVAT[treatment];
  return ids ? { kind: 'ids', value: ids } : null;
}

export function resolveAccounting(profile: PohodaProfile, categoryCode: string): string | null {
  const direct = profile.accounting[categoryCode];
  if (direct) return direct;
  const group = groupOf(categoryCode);
  return (group ? profile.accounting[group] : undefined) || null;
}
