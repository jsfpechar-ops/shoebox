// Partial DPFDP7 XML route helpers (M06 §4.10). Pure: nothing here logs, stores or serializes the
// rodné číslo; it only passes through decidePartialXml to the XML builder.

import type { FlatRateComparison, MemberRole } from '@shoebox/domain';
import { type DpfHeader, validateRodneCislo } from '@shoebox/tax-xml';

export interface PartialXmlContext {
  readonly role: MemberRole;
  readonly flagOn: boolean;
  readonly xsdAvailable: boolean;
  readonly partialXmlEligible: boolean;
  readonly flatRate: FlatRateComparison | null;
  readonly body: unknown;
}

export type PartialXmlDecision =
  | { readonly ok: true; readonly rodneCislo: string; readonly checksumOk: boolean }
  | {
      readonly ok: false;
      readonly status: 403 | 404 | 422;
      readonly error: 'forbidden' | 'not_found' | 'rodne_cislo_format';
    };

/** Order: role (403), then flag/xsd/eligibility/flat rate (404, no hint), then the rodné číslo (422). */
export function decidePartialXml(ctx: PartialXmlContext): PartialXmlDecision {
  if (ctx.role !== 'owner') return { ok: false, status: 403, error: 'forbidden' };
  if (!ctx.flagOn || !ctx.xsdAvailable || !ctx.partialXmlEligible || ctx.flatRate === null) {
    return { ok: false, status: 404, error: 'not_found' };
  }
  const raw =
    typeof ctx.body === 'object' && ctx.body !== null
      ? (ctx.body as { rodneCislo?: unknown }).rodneCislo
      : undefined;
  if (typeof raw !== 'string') return { ok: false, status: 422, error: 'rodne_cislo_format' };
  const rc = validateRodneCislo(raw);
  if ('error' in rc) return { ok: false, status: 422, error: 'rodne_cislo_format' };
  return { ok: true, rodneCislo: rc.normalized, checksumOk: rc.checksumOk };
}

export interface ProfileRowLike {
  readonly fuCode: string | null;
  readonly ufoCode: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly title: string | null;
  readonly filingEmail: string | null;
  readonly filingPhone: string | null;
  readonly mainActivityNace: string | null;
  readonly address: unknown;
}

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

export function toDpfHeader(profile: ProfileRowLike): DpfHeader {
  const a =
    typeof profile.address === 'object' && profile.address !== null
      ? (profile.address as Record<string, unknown>)
      : null;
  return {
    fuCode: nonEmpty(profile.fuCode),
    ufoCode: nonEmpty(profile.ufoCode),
    firstName: nonEmpty(profile.firstName),
    lastName: nonEmpty(profile.lastName),
    title: nonEmpty(profile.title),
    email: nonEmpty(profile.filingEmail),
    phone: nonEmpty(profile.filingPhone),
    nace: nonEmpty(profile.mainActivityNace),
    address:
      a === null
        ? null
        : {
            city: nonEmpty(a.city),
            street: nonEmpty(a.street),
            number: nonEmpty(a.house_number),
            zip: nonEmpty(a.zip),
            country: nonEmpty(a.country),
          },
  };
}

export function buildPartialFilingTotals(
  fr: FlatRateComparison,
  ledgerHash: string,
): { kc_prij7: string; kc_vyd7: string; rate: number; ledgerHash: string } {
  return {
    kc_prij7: fr.incomeKc.toFixed2(),
    kc_vyd7: fr.flat.toFixed2(),
    rate: fr.rate,
    ledgerHash,
  };
}

/** The only fields the route may log. */
export function partialXmlLogFields(
  orgId: string,
  year: number,
  filingId: string | null,
  xsdValid: boolean | null,
): Record<string, string | number | boolean | null> {
  return { route: 'dpfdp7_partial', orgId, year, filingId, xsdValid };
}
