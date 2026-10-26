# 0329: EPO filing header (VetaD/VetaP data) from the profile

Status: todo
Ticket: P3-VAT-01 | Depends on: none | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 15 tool calls, 40k tokens

## 1. Objective

A pure `buildEpoHeader` that turns the taxpayer profile into the exact header data the three EPO forms need (`EpoHeader`, M05 §6), and `missingVetaP` that lists what the profile still lacks so the generation dialog (lane D, later) can ask once. No screen in this brief.

## 2. Context

M05 §4.7 (pasted): VetaD `typ_platce`: `platce`→`P`, `identifikovana_osoba`→`I`. `dapdph_forma`: `radne`→`B`, `opravne`→`O`, `dodatecne`→`D`; KH `khdph_forma`: `radne`→`B`, `opravne`→`O`, `nasledne`→`N`; SH `shvies_forma`: `radne`→`R`, `nasledne`→`N`. `c_okec` = `main_activity_nace` normalised to 6 digits (right-pad with `0`) **[verify padding and whether required for IO]**. VetaP: `c_ufo` = `profile.fu_code` (3 digits), `c_pracufo` = `profile.ufo_code` (4 digits) **[verify c_ufo/c_pracufo vs fu_code/ufo_code, T-02]**; `dic` = DIČ digits only (`[0-9]{1,10}`, no `CZ`, keep leading zeros); `typ_ds='F'`; `jmeno/prijmeni/titul` from `first_name/last_name/title`; `ulice, c_pop, c_orient, naz_obce, psc, stat` from `address.{street, house_number, orientation_number, city, zip}` (zip digits only) and `'ČESKÁ REPUBLIKA'`; `email`, `c_telef` from `filing_email`, `filing_phone`. Required to generate: fu_code, ufo_code, dic, last_name, first_name, city, zip; the rest optional.

05 §2 `taxpayer_profiles`: `first_name text, last_name text, title text, filing_email text, filing_phone text, address jsonb {street, house_number, orientation_number, city, zip, country}, fu_code text, ufo_code text, main_activity_nace text`, `dic text`.

Existing: `VatStatus` (`'neplatce'|'identifikovana_osoba'|'platce'`), `FilingKind` (`'radne'|'opravne'|'dodatecne'|'nasledne'`) in `packages/domain/src/enums/index.ts`; `LegalDate` in `../dates/index`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/header.ts` | create | types + 4 functions below |
| `packages/domain/test/epo-header.test.ts` | create | full file below |
| `packages/domain/src/index.ts` | edit | append `export * from './vat/header';` after the `./vat/treatment` line |

## 4. Steps

1. Create `header.ts` exporting exactly:
```ts
import type { LegalDate } from '../dates/index';
import type { FilingKind, VatStatus } from '../enums/index';

