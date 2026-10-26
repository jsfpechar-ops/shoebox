# 0336 report

Status: review
Branch: wt-0336 (steps 0 to 6 committed; head 9434cfa). Not pushed.

Files changed (packages/tax-xml): package.json (step 0, coordinator), src/xml.ts, src/forms.ts, src/validate.ts, src/index.ts, test/validate.test.ts, xsd/{DPHDP3/03.01.04, DPHKH1/03.01.15, DPHSHV/02.01.05}/manifest.json (sha256 null, fetched_at null).

Checks:
- `pnpm --filter @shoebox/tax-xml test` : 2 files, 9 tests passed.
- `pnpm --filter @shoebox/tax-xml typecheck` : clean.
- `pnpm exec biome check --write packages/tax-xml/...` : clean after two fixes (Number() -> Number.parseInt, flagged by the no-number-money rule).

Deviations:
- Commits per step as `0336 step k`; step 0 was done by the coordinator (4a4e447).
- Escape: tab, LF and CR are written as numeric references (&#9; &#10; &#13;), not dropped; other control chars are dropped.
- validateXml: a parse failure (non-EPO document) becomes a structural error instead of throwing.
- VetaD DPHDP3 oneOf treated as exactly one of mesic/ctvrt.

Verify items (report for the owner): zero-attribute omission, verzePis, nazevSW/verzeSW, Veta5 existence and position, XSD download (T-02). Not verified against the primary source in this session (no network).

Questions: none.
Owner steps left: download the three XSDs and fill sha256/fetched_at (see the brief's Owner steps).
