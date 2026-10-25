# 0012a report: Czech PII guard script

Status: review. Branch `task/0012a-pii-guard` (base 71ce9f3). Executor: Haiku 5.5.

## 1. Files changed (`git diff --stat origin/phase/0...HEAD`, base 71ce9f3)

- `scripts/pii_guard.py` new, 263 lines
- `scripts/test/test_pii_guard.py` new, 208 lines
- `testdata/pii-allowlist.txt` new, 4 lines
- `docs/context/test-map.md` one row added
- `docs/tasks/0012a-pii-guard.md` Status line only
- `docs/tasks/0012a-report.md` this file

Note: `origin/phase/0` moved to 6501bcb after the fetch, so a two-dot diff shows unrelated files. Use the three-dot form above.

## 2. Commands (last lines)

- `python3 scripts/test/test_pii_guard.py 2>&1 | tail -5` gives `Ran 18 tests in 0.873s` and `OK`.
- `python3 scripts/pii_guard.py --all apps packages scripts testdata 2>&1 | tail -12` gives 10 hits, not 8. Redacted list:
  - `packages/platform/test/logger.test.ts:22: iban (CZ6…9)`
  - `packages/platform/test/logger.test.ts:110: iban (CZ6…9)`
  - `testdata/golden-v1/docs/DPHDP3-7801011229-20260920-141836.pdf:0: rodne_cislo in file name (780…9)`
  - `testdata/golden-v1/labels.json:7, 353, 449: dic_natural_person (CZ8…1)`
  - `testdata/golden-v1/labels.json:143, 200, 766, 801: dic_natural_person (CZ8…5)`
  - Final line: `pii_guard: 10 hit(s). Anonymize the value, or allowlist a public or synthetic one in testdata/pii-allowlist.txt.`
- `python3 scripts/pii_guard.py --diff origin/phase/0...HEAD 2>&1 | tail -5` gives `pii_guard: OK`.
- `python3 scripts/context_lint.py 2>&1 | tail -8` gives `context lint: OK`, with only pre-existing WARN lines (packages/domain/rules not created yet).
- `pnpm lint 2>&1 | tail -5` could not run: `biome: not found`, because `node_modules` is missing. Biome ignores `.py` and `.txt`, so no effect expected.

## 3. Section 7 acceptance

- [x] Guard implemented, stdlib only.
- [x] Unit tests pass (18).
- [x] Allowlist exists in `value;reason;source` form, with scope proven by `test_allowlist_scope`.
- [x] CI job and gitleaks are not in this brief (0012b).
- [x] Golden-set hits listed above (see Deviations).

## 4. Deviations

- The `--all` run reports 10 hits, not the 8 in the brief. The two extra are IBAN hits in `packages/platform/test/logger.test.ts` (lines 22 and 110). The value checksum-validates, and it is not on the allowlist, so it is reported. Not allowlisted, not edited. Owner or orchestrator to decide whether it is synthetic.
- The step 5 self-check passes, so nothing added by this branch is a hit.

## 5. Questions

- Is `packages/platform/test/logger.test.ts` IBAN synthetic? It is outside `testdata/golden-v1/`, so the allowlist decision belongs to the owner.

## 6. Owner steps left

1. Read the 10 redacted hits above. For the two natural-person DIČ values and the PDF name under `testdata/golden-v1/`, follow owner step 1 in the brief. For the two `logger.test.ts` IBAN hits, decide whether they are synthetic. If so, add them to `testdata/pii-allowlist.txt` with a reason.
2. Optional, after 0012b: check the bank-code list in `scripts/pii_guard.py` against the ČNB CSV.
