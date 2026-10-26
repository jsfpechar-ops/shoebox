# 0338 report: serializeDphdp3 with golden XML

Status: review

## Files changed

- `packages/domain/src/rules/cz/epo.ts`: added `CZ_DPHDP3_DERIVED_ROWS` (data only, before `parseDphdp3RowMap`).
- `packages/tax-xml/src/dphdp3.ts` (new): `vetaOfRow`, `Dphdp3SerializeOptions`, `serializeDphdp3`.
- `packages/tax-xml/src/index.ts`: `export * from './dphdp3';` (biome moved it to the top of the export list).
- `packages/tax-xml/test/dphdp3.test.ts` (new): brief test, with `cases[3]!` replaced by a `must()` guard.
- `testdata/golden-v1/expected/vat/dphdp3-2026-08.xml`, `dphdp3-2026-09.xml`, `dphdp3-2026-10.xml`, `dphdp3-payer-2026-09.xml` (new).

## Checks

- `pnpm --filter @shoebox/tax-xml test -- dphdp3`: 3 files, 17 tests passed (includes the 8 dphdp3 tests; the 4 goldens also pass `validateXml`).
- `pnpm --filter @shoebox/tax-xml typecheck`: clean.
- `pnpm --filter @shoebox/domain typecheck`: clean.
- `pnpm exec biome check --write` on the changed TS files: fixed formatting only.
- `pnpm eval --quick`: PASS, 2 pass, 0 fail, 20 skip (no adapters registered; same as before).

## T-02 attribute decisions (for 22 §C)

- Derived attrs 44, 46, 62–66 are `confirmed: false` in `CZ_DPHDP3_DERIVED_ROWS`. The serializer still emits them (the goldens need them).
- Nil return: when every Veta6 value is empty, `dano_da="0"` is written, giving `<Veta6 dano_da="0"/>`.
- `c_okec` is emitted from `naceCode6` for every filing kind (including identifikovana osoba).
- `verzePis="03.01"`.

## Deviations and questions

1. VetaP mapping: `c_ufo` takes `taxpayer.fuCode` and `c_pracufo` takes `taxpayer.ufoCode`. This is the order the goldens require (`c_ufo="451" c_pracufo="2003"`), but the header field names look swapped relative to the names. Please confirm.
2. Single-attribute rows (a row whose `attrs` has one name, e.g. row 2 `plnosv_nkf` and derived 46, 62–66) are serialized as the tax amount. Row 46 and 62–66 need this. Row 2 is unverified and no golden covers it; please confirm whether row 2 is a base-only value.
3. The serializer throws `dphdp3: row N has no attrs` for a non-zero computed row that is in neither the row map nor the derived list (the brief only named the case of a row in the map). This avoids silently dropping money.
4. Golden files were written by hand from the brief, and the first run caught only the c_ufo/c_pracufo swap in deviation 1.

## Owner steps left

- After the XSDs are vendored (0336), re-run `pnpm --filter @shoebox/tax-xml test -- dphdp3`. Any failure is a T-02 finding for 22 §C.
