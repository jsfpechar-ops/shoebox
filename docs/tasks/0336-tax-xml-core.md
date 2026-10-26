# 0336: `packages/tax-xml` core: deterministic XML writer, form structure rules, `validateXml`

Status: todo
Ticket: P3-VAT-06 (part a) | Depends on: none (pure; 0328 only for versions) | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

Turn the stub `@shoebox/tax-xml` into the EPO XML toolkit the serializers (0338, 0339) build on: a tiny deterministic XML writer (no string concatenation in serializers), form structure rules for DPHDP3/DPHKH1/DPHSHV (Věta order, multiplicity, allowed and required attributes, value formats) derived from the research notes and the row map, and `validateXml` that runs the structural check always and `xmllint --noout --nonet --schema` when the official XSD is vendored. No new npm dependency (rule 7): `xmllint` is a system binary already present here (`/usr/bin/xmllint`), parsing of our own XML uses a small regex parser (our XML has only self-closing attribute elements).

## 2. Context

M05 §4.7 common rules (pasted): UTF-8 with declaration; dot decimal separator; dates `DD.MM.YYYY`; DPHDP3 amounts as integers, KH amounts with 2 decimals, SH `pln_hodnota` integer; DIČ digits only (`[0-9]{1,10}`); attributes with value 0 or empty are omitted (a Věta with no attributes is omitted, except VetaD/VetaP and DPHDP3 Veta6) **[verify omission vs "0"]**; elements in XSD sequence order; attributes in a fixed order so output is byte-deterministic. Root: `<Pisemnost nazevSW="Shoebox" verzeSW="{app version}"><DPHDP3 verzePis="03.01">…` (`verzePis`, `nazevSW/verzeSW` **[verify against XSD]**).

M05 §4.8: XSD vendored at `packages/tax-xml/xsd/{FORM}/{version}/` with `manifest.json` `{ form, version, verze_pis, source_url, sha256, fetched_at, valid_for_periods_from }`. `validateXml(xml, form, version)`: temp file, `xmllint --noout --nonet --schema <main.xsd> <file>` (timeout 10 s), parse stderr `file:line: element X: Schemas validity error : …` into `[{line, element, message}]`. Missing `xmllint` fails loudly (never "unvalidated").

**No network in this environment**: the executor creates the manifest with `sha256: null, fetched_at: null` and no `.xsd` file; `validateXml` then reports `method: 'structural', xsdAvailable: false` and the filing lifecycle (0344) keeps such filings in `draft` with `xsd_valid = null`. The owner downloads the XSDs later (Owner steps). `TODO(decision-xsd)` marks the spot.

Structure data (research/czech-tax-filings.md §1.2–1.4 [O] unless marked; row-map attrs from `CZ_DPHDP3_ROW_MAP` in `@shoebox/domain`):

