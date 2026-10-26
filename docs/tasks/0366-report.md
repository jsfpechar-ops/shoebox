# 0366 report

Status: review
Commit: cdc90ec (branch wt-0366, not pushed)

## Files changed (git diff --stat HEAD~1)

- packages/tax-xml/src/dpfdp7-partial.ts (new, 135 lines)
- packages/tax-xml/test/dpfdp7-partial.test.ts (new, brief test)
- packages/tax-xml/src/forms.ts, xml.ts, index.ts (unions, FORM_RULES.DPFDP7, patterns, export)
- packages/tax-xml/xsd/DPFDP7/00.00.00/manifest.json (new, sha256 null)
- packages/domain/src/rules/cz/vat-phase3.ts (DPFDP7 entry, tax_years [])
- packages/domain/test/rules-values.test.ts (one it)
- testdata/golden-v1/expected/income-tax/dpfdp7-partial-2026.xml (new)

## Commands (last lines)

- `pnpm --filter @shoebox/tax-xml test -- dpfdp7`: Test Files 9 passed (9), Tests 63 passed (63). The filter did not narrow the run, so this is the whole package.
- `pnpm --filter @shoebox/domain test -- rules`: Test Files 42 passed (42), Tests 687 passed (687).
- `pnpm --filter @shoebox/tax-xml typecheck`: tsc clean, no errors.
- `pnpm --filter @shoebox/domain typecheck`: tsc clean, no errors.
- `pnpm exec biome check` on changed paths: Checked 12 files, No fixes applied.
- `pnpm depcruise`: no dependency violations found (680 modules, 2031 dependencies cruised).
- Coverage, tax-xml/src: Lines 97.82% (270/276). dpfdp7-partial.ts 95.45% lines.

## Section 7

- [x] S3 gives kc_prij7 3500000, kc_vyd7 1200000, pr_sazba 60 and vyd7proc A. checkStructure returns []. RČ format and checksum tests pass.
- [x] Unverified attributes and manifest status are listed below.

## Golden file (testdata/golden-v1/expected/income-tax/dpfdp7-partial-2026.xml)

```
<?xml version="1.0" encoding="UTF-8"?>
<Pisemnost nazevSW="Shoebox" verzeSW="0.1.0">
  <DPFDP7 verzePis="00.00">
    <VetaD dokument="DP7" k_uladis="DPF" rok="2026" dap_typ="B" pln_moc="N" audit="N" c_ufo_cil="451" c_pracufo="2001"/>
    <VetaP rod_c="7801011229" jmeno="Lucie" prijmeni="Nováková" email="lucie@example.test" c_telef="+420777000111" naz_obce="Praha 3" ulice="Vinohradská" c_pop="100" psc="13000" stat="CZ"/>
    <VetaT c_nace="620200" kc_prij7="3500000" kc_vyd7="1200000" pr_sazba="60" vyd7proc="A"/>
  </DPFDP7>
</Pisemnost>
```

Written by hand from the §2 table and checked attribute by attribute; the byte-for-byte test passes against the serializer.

## Deviations

1. Manifest path: the brief says `xsd/DPFDP7/manifest.json`. validate.ts `readManifest` reads `xsd/<form>/<version>/manifest.json` (as with DPHDP3), so the file is at `xsd/DPFDP7/00.00.00/manifest.json`.
2. `tax_years` is typed `[] as readonly number[]`. A bare `[]` under `as const` makes `.includes(year)` a type error.
3. `EPO_FORMS` in forms.ts also gets `DPFDP7`. Without it, parseEpoXml rejects the root element. The brief does not name this line.
4. Biome reformatted the brief's test file (layout and import order only; test content unchanged).
5. The unused `LegalDate` import from the brief's signature block was dropped.
6. law.ts not changed: `epo.forms` uses `ModuleOwnedRecord`, which accepts `tax_years`.

## Unverified ([verify], T-03)

- Every VetaD, VetaP and VetaT attribute name, and `vyd7proc = 'A'`.
- `version` `00.00.00` and `verze_pis` `00.00` are placeholders.
- The RČ checksum pre-1986 rule (remainder 10 with last digit 0).
- Whether EPO accepts VetaT without VetaO.
- Manifest `sha256: null`. No XSD is vendored, so `isPartialXmlAvailable(2026)` is false and the feature stays hidden.

## Questions

None.

## Owner steps left

1. Download the XSD from `https://adisspr.mfcr.cz/adis/jepo/schema/dpfdp7_epo2.xsd`.
2. Vendor it under `packages/tax-xml/xsd/DPFDP7/<version>/`, set `version` and `verze_pis` in vat-phase3.ts, fill the manifest sha256 and fetched_at.
3. Add the year to `tax_years` and check the attribute names against the XSD.
