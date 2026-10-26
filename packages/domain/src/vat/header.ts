import type { LegalDate } from '../dates/index';
import type { FilingKind, VatStatus } from '../enums/index';

export type EpoForm = 'DPHDP3' | 'DPHKH1' | 'DPHSHV';
export interface EpoTaxpayerProfile {
  readonly vatStatus: VatStatus;
  readonly dic: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly title: string | null;
  readonly address: {
    readonly street?: string | null;
    readonly house_number?: string | null;
    readonly orientation_number?: string | null;
    readonly city?: string | null;
    readonly zip?: string | null;
  } | null;
  readonly fuCode: string | null;
  readonly ufoCode: string | null;
  readonly mainActivityNace: string | null;
  readonly filingEmail: string | null;
  readonly filingPhone: string | null;
}
export interface EpoTaxpayer {
  readonly fuCode: string;
  readonly ufoCode: string;
  readonly dicDigits: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly title?: string;
  readonly street?: string;
  readonly houseNumber?: string;
  readonly orientationNumber?: string;
  readonly city: string;
  readonly zip: string;
  readonly email?: string;
  readonly phone?: string;
}
export interface EpoHeader {
  readonly form: EpoForm;
  readonly kind: FilingKind;
  readonly status: 'platce' | 'identifikovana_osoba';
  readonly period: { readonly year: number; readonly month?: number; readonly quarter?: number };
  readonly taxpayer: EpoTaxpayer;
  readonly naceCode6?: string;
  readonly preparedOn: LegalDate;
  readonly discoveredOn?: LegalDate;
  readonly appVersion: string;
}
export type VetaPField =
  | 'fu_code'
  | 'ufo_code'
  | 'dic'
  | 'first_name'
  | 'last_name'
  | 'city'
  | 'zip';
export const VETAP_REQUIRED: readonly VetaPField[] = [
  'fu_code',
  'ufo_code',
  'dic',
  'first_name',
  'last_name',
  'city',
  'zip',
];
/** DIČ digits: strips a leading CZ/cz and every non-digit; null when nothing is left or > 10 digits. */
export function dicDigits(dic: string | null | undefined): string | null {
  const digits = (dic ?? '').trim().replace(/^cz/i, '').replace(/\D/g, '');
  if (digits === '' || digits.length > 10) return null;
  return digits;
}
/** 6-digit CZ-NACE: digits only, right-padded with '0' to 6; null when empty or > 6 digits. TODO(T-02) padding [verify]. */
export function normalizeNace6(nace: string | null | undefined): string | null {
  const digits = (nace ?? '').replace(/\D/g, '');
  if (digits === '' || digits.length > 6) return null;
  return digits.padEnd(6, '0');
}
/** Fields of VETAP_REQUIRED the profile cannot fill (in VETAP_REQUIRED order). `fu_code` must be 3 digits, `ufo_code` 4 digits, zip 5 digits after stripping spaces. */
export function missingVetaP(profile: EpoTaxpayerProfile): VetaPField[] {
  const missing: VetaPField[] = [];
  const fu = trimmed(profile.fuCode);
  const ufo = trimmed(profile.ufoCode);
  const zip = (profile.address?.zip ?? '').replace(/\s+/g, '');
  if (fu === null || !/^\d{3}$/.test(fu)) missing.push('fu_code');
  if (ufo === null || !/^\d{4}$/.test(ufo)) missing.push('ufo_code');
  if (dicDigits(profile.dic) === null) missing.push('dic');
  if (trimmed(profile.firstName) === null) missing.push('first_name');
  if (trimmed(profile.lastName) === null) missing.push('last_name');
  if (trimmed(profile.address?.city) === null) missing.push('city');
  if (!/^\d{5}$/.test(zip)) missing.push('zip');
  return missing;
}
export interface BuildHeaderInput {
  readonly form: EpoForm;
  readonly kind: FilingKind;
  readonly period: {
    readonly start: LegalDate;
    readonly end: LegalDate;
    readonly kind: 'month' | 'quarter';
  };
  readonly preparedOn: LegalDate;
  readonly discoveredOn?: LegalDate;
  readonly appVersion: string;
}
export type BuildHeaderResult =
  | { readonly ok: true; readonly header: EpoHeader }
  | { readonly ok: false; readonly missing: VetaPField[] }
  | { readonly ok: false; readonly reason: 'status_unsupported' };
export function buildEpoHeader(
  profile: EpoTaxpayerProfile,
  input: BuildHeaderInput,
): BuildHeaderResult {
  if (profile.vatStatus === 'neplatce') return { ok: false, reason: 'status_unsupported' };
  const missing = missingVetaP(profile);
  if (missing.length > 0) return { ok: false, missing };

  const year = Number.parseInt(input.period.start.slice(0, 4), 10);
  const month = Number.parseInt(input.period.start.slice(5, 7), 10);
  const period =
    input.period.kind === 'month'
      ? { year, month }
      : { year, quarter: Math.floor((month - 1) / 3) + 1 };

  const title = trimmed(profile.title);
  const street = trimmed(profile.address?.street);
  const houseNumber = trimmed(profile.address?.house_number);
  const orientationNumber = trimmed(profile.address?.orientation_number);
  const email = trimmed(profile.filingEmail);
  const phone = trimmed(profile.filingPhone);
  const nace = normalizeNace6(profile.mainActivityNace);

  const taxpayer: EpoTaxpayer = {
    fuCode: trimmed(profile.fuCode) ?? '',
    ufoCode: trimmed(profile.ufoCode) ?? '',
    dicDigits: dicDigits(profile.dic) ?? '',
    firstName: trimmed(profile.firstName) ?? '',
    lastName: trimmed(profile.lastName) ?? '',
    city: trimmed(profile.address?.city) ?? '',
    zip: (profile.address?.zip ?? '').replace(/\s+/g, ''),
    ...(title !== null ? { title } : {}),
    ...(street !== null ? { street } : {}),
    ...(houseNumber !== null ? { houseNumber } : {}),
    ...(orientationNumber !== null ? { orientationNumber } : {}),
    ...(email !== null ? { email } : {}),
    ...(phone !== null ? { phone } : {}),
  };

  const header: EpoHeader = {
    form: input.form,
    kind: input.kind,
    status: profile.vatStatus,
    period,
    taxpayer,
    ...(nace !== null ? { naceCode6: nace } : {}),
    preparedOn: input.preparedOn,
    ...(input.discoveredOn !== undefined ? { discoveredOn: input.discoveredOn } : {}),
    appVersion: input.appVersion,
  };
  return { ok: true, header };
}
const FORMA: Record<EpoForm, Partial<Record<FilingKind, string>>> = {
  DPHDP3: { radne: 'B', opravne: 'O', dodatecne: 'D' },
  DPHKH1: { radne: 'B', opravne: 'O', nasledne: 'N' },
  DPHSHV: { radne: 'R', nasledne: 'N' },
};
/** VetaD form-code letter per form and kind; null for a combination the form does not have (e.g. DPHDP3 'nasledne'). */
export function formaCode(form: EpoForm, kind: FilingKind): string | null {
  return FORMA[form][kind] ?? null;
}

function trimmed(value: string | null | undefined): string | null {
  const t = (value ?? '').trim();
  return t === '' ? null : t;
}