```
DPHDP3 (order): VetaD(1) VetaP(1) Veta1(0..1) Veta2(0..1) Veta4(0..1) Veta5(0..1, [I]) Veta6(1)
  VetaD: dokument k_uladis dapdph_forma typ_platce rok mesic ctvrt trans c_okec d_poddp d_zjist kod_zo zdobd_od zdobd_do d_por_dod   required: dokument k_uladis dapdph_forma typ_platce rok + one of mesic|ctvrt
  VetaP: c_ufo c_pracufo dic typ_ds jmeno prijmeni titul ulice c_pop c_orient naz_obce psc stat email c_telef   required: c_ufo dic
  Veta1: obrat23 dan23 obrat5 dan5 p_zb23 dan_pzb23 p_zb5 dan_pzb5 p_sl23_e dan_psl23_e p_sl5_e dan_psl5_e rez_pren23 dan_rpren23 rez_pren5 dan_rpren5 p_sl23_z dan_psl23_z p_sl5_z dan_psl5_z
  Veta2: dod_zb pln_sluzby pln_vyvoz pln_rez_pren pln_ost
  Veta4: pln23 odp_tuz23_nar odp_tuz23 pln5 odp_tuz5_nar odp_tuz5 dov_cu odp_cu_nar odp_cu nar_zdp23 od_zdp23 odkr_zdp23 nar_zdp5 od_zdp5 odkr_zdp5 odp_sum_nar odp_sum_kr
  Veta5: plnosv_nkf
  Veta6: dan_zocelk odp_zocelk dano_da dano_no dano
DPHKH1 (order): VetaD(1) VetaP(1) VetaA1* VetaA2* VetaA3* VetaA4* VetaA5(0..1) VetaB1* VetaB2* VetaB3(0..1) VetaC(0..1)
  VetaD: dokument k_uladis khdph_forma rok mesic ctvrt d_poddp d_zjist c_jed_vyzvy vyzva_odp zdobd_od zdobd_do   required: dokument k_uladis khdph_forma rok + one of mesic|ctvrt
  VetaP: as DPHDP3
  VetaA1: c_radku dic_odb c_evid_dd duzp zakl_dane1 kod_pred_pl
  VetaA2: c_radku k_stat vatid_dod c_evid_dd dppd zakl_dane1 dan1 zakl_dane2 dan2 zakl_dane3 dan3
  VetaA3: c_radku dup osv_plneni c_evid_dd k_stat vatid_odb jm_prijm_obch d_narozeni m_pobytu_sidlo
  VetaA4: c_radku dic_odb c_evid_dd dppd zakl_dane1 dan1 zakl_dane2 dan2 zakl_dane3 dan3 kod_rezim_pl zdph_44
  VetaA5: zakl_dane1 dan1 zakl_dane2 dan2 zakl_dane3 dan3
  VetaB1: c_radku dic_dod c_evid_dd duzp kod_pred_pl zakl_dane1 dan1 zakl_dane2 dan2 zakl_dane3 dan3
  VetaB2: c_radku dic_dod c_evid_dd dppd zakl_dane1 dan1 zakl_dane2 dan2 zakl_dane3 dan3 pomer zdph_44
  VetaB3: zakl_dane1 dan1 zakl_dane2 dan2 zakl_dane3 dan3
  VetaC: obrat23 obrat5 pln23 pln5 pln_rez_pren rez_pren23 rez_pren5 celk_zd_a2
DPHSHV (order): VetaD(1) VetaP(1) VetaR* VetaS*
  VetaD: dokument k_uladis shvies_forma rok mesic ctvrt d_poddp   required: dokument k_uladis shvies_forma rok mesic
  VetaP: as DPHDP3 + dodobchjm
  VetaR: c_rad por_c_stran k_stat c_vat k_pln_eu pln_pocet pln_hodnota k_storno
  VetaS: (unchecked: attrs null)
Value formats: date attrs {d_poddp d_zjist dppd duzp dup d_narozeni zdobd_od zdobd_do} ^\d{2}\.\d{2}\.\d{4}$ · dic attrs {dic dic_odb dic_dod} ^[0-9]{1,10}$ · DPHDP3 Veta1/2/4/5/6 attrs ^-?\d+$ · DPHKH1 attrs starting zakl_dane|dan|obrat|pln|rez_pren|celk_zd ^-?\d+\.\d{2}$ · pln_hodnota ^-?\d+$ · rok ^\d{4}$ · mesic ^([1-9]|1[0-2])$ · ctvrt ^[1-4]$
```

