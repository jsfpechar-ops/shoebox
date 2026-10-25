# 0012b report: Czech PII guard in CI and gitleaks

Status: review. Branch task/0012b-pii-ci, base origin/phase/0 (67bd870).

## 1. Files changed (`git diff --stat origin/phase/0`)

```
 .github/workflows/ci.yml     | 29 +++++++++++++++++++++++++++++
 .gitleaks.toml               | 36 ++++++++++++++++++++++++++++++++++
 scripts/gitleaks_selftest.sh | 12 ++++++++++++
 3 files changed, 77 insertions(+)
```

Commits: `0012b step 1` (ee642e3), `0012b step 2` (6bb0277), `0012b step 3` (7ae7769). Step 4 is checks only.

## 2. Commands (last 5 lines each)

- Step 1: `python3 -c "import tomllib ..."` → `['supabase-secret-key', 'supabase-service-role-key', 'cz-rodne-cislo', 'cz-bank-account', 'cz-iban', 'cz-dic-natural-person']`
- Step 2: `grep -n '^  [a-z-]*:$' ci.yml | tail -8` → `secrets` (66), `pii` (109), `context-lint` (138), `depcruise` (149). Order is as required. Also `yaml.safe_load` → `yaml ok`.
- Step 3: `bash -n scripts/gitleaks_selftest.sh && echo 'syntax ok'` → `syntax ok`
- Step 4: `python3 scripts/pii_guard.py --diff origin/phase/0...HEAD` → `pii_guard: OK`
- Step 4: `python3 scripts/test/test_pii_guard.py` → `Ran 18 tests in 0.860s` / `OK`
- §6: `python3 scripts/context_lint.py` → WARN lines only (existing, not from these files), then `context lint: OK`

## 3. §7 acceptance

- [x] CI job `pii` runs the self-test, then `pii_guard.py --diff` on the PR range.
- [x] Four Czech rules present with rule-level allowlists (tomllib check above).
- [ ] `gitleaks_selftest.sh` proves the rules fire in CI. CI verifies (gitleaks not installed locally; syntax checked only).
- [ ] `secrets` and `pii` green on the PR. CI verifies.

## 4. Deviations

- The gitleaks allowlists use `condition = "OR"` as the brief specifies. This is untested locally. If the `secrets` self-test reports "did not flag", split each allowlist into two tables (see brief Risk list).
- Step 2 was inserted with a short one-off Python replacement script written to `/tmp` (removed afterwards). Its output was verified with the grep and yaml check.
- `scripts/__pycache__/` was created by running the test and removed before the report. Not committed.

## 5. Questions

None.

## 6. Owner steps left

1. After the merge, in GitHub: repository Settings → Branches (or Rules) → the rule for `main` and `phase/*` → "Require status checks to pass" → add `pii` next to `secrets`. Save.
2. Open the merged PR's Actions run and check that the `secrets` job printed both `SELFTEST OK` lines and the `pii` job printed `pii_guard: OK`. If the second `SELFTEST OK` is missing, tell the orchestrator (see Risk list, first item).
