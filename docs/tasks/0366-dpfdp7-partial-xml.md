# 0366: `serializeDpfdp7Partial`, `validateRodneCislo`, DPFDP7 form rules and manifest

Status: todo
Ticket: P4-POD-06 (XML) | Depends on: 0336, 0355 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 22 tool calls, 60k tokens

## 1. Objective

Pure partial DPFDP7 XML for flat-rate users (M06 §4.10): header (`VetaD`, `VetaP`) and only the příloha 1 values that are fully derivable (`VetaT`: ř. 101 income, ř. 102 flat-rate expenses, the rate). No logging, no storage. The rodné číslo validator and a redaction helper. The XSD is not in the repo: the manifest ships with `sha256: null` and `tax_years: []`, so the feature stays hidden until the owner vendors the file (M06 §8 #9, 22 T-03).

## 2. Context

M06 §4.10 content table (all names **[verify against the XSD]**, 22 T-03; CTF §1.5 marks [I] = inferred):

| Element / attr | Value |
|---|---|
| `Pisemnost@nazevSW`, `@verzeSW` | `NAZEV_SW` ('Shoebox'), app version (0336 `writePisemnost` does this) |
| `DPFDP7@verzePis` | `epo.forms.DPFDP7.verze_pis` |
| `VetaD@dokument`, `@k_uladis` | `DP7` / `DPF` |
| `VetaD@rok` | tax year |
| `VetaD@dap_typ` | `B` (řádné only) |
| `VetaD@pln_moc`, `@audit` | `N`, `N` |
| `VetaD@c_ufo_cil`, `@c_pracufo` | profile `fu_code`, `ufo_code` |
| `VetaP@rod_c` | rodné číslo from the request, digits only, no slash |
| `VetaP@jmeno`, `@prijmeni`, `@titul`, `@email`, `@c_telef` | profile (`first_name`, `last_name`, `title`, `filing_email`, `filing_phone`) |
| `VetaP@naz_obce`, `@ulice`, `@c_pop`, `@psc`, `@stat` | profile address **[verify names]** |
| `VetaT@c_nace` | `main_activity_nace` |
| `VetaT@kc_prij7` | `round0(income)` (ř. 101) |
| `VetaT@kc_vyd7` | `flat` from 0355 (ř. 102) |
| `VetaT@pr_sazba`, `@vyd7proc` | the rate (`'60'`), `'A'` **[verify value]** |

Not emitted: `VetaO`/`VetaS` (**[verify that EPO accepts VetaT without VetaO]**), ř. 103–113, `pr_prij7`/`pr_vyd7`/`celk_pr_*` (if the XSD requires them with `vyd7proc`, emit `pr_prij7 = kc_prij7`, `pr_vyd7 = kc_vyd7` only after verifying; otherwise the feature is disabled for that year), activity dates. Null/empty attributes are omitted (`textAttr`). Element order: `VetaD`, `VetaP`, `VetaT`.

0336 API (`packages/tax-xml/src/xml.ts`, `forms.ts`, `validate.ts`): `writePisemnost({ form, verzePis, appVersion, vety })`, `VetaNode { name, attrs: [name, value][] }`, `intAttr(Money)`, `textAttr`, `escapeAttr`; `EpoForm` and `PisemnostInput.form` are unions of `'DPHDP3' | 'DPHKH1' | 'DPHSHV'` → add `'DPFDP7'`; `FORM_RULES` gets a `DPFDP7` table: `VetaD` (min 1 max 1, required `dokument, k_uladis, rok, dap_typ`), `VetaP` (1/1, required `rod_c, prijmeni, jmeno`), `VetaT` (1/1, required `kc_prij7`); `VALUE_PATTERNS`: `rod_c` `^\d{9,10}$`, `kc_prij7|kc_vyd7` `^-?\d+$`, `pr_sazba` `^(80|60|40|30)$`. `checkStructure(parseEpoXml(xml), 'DPFDP7')` must return `[]` for the golden. `validateXml` with a manifest whose `sha256` is null returns the "unvalidated" outcome (see 0336's `validate.ts`; do not change it).

Rules: `epo.forms` is seeded from `CZ_EPO_FORMS` (`packages/domain/src/rules/cz/vat-phase3.ts`); add `DPFDP7: { version: '00.00.00', verze_pis: '00.00', xsd: 'dpfdp7_epo2.xsd', source_url: 'https://adisspr.mfcr.cz/adis/jepo/schema/dpfdp7_epo2.xsd', valid_for_periods_from: '2026-01-01', tax_years: [] }` with a `[verify]` comment (the owner fills version/verze_pis after downloading; `tax_years` lists the years whose XSD is vendored). If the `epo.forms` zod schema in `law.ts` rejects `tax_years`, extend that schema with `tax_years: z.array(z.number().int()).optional()` (rules test `pnpm --filter @shoebox/domain test -- rules`). `isPartialXmlAvailable(year, rules)` = `tax_years.includes(year)`.

Rodné číslo (M06 §4.10): format `^\d{6}/?\d{3,4}$`; 10 digits → `n mod 11 === 0`, or (`n mod 11 === 10` and the last digit is `0`, pre-1986 exception) **[verify]**; mismatch is a warning (`checksumOk: false`), not a block; 9 digits → no checksum (`checksumOk: true`). Test value `7801011229` (= 11 × 709 182 839, valid). Redaction: `redactRodneCislo(text)` replaces every `\d{6}/?\d{3,4}` with `***`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/tax-xml/src/xml.ts`, `forms.ts` | edit | `'DPFDP7'` in the unions, `FORM_RULES.DPFDP7`, patterns |
| `packages/tax-xml/src/dpfdp7-partial.ts` | create | below |
| `packages/tax-xml/src/index.ts` | edit | exports |
| `packages/tax-xml/xsd/DPFDP7/manifest.json` | create | `{ form: 'DPFDP7', version: '00.00.00', verze_pis: '00.00', main: 'dpfdp7_epo2.xsd', source_url: '…', sha256: null, fetched_at: null, valid_for_periods_from: '2026-01-01' }` |
| `packages/domain/src/rules/cz/vat-phase3.ts` (+ `law.ts` only if needed) | edit | `DPFDP7` entry |
| `packages/domain/test/rules-values.test.ts` | edit | one `it`: `epo.forms.DPFDP7.tax_years` is `[]` in 2026 |
| `testdata/golden-v1/expected/income-tax/dpfdp7-partial-2026.xml` | create | the S3 output, hand-checked attribute by attribute against §2 |
| `packages/tax-xml/test/dpfdp7-partial.test.ts` | create | below |

## 4. Steps

1. Unions, form rules, patterns. `pnpm --filter @shoebox/tax-xml test -- validate 2>&1 | tail -30` stays green.
2. `dpfdp7-partial.ts` exports exactly:
```ts
import type { CzRules, FlatRate, LegalDate, Money } from '@shoebox/domain';
export interface DpfHeader { readonly fuCode: string | null; readonly ufoCode: string | null; readonly firstName: string | null; readonly lastName: string | null; readonly title: string | null; readonly email: string | null; readonly phone: string | null; readonly nace: string | null; readonly address: { readonly city: string | null; readonly street: string | null; readonly number: string | null; readonly zip: string | null; readonly country: string | null } | null }
export interface Dpfdp7PartialInput { readonly year: number; readonly header: DpfHeader; readonly income: Money; readonly flat: Money; readonly rate: FlatRate; readonly appVersion: string }
export function validateRodneCislo(input: string): { readonly normalized: string; readonly checksumOk: boolean } | { readonly error: 'format' };
export function redactRodneCislo(text: string): string;
export function serializeDpfdp7Partial(input: Dpfdp7PartialInput, rodneCislo: string, rules: CzRules): string;   // throws Error('dpfdp7: invalid rodné číslo') on a format error; pure, never logs
export function isPartialXmlAvailable(year: number, rules: CzRules): boolean;
export function dpfdp7FileName(year: number): string;   // `DPFDP7-${year}-castecne.xml`
```
`income` and `flat` must be whole Kč (`intAttr` throws otherwise; the caller passes `round0` values from 0355).
3. Test file verbatim:
```ts
import { readFileSync } from 'node:fs';
import { CZK, Money, createCzRules } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { dpfdp7FileName, isPartialXmlAvailable, redactRodneCislo, serializeDpfdp7Partial, validateRodneCislo } from '../src/dpfdp7-partial';
import { checkStructure, parseEpoXml } from '../src/forms';

const rules = createCzRules();
const czk = (s: string) => Money.parse(s, CZK);
const RC = '7801011229';
const s3 = {
  year: 2026, appVersion: '0.1.0', income: czk('3500000.00'), flat: czk('1200000.00'), rate: 60 as const,
  header: { fuCode: '451', ufoCode: '2001', firstName: 'Lucie', lastName: 'Nováková', title: null, email: 'lucie@example.test', phone: '+420777000111', nace: '620200', address: { city: 'Praha 3', street: 'Vinohradská', number: '100', zip: '13000', country: 'CZ' } },
};

describe('serializeDpfdp7Partial S3 (M06 §9)', () => {
  const xml = serializeDpfdp7Partial(s3, '780101/1229', rules);
  it('kc_prij7=3500000, kc_vyd7=1200000, pr_sazba=60, vyd7proc set; VetaD header values; rod_c without the slash', () => {
    const doc = parseEpoXml(xml);
    expect(doc.form).toBe('DPFDP7');
    expect(doc.vety.map((v) => v.name)).toEqual(['VetaD', 'VetaP', 'VetaT']);
    expect(doc.vety[0]?.attrs).toMatchObject({ dokument: 'DP7', k_uladis: 'DPF', rok: '2026', dap_typ: 'B', pln_moc: 'N', audit: 'N', c_ufo_cil: '451', c_pracufo: '2001' });
    expect(doc.vety[1]?.attrs).toMatchObject({ rod_c: RC, jmeno: 'Lucie', prijmeni: 'Nováková', email: 'lucie@example.test' });
    expect(doc.vety[1]?.attrs.titul).toBeUndefined();
    expect(doc.vety[2]?.attrs).toEqual({ c_nace: '620200', kc_prij7: '3500000', kc_vyd7: '1200000', pr_sazba: '60', vyd7proc: 'A' });
    expect(checkStructure(doc, 'DPFDP7')).toEqual([]);
  });
  it('matches the golden file byte for byte', () => {
    expect(xml).toBe(readFileSync(new URL('../../../testdata/golden-v1/expected/income-tax/dpfdp7-partial-2026.xml', import.meta.url), 'utf8'));
  });
  it('never emits VetaO, VetaS, pr_prij7 or row 103+; no logging side effects (pure string)', () => {
    expect(xml).not.toMatch(/VetaO|VetaS|pr_prij7|pr_vyd7|kc_zd7/);
  });
  it('a format-invalid RČ throws; haléře in income throw', () => {
    expect(() => serializeDpfdp7Partial(s3, '12345', rules)).toThrow('dpfdp7: invalid rodné číslo');
    expect(() => serializeDpfdp7Partial({ ...s3, income: czk('3500000.50') }, RC, rules)).toThrow();
  });
});

describe('validateRodneCislo / redact / availability', () => {
  it('format and checksum', () => {
    expect(validateRodneCislo('780101/1229')).toEqual({ normalized: RC, checksumOk: true });
    expect(validateRodneCislo('7801011228')).toEqual({ normalized: '7801011228', checksumOk: false });
    expect(validateRodneCislo('530101123')).toEqual({ normalized: '530101123', checksumOk: true });
    expect(validateRodneCislo('12345')).toEqual({ error: 'format' });
    expect(validateRodneCislo('78010112290')).toEqual({ error: 'format' });
  });
  it('redaction masks both spellings; file name; availability follows epo.forms.DPFDP7.tax_years (empty until the XSD is vendored)', () => {
    expect(redactRodneCislo('rc 780101/1229 and 7801011229 end')).toBe('rc *** and *** end');
    expect(dpfdp7FileName(2026)).toBe('DPFDP7-2026-castecne.xml');
    expect(isPartialXmlAvailable(2026, rules)).toBe(false);
  });
});
```
Command: `pnpm --filter @shoebox/tax-xml test -- dpfdp7 2>&1 | tail -30`. Write the golden file from the serializer's output only after you have checked every attribute against §2 by eye; paste the file (≤ 15 lines) in the report.
4. Rules entry + rules test; `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30`.
5. Typechecks (tax-xml, domain). Commit `feat(tax-xml): partial DPFDP7 serializer, RČ validation, manifest (0366)`.

## 5. Do not touch

`dphdp3.ts`, `kh.ts`, `shv.ts` serializers, `validate.ts`.

## 6. Commands

`pnpm --filter @shoebox/tax-xml test -- dpfdp7 2>&1 | tail -30` · `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` · both typechecks

## 7. Acceptance

- [ ] S3 → `kc_prij7="3500000"`, `kc_vyd7="1200000"`, `pr_sazba="60"` + `vyd7proc`; structure check empty; `validateRodneCislo` format and checksum (P4-POD-06 first acceptance, minus XSD validity which waits for the owner's file).
- [ ] Report lists every `[verify]` attribute name as unverified (T-03) and the manifest `sha256: null`.

## 8. Stop and ask

TEMPLATE §8. Never download the XSD yourself (owner step; the network and the source must be recorded by him).

## 9. Report

`docs/tasks/0366-report.md`.

## Risk list

Tax XML (HIGH): every attribute is `[verify]` until the XSD is vendored; the flag keeps it off.

## Owner steps

1. Download `dpfdp7_epo2.xsd` (and its includes) from `https://adisspr.mfcr.cz/adis/jepo/schema/` into `packages/tax-xml/xsd/DPFDP7/`, fill `manifest.json` (`version`, `verze_pis`, `sha256`, `fetched_at`) and `CZ_EPO_FORMS.DPFDP7` (`tax_years: [2026]`), then ask for a follow-up brief that runs `validateXml` on the golden and fixes attribute names.