export type EpoForm = 'DPHDP3' | 'DPHKH1' | 'DPHSHV';
export interface EpoTaxpayerProfile {
  readonly vatStatus: VatStatus; readonly dic: string | null;
  readonly firstName: string | null; readonly lastName: string | null; readonly title: string | null;
  readonly address: { readonly street?: string | null; readonly house_number?: string | null; readonly orientation_number?: string | null; readonly city?: string | null; readonly zip?: string | null } | null;
  readonly fuCode: string | null; readonly ufoCode: string | null; readonly mainActivityNace: string | null;
  readonly filingEmail: string | null; readonly filingPhone: string | null;
}
export interface EpoTaxpayer { readonly fuCode: string; readonly ufoCode: string; readonly dicDigits: string; readonly firstName: string; readonly lastName: string; readonly title?: string; readonly street?: string; readonly houseNumber?: string; readonly orientationNumber?: string; readonly city: string; readonly zip: string; readonly email?: string; readonly phone?: string }
export interface EpoHeader {
  readonly form: EpoForm; readonly kind: FilingKind; readonly status: 'platce' | 'identifikovana_osoba';
  readonly period: { readonly year: number; readonly month?: number; readonly quarter?: number };
  readonly taxpayer: EpoTaxpayer; readonly naceCode6?: string;
  readonly preparedOn: LegalDate; readonly discoveredOn?: LegalDate; readonly appVersion: string;
}
export type VetaPField = 'fu_code' | 'ufo_code' | 'dic' | 'first_name' | 'last_name' | 'city' | 'zip';
export const VETAP_REQUIRED: readonly VetaPField[] = ['fu_code', 'ufo_code', 'dic', 'first_name', 'last_name', 'city', 'zip'];
/** DIČ digits: strips a leading CZ/cz and every non-digit; null when nothing is left or > 10 digits. */
export function dicDigits(dic: string | null | undefined): string | null;
/** 6-digit CZ-NACE: digits only, right-padded with '0' to 6; null when empty or > 6 digits. TODO(T-02) padding [verify]. */
export function normalizeNace6(nace: string | null | undefined): string | null;
/** Fields of VETAP_REQUIRED the profile cannot fill (in VETAP_REQUIRED order). `fu_code` must be 3 digits, `ufo_code` 4 digits, zip 5 digits after stripping spaces. */
export function missingVetaP(profile: EpoTaxpayerProfile): VetaPField[];
export interface BuildHeaderInput { readonly form: EpoForm; readonly kind: FilingKind; readonly period: { readonly start: LegalDate; readonly end: LegalDate; readonly kind: 'month' | 'quarter' }; readonly preparedOn: LegalDate; readonly discoveredOn?: LegalDate; readonly appVersion: string }
export type BuildHeaderResult = { readonly ok: true; readonly header: EpoHeader } | { readonly ok: false; readonly missing: VetaPField[] } | { readonly ok: false; readonly reason: 'status_unsupported' };
export function buildEpoHeader(profile: EpoTaxpayerProfile, input: BuildHeaderInput): BuildHeaderResult;
/** VetaD form-code letter per form and kind; null for a combination the form does not have (e.g. DPHDP3 'nasledne'). */
export function formaCode(form: EpoForm, kind: FilingKind): string | null;
```
Rules: `period.year` = year of `start`; month period → `month` = month of `start` (1–12), quarter → `quarter` = `floor((month-1)/3)+1`. `status_unsupported` when `vatStatus === 'neplatce'` (checked before missing fields). Optional taxpayer fields are set only when non-empty after trim (never `''`). `formaCode`: DPHDP3 `{radne:'B', opravne:'O', dodatecne:'D'}`, DPHKH1 `{radne:'B', opravne:'O', nasledne:'N'}`, DPHSHV `{radne:'R', nasledne:'N'}`.

2. Create the test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { buildEpoHeader, dicDigits, type EpoTaxpayerProfile, formaCode, missingVetaP, normalizeNace6 } from '../src/vat/header';

const d = parseLegalDate;
const FULL: EpoTaxpayerProfile = {
  vatStatus: 'identifikovana_osoba', dic: 'CZ7801011229', firstName: ' Jan ', lastName: 'Novák', title: null,
  address: { street: 'Vinohradská', house_number: '1', orientation_number: null, city: 'Praha', zip: '130 00' },
  fuCode: '451', ufoCode: '2003', mainActivityNace: '5520', filingEmail: 'jan@example.com', filingPhone: null,
};
const AUG = { start: d('2026-08-01'), end: d('2026-08-31'), kind: 'month' as const };

describe('dicDigits / normalizeNace6', () => {
  it('strips CZ and keeps leading zeros', () => {
    expect(dicDigits('CZ7801011229')).toBe('7801011229');
    expect(dicDigits('cz 012 345 678')).toBe('012345678');
    expect(dicDigits('CZ')).toBeNull();
    expect(dicDigits('12345678901')).toBeNull();
    expect(dicDigits(null)).toBeNull();
  });
  it('NACE right-pads to 6 digits', () => {
    expect(normalizeNace6('5520')).toBe('552000');
    expect(normalizeNace6('62.01')).toBe('620100');
    expect(normalizeNace6('')).toBeNull();
    expect(normalizeNace6('1234567')).toBeNull();
  });
});

describe('missingVetaP', () => {
  it('full profile → nothing missing', () => expect(missingVetaP(FULL)).toEqual([]));
  it('lists missing fields in canonical order, with format checks', () => {
    expect(missingVetaP({ ...FULL, fuCode: '45', ufoCode: null, lastName: ' ', address: { city: 'Praha', zip: '1300' } })).toEqual(['fu_code', 'ufo_code', 'last_name', 'zip']);
    expect(missingVetaP({ ...FULL, address: null, dic: 'CZ' })).toEqual(['dic', 'city', 'zip']);
  });
});

describe('buildEpoHeader', () => {
  it('IO August DPHDP3: P4 golden header', () => {
    const r = buildEpoHeader(FULL, { form: 'DPHDP3', kind: 'radne', period: AUG, preparedOn: d('2026-09-20'), appVersion: '0.0.0' });
    expect(r).toMatchObject({ ok: true, header: {
      form: 'DPHDP3', kind: 'radne', status: 'identifikovana_osoba', period: { year: 2026, month: 8 },
      taxpayer: { fuCode: '451', ufoCode: '2003', dicDigits: '7801011229', firstName: 'Jan', lastName: 'Novák', street: 'Vinohradská', houseNumber: '1', city: 'Praha', zip: '13000', email: 'jan@example.com' },
      naceCode6: '552000', preparedOn: '2026-09-20', appVersion: '0.0.0' } });
    if (r.ok) {
      expect(r.header.period.quarter).toBeUndefined();
      expect('title' in r.header.taxpayer && r.header.taxpayer.title !== undefined).toBe(false);
      expect('orientationNumber' in r.header.taxpayer && r.header.taxpayer.orientationNumber !== undefined).toBe(false);
    }
  });
  it('quarter period → quarter number, no month', () => {
    const r = buildEpoHeader({ ...FULL, vatStatus: 'platce' }, { form: 'DPHKH1', kind: 'nasledne', period: { start: d('2026-07-01'), end: d('2026-09-30'), kind: 'quarter' }, preparedOn: d('2026-10-20'), discoveredOn: d('2026-10-19'), appVersion: '1.2.3' });
    expect(r).toMatchObject({ ok: true, header: { period: { year: 2026, quarter: 3 }, discoveredOn: '2026-10-19', status: 'platce' } });
    if (r.ok) expect(r.header.period.month).toBeUndefined();
  });
  it('non-payer → status_unsupported before missing fields; missing fields listed', () => {
    expect(buildEpoHeader({ ...FULL, vatStatus: 'neplatce', fuCode: null }, { form: 'DPHDP3', kind: 'radne', period: AUG, preparedOn: d('2026-09-20'), appVersion: '0' })).toEqual({ ok: false, reason: 'status_unsupported' });
    expect(buildEpoHeader({ ...FULL, fuCode: null, firstName: null }, { form: 'DPHDP3', kind: 'radne', period: AUG, preparedOn: d('2026-09-20'), appVersion: '0' })).toEqual({ ok: false, missing: ['fu_code', 'first_name'] });
  });
  it('formaCode letters', () => {
    expect(formaCode('DPHDP3', 'radne')).toBe('B'); expect(formaCode('DPHDP3', 'dodatecne')).toBe('D'); expect(formaCode('DPHDP3', 'nasledne')).toBeNull();
    expect(formaCode('DPHKH1', 'nasledne')).toBe('N'); expect(formaCode('DPHKH1', 'dodatecne')).toBeNull();
    expect(formaCode('DPHSHV', 'radne')).toBe('R'); expect(formaCode('DPHSHV', 'opravne')).toBeNull();
  });
});
```
Implement until green; do not edit the test. Command: `pnpm --filter @shoebox/domain test -- epo-header 2>&1 | tail -30`.
3. Append the index line; `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors. Commit `feat(domain): EPO header builder (0329)`.

## 5. Do not touch

`apps/web` (the VetaP sheet in Nastavení is a lane D follow-up), enums, rules.

## 6. Commands

`pnpm --filter @shoebox/domain test -- epo-header 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Test green, typecheck clean, only §3 files changed.
- [ ] Report lists the `[verify]` items: `c_ufo`/`c_pracufo` ↔ `fu_code`/`ufo_code` (T-02), NACE padding, whether `c_okec` is required for an IO.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0329-report.md` (≤ 600 tokens).

## Risk list

`header.ts` (goes into every XML).

## Owner steps

1. Lane D follow-up ticket: "VetaP sheet before first filing" (settings count stays 15); `apps/web/e2e/profile-vetap.spec.ts` belongs to it.