Sample xmllint stderr line: `/tmp/dp3.xml:4: element Veta1: Schemas validity error : Element 'Veta1', attribute 'foo': The attribute 'foo' is not allowed.`

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/tax-xml/package.json` | edit | add `"dependencies": { "@shoebox/domain": "workspace:*" }` (same form as `packages/extraction/package.json`) |
| `packages/tax-xml/src/xml.ts` | create | writer + attribute helpers |
| `packages/tax-xml/src/forms.ts` | create | the structure data above + `parseEpoXml` + `checkStructure` |
| `packages/tax-xml/src/validate.ts` | create | `validateXml`, `parseXmllintStderr`, manifest access |
| `packages/tax-xml/src/index.ts` | edit | `export * from './xml'; export * from './forms'; export * from './validate';` (keep `packageName`) |
| `packages/tax-xml/xsd/DPHDP3/03.01.04/manifest.json`, `xsd/DPHKH1/03.01.15/manifest.json`, `xsd/DPHSHV/02.01.05/manifest.json` | create | `{ "form": "DPHDP3", "version": "03.01.04", "verze_pis": "03.01", "main": "dphdp3_epo2.xsd", "source_url": "https://adisspr.mfcr.cz/adis/jepo/schema/dphdp3_epo2.xsd", "sha256": null, "fetched_at": null, "valid_for_periods_from": "2026-01-01" }` (KH: 03.01.15 / dphkh1_epo2.xsd; SHV: 02.01.05 / dphshv_epo2.xsd) |
| `packages/tax-xml/test/validate.test.ts` | create | below |

Run `pnpm install --offline 2>&1 | tail -5` after the package.json edit (workspace link only; if it needs the network, STOP and report).

## 4. Steps

1. `xml.ts` exports exactly:
```ts
export type AttrValue = string | null;                       // null = omitted
export interface VetaNode { readonly name: string; readonly attrs: ReadonlyArray<readonly [string, AttrValue]> }
export interface PisemnostInput { readonly form: 'DPHDP3' | 'DPHKH1' | 'DPHSHV'; readonly verzePis: string; readonly appVersion: string; readonly vety: readonly VetaNode[] }
export const NAZEV_SW = 'Shoebox';
export function escapeAttr(value: string): string;           // & < > " and control chars < 0x20 except \t\n\r (dropped)
export function dateAttr(date: LegalDate): string;           // 'YYYY-MM-DD' → 'DD.MM.YYYY'
export function intAttr(m: Money): AttrValue;                // whole-Kč Money → '13700'; zero → null; throws if m has haléře
export function dec2Attr(m: Money): AttrValue;               // '11549.94'; zero → null
export function textAttr(value: string | null | undefined): AttrValue;   // trimmed; '' → null
export function writePisemnost(input: PisemnostInput): string;
```
`writePisemnost` output, byte-exact: `<?xml version="1.0" encoding="UTF-8"?>\n<Pisemnost nazevSW="Shoebox" verzeSW="{appVersion}">\n  <{form} verzePis="{verzePis}">\n` then each Věta as `    <{name} a="v" b="v"/>\n` (attrs with null dropped, order kept, no spaces around `=`), then `  </{form}>\n</Pisemnost>\n`. A Věta whose attrs are all null is still written as `<Name/>` (the caller decides whether to include it).
2. `forms.ts` exports exactly:
```ts
export type EpoForm = 'DPHDP3' | 'DPHKH1' | 'DPHSHV';
export interface VetaRule { readonly name: string; readonly min: number; readonly max: number | null; readonly attrs: readonly string[] | null; readonly required: readonly string[]; readonly oneOf?: readonly string[] }
export const FORM_RULES: Readonly<Record<EpoForm, readonly VetaRule[]>>;    // the table in §2, in order
export const VALUE_PATTERNS: ReadonlyArray<{ readonly form: EpoForm | 'any'; readonly attr: RegExp; readonly value: RegExp }>;
export interface ParsedVeta { readonly name: string; readonly attrs: Record<string, string>; readonly line: number }
export interface ParsedPisemnost { readonly rootAttrs: Record<string, string>; readonly form: string; readonly formAttrs: Record<string, string>; readonly vety: readonly ParsedVeta[] }
export function parseEpoXml(xml: string): ParsedPisemnost;    // throws Error('tax-xml: not an EPO document') when the root/structure does not match; attribute values are XML-unescaped
export interface StructuralError { readonly line: number | null; readonly element: string | null; readonly message: string }
export function checkStructure(doc: ParsedPisemnost, form: EpoForm): StructuralError[];   // wrong form element; Věta unknown / out of order / too many / missing; attr not allowed; required attr missing; oneOf violated; value pattern violated; empty attribute value
```
3. `validate.ts` exports exactly:
```ts
export interface XsdManifest { readonly form: EpoForm; readonly version: string; readonly verze_pis: string; readonly main: string; readonly source_url: string; readonly sha256: string | null; readonly fetched_at: string | null; readonly valid_for_periods_from: string }
export interface XsdError { readonly line: number | null; readonly element: string | null; readonly message: string }
export interface ValidationResult { readonly valid: boolean; readonly method: 'xsd' | 'structural'; readonly xsdAvailable: boolean; readonly errors: readonly XsdError[] }
export class XmllintMissingError extends Error {}
export type ExecFn = (cmd: string, args: readonly string[], opts: { readonly timeoutMs: number }) => Promise<{ readonly code: number | null; readonly stderr: string; readonly error?: NodeJS.ErrnoException }>;
export function xsdDir(form: EpoForm, version: string): string;            // path.join(<package root>/xsd, form, version); package root via import.meta.url
export function readManifest(form: EpoForm, version: string): XsdManifest | null;
export function xsdAvailable(form: EpoForm, version: string): boolean;     // manifest exists, sha256 non-null, main file exists
export function parseXmllintStderr(stderr: string): XsdError[];
export const defaultExec: ExecFn;                                          // child_process.execFile with timeout; ENOENT → { code: null, stderr: '', error }
export async function validateXml(xml: string, form: EpoForm, version: string, opts?: { readonly exec?: ExecFn; readonly xmllint?: string }): Promise<ValidationResult>;
```
`validateXml`: structural errors first (if any → `{ valid: false, method: xsdAvailable ? 'xsd' : 'structural', errors }` without running xmllint). Then if `xsdAvailable` → write the XML to `os.tmpdir()` (unique name, deleted in `finally`), run `exec(xmllint ?? 'xmllint', ['--noout', '--nonet', '--schema', mainXsd, file], { timeoutMs: 10_000 })`; `error.code === 'ENOENT'` → throw `XmllintMissingError('xmllint not installed')`; exit 0 → valid; else errors = parsed stderr (or one generic error with the raw first line). Not available → `{ valid: true, method: 'structural', xsdAvailable: false, errors: [] }` (`// TODO(decision-xsd)`).
4. Manifests (3 files). 5. index.ts. 6. Test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { checkStructure, dateAttr, dec2Attr, escapeAttr, FORM_RULES, intAttr, parseEpoXml, parseXmllintStderr, readManifest, validateXml, writePisemnost, XmllintMissingError, xsdAvailable } from '../src/index';
import { CZ_DPHDP3_ROW_MAP, Money, parseLegalDate } from '@shoebox/domain';

