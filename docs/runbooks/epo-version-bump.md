# EPO version bump (DPHDP3 / DPHKH1 / DPHSHV)

Trigger: `ops.drift_monitors` warned `EPO drift detected`, or the yearly January check.

1. Open the structure list (EPO_LIST_URL) and the detail page `popis_struktury_detail.faces?zkratka=<CODE>`; note the new version and date.
2. Download the new XSD set (main file + includes) into `packages/tax-xml/xsd/<FORM>/<new version>/`; write `manifest.json` (sha256sum of the main file, fetched_at, valid_for_periods_from = first period the new structure applies to).
3. Diff attributes against the previous version (`diff <(grep -o 'name="[^"]*"' old.xsd | sort) <(… new.xsd …)`); for each changed attribute update `packages/domain/src/rules/cz/epo.ts` (`CZ_DPHDP3_ROW_MAP`, `CZ_DPHDP3_DERIVED_ROWS`) and `packages/tax-xml/src/forms.ts`.
4. Add the new version to `epo.forms` in `packages/domain/src/rules/cz/<year>.ts` as a new segment (never edit the old one).
5. Regenerate golden XML (`testdata/golden-v1/expected/vat/`) only if attributes changed; review the diff by hand against the filed return.
6. Run: `pnpm --filter @shoebox/tax-xml test`, `pnpm --filter @shoebox/domain test -- kh-dp3 dphdp3 epo-rows rules`, `pnpm eval --quick`.
7. PR with the drift finding, the version page link and the hash; owner merges; `[verify]` items in 22 T-02 updated.