const czk = (s: string) => Money.parse(s, 'CZK');
const AUG = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Pisemnost nazevSW="Shoebox" verzeSW="0.0.0">',
  '  <DPHDP3 verzePis="03.01">',
  '    <VetaD dokument="DP3" k_uladis="DPH" dapdph_forma="B" typ_platce="I" rok="2026" mesic="8" trans="A" c_okec="552000" d_poddp="20.09.2026"/>',
  '    <VetaP c_ufo="451" c_pracufo="2003" dic="7801011229" typ_ds="F" jmeno="Jan" prijmeni="Novák" ulice="Vinohradská" c_pop="1" naz_obce="Praha" psc="13000" stat="ČESKÁ REPUBLIKA" email="jan@example.com"/>',
  '    <Veta1 p_sl23_e="13700" dan_psl23_e="2877"/>',
  '    <Veta6 dan_zocelk="2877" dano_da="2877"/>',
  '  </DPHDP3>',
  '</Pisemnost>',
  '',
].join('\n');

describe('xml writer', () => {
  it('writes the August golden byte for byte, dropping null attributes', () => {
    const out = writePisemnost({ form: 'DPHDP3', verzePis: '03.01', appVersion: '0.0.0', vety: [
      { name: 'VetaD', attrs: [['dokument', 'DP3'], ['k_uladis', 'DPH'], ['dapdph_forma', 'B'], ['typ_platce', 'I'], ['rok', '2026'], ['mesic', '8'], ['ctvrt', null], ['trans', 'A'], ['c_okec', '552000'], ['d_poddp', dateAttr(parseLegalDate('2026-09-20'))], ['d_zjist', null]] },
      { name: 'VetaP', attrs: [['c_ufo', '451'], ['c_pracufo', '2003'], ['dic', '7801011229'], ['typ_ds', 'F'], ['jmeno', 'Jan'], ['prijmeni', 'Novák'], ['titul', null], ['ulice', 'Vinohradská'], ['c_pop', '1'], ['c_orient', null], ['naz_obce', 'Praha'], ['psc', '13000'], ['stat', 'ČESKÁ REPUBLIKA'], ['email', 'jan@example.com'], ['c_telef', null]] },
      { name: 'Veta1', attrs: [['obrat23', intAttr(czk('0.00'))], ['p_sl23_e', intAttr(czk('13700.00'))], ['dan_psl23_e', intAttr(czk('2877.00'))]] },
      { name: 'Veta6', attrs: [['dan_zocelk', '2877'], ['odp_zocelk', intAttr(czk('0'))], ['dano_da', '2877'], ['dano_no', null]] },
    ] });
    expect(out).toBe(AUG);
  });
  it('attribute helpers', () => {
    expect(escapeAttr('A&B <"x">')).toBe('A&amp;B &lt;&quot;x&quot;&gt;');
    expect(dec2Attr(czk('-9917.36'))).toBe('-9917.36');
    expect(dec2Attr(czk('0.00'))).toBeNull();
    expect(intAttr(czk('-120.00'))).toBe('-120');
    expect(() => intAttr(czk('1.50'))).toThrow();
    expect(dateAttr(parseLegalDate('2026-01-05'))).toBe('05.01.2026');
  });
});

describe('structure rules', () => {
  it('every row-map attribute exists on a DPHDP3 Věta (stand-in for the XSD attribute-existence test)', () => {
    const all = new Set(FORM_RULES.DPHDP3.flatMap((v) => v.attrs ?? []));
    for (const row of CZ_DPHDP3_ROW_MAP) for (const a of row.attrs ?? []) expect(all.has(a), `${row.row}:${a}`).toBe(true);
  });
  it('parses and accepts the golden; rejects a bad attribute, a missing required one, a decimal in DPHDP3 and wrong Věta order', () => {
    const doc = parseEpoXml(AUG);
    expect(doc.form).toBe('DPHDP3');
    expect(doc.vety.map((v) => v.name)).toEqual(['VetaD', 'VetaP', 'Veta1', 'Veta6']);
    expect(doc.vety[1]?.attrs.stat).toBe('ČESKÁ REPUBLIKA');
    expect(checkStructure(doc, 'DPHDP3')).toEqual([]);
    const bad = AUG.replace('p_sl23_e="13700"', 'foo="1" p_sl23_e="137.00"').replace(' dic="7801011229"', '');
    const errors = checkStructure(parseEpoXml(bad), 'DPHDP3');
    expect(errors.map((e) => [e.line, e.element])).toEqual(expect.arrayContaining([[6, 'Veta1'], [5, 'VetaP']]));
    expect(errors.map((e) => e.message).join('\n')).toMatch(/foo.*not allowed/);
    expect(errors.map((e) => e.message).join('\n')).toMatch(/dic/);
    expect(errors.map((e) => e.message).join('\n')).toMatch(/p_sl23_e/);
    const swapped = AUG.replace('    <Veta1 p_sl23_e="13700" dan_psl23_e="2877"/>\n    <Veta6 dan_zocelk="2877" dano_da="2877"/>', '    <Veta6 dan_zocelk="2877" dano_da="2877"/>\n    <Veta1 p_sl23_e="13700" dan_psl23_e="2877"/>');
    expect(checkStructure(parseEpoXml(swapped), 'DPHDP3').some((e) => /order/.test(e.message))).toBe(true);
    expect(checkStructure(doc, 'DPHKH1').some((e) => /DPHKH1/.test(e.message))).toBe(true);
  });
  it('KH needs two-decimal amounts and digits-only DIČ; a second VetaA5 is too many', () => {
    const kh = ['<?xml version="1.0" encoding="UTF-8"?>', '<Pisemnost nazevSW="Shoebox" verzeSW="0"><DPHKH1 verzePis="03.01">',
      '<VetaD dokument="KH1" k_uladis="DPH" khdph_forma="B" rok="2026" mesic="9" d_poddp="20.10.2026"/>', '<VetaP c_ufo="451" dic="CZ7801011229"/>',
      '<VetaA5 zakl_dane1="8264.46" dan1="1735.54"/>', '<VetaA5 zakl_dane1="1" dan1="0.21"/>', '</DPHKH1></Pisemnost>'].join('\n');
    const msgs = checkStructure(parseEpoXml(kh), 'DPHKH1').map((e) => e.message).join('\n');
    expect(msgs).toMatch(/dic/);
    expect(msgs).toMatch(/zakl_dane1/);
    expect(msgs).toMatch(/VetaA5/);
  });
});

describe('validateXml', () => {
  it('manifests exist for the three forms without an XSD yet', () => {
    expect(readManifest('DPHDP3', '03.01.04')?.main).toBe('dphdp3_epo2.xsd');
    expect(readManifest('DPHKH1', '03.01.15')?.verze_pis).toBe('03.01');
    expect(readManifest('DPHSHV', '02.01.05')?.source_url).toMatch(/dphshv_epo2\.xsd$/);
    expect(readManifest('DPHDP3', '99.99.99')).toBeNull();
  });
  it('structural errors win; without the XSD the method is structural', async () => {
    const ok = await validateXml(AUG, 'DPHDP3', '03.01.04', { exec: async () => ({ code: 0, stderr: '' }) });
    expect(ok.valid).toBe(true);
    expect(ok.method).toBe(xsdAvailable('DPHDP3', '03.01.04') ? 'xsd' : 'structural');
    const bad = await validateXml(AUG.replace('mesic="8"', 'mesic="13"'), 'DPHDP3', '03.01.04');
    expect(bad.valid).toBe(false);
    expect(bad.errors[0]).toMatchObject({ line: 4, element: 'VetaD' });
  });
  it('parses xmllint stderr and fails loudly when xmllint is missing (only when the XSD is vendored)', async () => {
    expect(parseXmllintStderr("/tmp/dp3.xml:4: element Veta1: Schemas validity error : Element 'Veta1', attribute 'foo': The attribute 'foo' is not allowed.\n/tmp/dp3.xml fails to validate\n"))
      .toEqual([{ line: 4, element: 'Veta1', message: "Element 'Veta1', attribute 'foo': The attribute 'foo' is not allowed." }]);
    if (xsdAvailable('DPHDP3', '03.01.04')) {
      const enoent = Object.assign(new Error('spawn xmllint ENOENT'), { code: 'ENOENT' });
      await expect(validateXml(AUG, 'DPHDP3', '03.01.04', { exec: async () => ({ code: null, stderr: '', error: enoent }) })).rejects.toBeInstanceOf(XmllintMissingError);
      const real = await validateXml(AUG, 'DPHDP3', '03.01.04');
      expect(real.method).toBe('xsd');
      expect(real.valid, JSON.stringify(real.errors)).toBe(true);   // [verify] once the official XSD is vendored
    }
  });
});
```
Command: `pnpm --filter @shoebox/tax-xml test 2>&1 | tail -30` and `pnpm --filter @shoebox/tax-xml typecheck 2>&1 | tail -30`. Commit `feat(tax-xml): XML writer, form structure rules, validateXml (0336)`.

## 5. Do not touch

`packages/domain` (read-only import), `apps/`, `pnpm-workspace.yaml`. No `fast-xml-parser`, `libxmljs` or any other package.

## 6. Commands

`pnpm --filter @shoebox/tax-xml test 2>&1 | tail -30` · `pnpm --filter @shoebox/tax-xml typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Tests green; `git status` shows exactly the §3 files; the three manifests have `sha256: null`.
- [ ] Report lists the `[verify]` items: zero-attribute omission, `verzePis`, `nazevSW/verzeSW`, Veta5 existence/position, XSD download (T-02).

## 8. Stop and ask

TEMPLATE §8; `pnpm install` needing the network; `xmllint` behaving differently from the parsed stderr format.

## 9. Report

`docs/tasks/0336-report.md`.

## Risk list

`forms.ts` (what we believe the XSD says), `validate.ts`.

## Owner steps

1. On a machine with internet, download the three XSDs (and any file they `include`/`import`) into `packages/tax-xml/xsd/DPHDP3/03.01.04/`, `…/DPHKH1/03.01.15/`, `…/DPHSHV/02.01.05/` from `https://adisspr.mfcr.cz/adis/jepo/schema/dphdp3_epo2.xsd`, `…/dphkh1_epo2.xsd`, `…/dphshv_epo2.xsd`; run `sha256sum` on each main file and put the hash and today's date into the manifest's `sha256` / `fetched_at`; commit on a branch and open a PR. From then on `validateXml` runs xmllint and the golden tests assert XSD validity.
2. Decisions line to append: "2026-10-26 tax-xml: structural validation until the official XSDs are vendored (owner step); filings stay `draft` with `xsd_valid = null` meanwhile; no XML download for users (TODO(decision-xsd))."
