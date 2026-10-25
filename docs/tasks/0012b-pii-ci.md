# 0012b: Czech PII guard in CI and gitleaks

Status: done
Ticket: P0-PII-02 (part b of 2) | Depends on: 0012a (merged into phase/0) | Base commit: head of phase/0 | Branch: task/0012b-pii-ci | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the CI job `pii` that runs `scripts/pii_guard.py` on the added lines of every PR or push, and add shape-only Czech PII rules to `.gitleaks.toml` so the `secrets` job also catches them in history scans. Together with 0012a this closes ticket P0-PII-02: a PR that adds a real-looking rodné číslo, bank account, IBAN or natural-person DIČ fails.

## 2. Context

Ticket P0-PII-02, item 4 (the spec): "CI job `pii` fails the PR on a hit; the same patterns are added to `.gitleaks.toml` for history scans."

rules.md "Privacy and security" (pasted): "The PII guard in CI (gitleaks + Czech rules: account numbers, rodná čísla, IBANs, DIČ from a birth number) blocks the PR; public company IDs are allowlisted in `.gitleaks.toml`."

What 0012a delivered (do not change it): `scripts/pii_guard.py --diff <range>` scans the added lines of `git diff <range>` plus the names of added files and exits 1 on a hit, 0 otherwise; `--all <path>...` scans files. `scripts/test/test_pii_guard.py` is its self-test (`python3 scripts/test/test_pii_guard.py` → `Ran 18 tests … OK`). `testdata/pii-allowlist.txt` holds the synthetic RČ `7801011229`.

Orchestrator decisions:

- gitleaks (8.30.1, owner-approved) uses Go RE2 regexes: no lookbehind, no checksums. The four gitleaks rules are therefore shape-only (a plausible month and day for RČ and DIČ, a known bank code for accounts, `CZ` + 22 digits for IBAN) and exist for history scans; the checksum work stays in `pii_guard.py`. Each rule allowlists the files that hold the synthetic vectors by design (`scripts/test/test_pii_guard.py`, `testdata/pii-allowlist.txt`, `docs/tasks/`) and the M06 test RČ, as rule-level allowlists, so secret rules are not weakened.
- gitleaks is not installed in the executor sandbox (brief 0011 hit the same limit). The TOML is verified in CI by the `secrets` job: `scripts/gitleaks_selftest.sh` gains a second case that must fail on a synthetic RČ and account built at run time. You check the TOML syntax locally with Python's `tomllib`.
- The `pii` job is a new job inserted between `secrets` and `context-lint`. Brief 0010a appends its `depcruise` job AFTER `context-lint`; the two edits do not overlap. Change nothing else in `ci.yml`.
- Range logic mirrors the `secrets` job. Pull request: `base...head` (three dots: only the PR's own changes). Push with a known `before`: `before..sha`. Otherwise (new branch, force push): the last commit only, so a new branch does not re-scan pre-existing data.

Excerpt of `.github/workflows/ci.yml` (anchor for Step 2; must be found verbatim):

```yaml
          gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--no-merges $range" .

  context-lint:
```

Excerpt of `.gitleaks.toml`, its last lines (anchor for Step 1; must be found verbatim):

```toml
[[allowlists]]
description = "Obviously fake HMAC test secrets (brief 0009 tests)"
regexTarget = "match"
regexes = ['''-secret-of-at-least-32-characters-''']
```

Excerpt of `scripts/gitleaks_selftest.sh`, its last lines (anchor for Step 3; must be found verbatim):

```bash
  echo 'SELFTEST FAIL: gitleaks did not flag the fake Supabase service key' >&2
  exit 1
fi
echo 'SELFTEST OK: fake Supabase service key was flagged'
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `.gitleaks.toml` | edit | append four Czech PII rules with rule-level allowlists |
| `.github/workflows/ci.yml` | edit | insert the `pii` job before `context-lint` |
| `scripts/gitleaks_selftest.sh` | edit | append the Czech PII self-test case |
| `docs/tasks/0012b-report.md` | new | the report |
| `docs/tasks/0012b-pii-ci.md` | edit | Status line only |

No other file may change.

## 4. Steps

Setup: `git fetch origin phase/0 && git checkout -b task/0012b-pii-ci origin/phase/0 2>&1 | tail -3`. Confirm 0012a is in: `test -f scripts/pii_guard.py && echo present` → `present` (else stop, §8). Commit after each step as `0012b step k`.

### Step 1: `.gitleaks.toml` (edit)

Append after the anchor (end of file):

```toml

# Czech PII, shape only (P0-PII-02, brief 0012b). Checksums live in scripts/pii_guard.py.
# Rule-level allowlists: the files that hold synthetic vectors by design, and the M06 test RC.
[[rules]]
id = "cz-rodne-cislo"
description = "Czech birth number YYMMDD/XXX(X) with a plausible month and day"
regex = '''\b\d{2}(?:0[1-9]|1[0-2]|2[1-9]|3[0-2]|5[1-9]|6[0-2]|7[1-9]|8[0-2])(?:0[1-9]|[12]\d|3[01])/\d{3,4}\b'''
[[rules.allowlists]]
condition = "OR"
paths = ['''^scripts/test/test_pii_guard\.py$''', '''^testdata/pii-allowlist\.txt$''', '''^docs/tasks/''']
regexTarget = "match"
regexes = ['''780101/1229''']

[[rules]]
id = "cz-bank-account"
description = "Czech bank account number with a known bank code"
regex = '''\b(?:\d{1,6}-)?\d{6,10}/(?:0100|0300|0600|0710|0800|2010|2020|2060|2070|2100|2200|2220|2250|2260|2275|2600|2700|3030|3050|3060|3500|4000|4300|5500|5800|6000|6100|6200|6210|6300|6363|6700|6800|7910|7950|7960|7970|7990|8030|8040|8060|8090|8150|8190|8198|8199|8200|8215|8220|8230|8240|8250|8255|8265|8270|8280|8293|8299|8500)\b'''
[[rules.allowlists]]
paths = ['''^scripts/test/test_pii_guard\.py$''', '''^testdata/pii-allowlist\.txt$''', '''^docs/tasks/''']

[[rules]]
id = "cz-iban"
description = "Czech IBAN (CZ + 22 digits, spaces allowed)"
regex = '''\bCZ\d{2}(?:\s?\d{4}){5}\b'''
[[rules.allowlists]]
paths = ['''^scripts/test/test_pii_guard\.py$''', '''^testdata/pii-allowlist\.txt$''', '''^docs/tasks/''']

[[rules]]
id = "cz-dic-natural-person"
description = "Czech DIC of a natural person (CZ + birth-number shape)"
regex = '''\bCZ\d{2}(?:0[1-9]|1[0-2]|2[1-9]|3[0-2]|5[1-9]|6[0-2]|7[1-9]|8[0-2])(?:0[1-9]|[12]\d|3[01])\d{3,4}\b'''
[[rules.allowlists]]
condition = "OR"
paths = ['''^scripts/test/test_pii_guard\.py$''', '''^testdata/pii-allowlist\.txt$''', '''^docs/tasks/''']
regexTarget = "match"
regexes = ['''7801011229''']
```

Command: `python3 -c "import tomllib; d=tomllib.load(open('.gitleaks.toml','rb')); print([r['id'] for r in d['rules']])" 2>&1 | tail -3` → `['supabase-secret-key', 'supabase-service-role-key', 'cz-rodne-cislo', 'cz-bank-account', 'cz-iban', 'cz-dic-natural-person']`.

### Step 2: `.github/workflows/ci.yml` (edit)

Replace the anchor with (the first line and the last line are unchanged; the `pii` job goes between them):

```yaml
          gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--no-merges $range" .

  pii:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 0
      - name: PII guard self-test
        run: python3 scripts/test/test_pii_guard.py
      - name: Czech PII guard on the added lines of this PR or push
        env:
          EVENT: ${{ github.event_name }}
          PR_BASE: ${{ github.event.pull_request.base.sha }}
          PR_HEAD: ${{ github.event.pull_request.head.sha }}
          PUSH_BEFORE: ${{ github.event.before }}
          SHA: ${{ github.sha }}
        run: |
          if [ "$EVENT" = pull_request ]; then
            range="$PR_BASE...$PR_HEAD"
          elif [ -n "$PUSH_BEFORE" ] && git cat-file -e "${PUSH_BEFORE}^{commit}" 2>/dev/null; then
            range="$PUSH_BEFORE..$SHA"
          elif git cat-file -e "${SHA}~1^{commit}" 2>/dev/null; then
            range="${SHA}~1..$SHA"
          else
            echo 'first commit, nothing to compare'; exit 0
          fi
          python3 scripts/pii_guard.py --diff "$range"

  context-lint:
```

Command: `grep -n '^  [a-z-]*:$' .github/workflows/ci.yml | tail -8` → `setup`, `lint`, `typecheck`, `unit`, `secrets`, `pii`, `context-lint` in that order.

### Step 3: `scripts/gitleaks_selftest.sh` (edit)

Append after the anchor (end of file). The values are built from parts at run time, so no complete identifier is written into the script:

```bash

# Czech PII rules (brief 0012b): a commit adding a synthetic RC and account must be flagged too.
rc="$(printf '%s/%s' 900101 0007)"
account="$(printf '%s/%s' 1234562 0100)"
printf 'rc=%s\nucet=%s\n' "$rc" "$account" > "$work/fixture.txt"
git -C "$work" add fixture.txt
git -C "$work" commit -q -m 'add synthetic czech pii'
if gitleaks git --no-banner --redact --config "$config" --log-opts='HEAD~1..HEAD' "$work"; then
  echo 'SELFTEST FAIL: gitleaks did not flag the synthetic Czech PII' >&2
  exit 1
fi
echo 'SELFTEST OK: synthetic Czech PII was flagged'
```

Command: `bash -n scripts/gitleaks_selftest.sh && echo 'syntax ok' 2>&1 | tail -3` → `syntax ok`. (Running it needs gitleaks, which the sandbox lacks; CI runs it in the `secrets` job.)

### Step 4: local guard run in diff mode

Command: `python3 scripts/pii_guard.py --diff origin/phase/0...HEAD 2>&1 | tail -5` → `pii_guard: OK`. Then `python3 scripts/test/test_pii_guard.py 2>&1 | tail -3` → `OK`.

## 5. Do not touch

`scripts/pii_guard.py`, `scripts/test/test_pii_guard.py`, `testdata/`, `apps/`, `packages/`, any `ci.yml` job other than the inserted `pii` block, the existing gitleaks rules and global allowlists, `docs/` other than the two files in §3. Hard rules: 4 (never write a complete real-looking identifier into any file; the self-test builds its values from parts), 7 (no dependency), 8 (never push to `main`).

## 6. Commands

- `python3 -c "import tomllib; d=tomllib.load(open('.gitleaks.toml','rb')); print(len(d['rules']))" 2>&1 | tail -3` → `6`
- `grep -n '^  [a-z-]*:$' .github/workflows/ci.yml | tail -8` → `secrets`, `pii`, `context-lint` in that order
- `bash -n scripts/gitleaks_selftest.sh && echo 'syntax ok' 2>&1 | tail -3` → `syntax ok`
- `python3 scripts/test/test_pii_guard.py 2>&1 | tail -3` → `OK`
- `python3 scripts/pii_guard.py --diff origin/phase/0...HEAD 2>&1 | tail -5` → `pii_guard: OK`
- `python3 scripts/context_lint.py 2>&1 | tail -8` → no error for your files

## 7. Acceptance

- [ ] CI job `pii` runs `scripts/test/test_pii_guard.py` and then `scripts/pii_guard.py --diff` on the PR's own changes; a hit fails the job (exit 1).
- [ ] `.gitleaks.toml` has the four Czech PII rules `cz-rodne-cislo`, `cz-bank-account`, `cz-iban`, `cz-dic-natural-person`, each with the narrow rule-level allowlist above.
- [ ] `scripts/gitleaks_selftest.sh` proves in CI that the gitleaks rules fire on a synthetic RČ and account.
- [ ] Verified only by CI, not locally: the `secrets` and `pii` jobs are green on the PR (orchestrator checks after push); the owner adds `pii` as a required check (Owner step 1).

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found, or `scripts/pii_guard.py` is missing on `origin/phase/0` (0012a not merged yet);
- a command's output differs twice;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0012b-report.md` (600 tokens at most) and set `Status: review` in this brief. The report has:

1. The files changed (`git diff --stat origin/phase/0 2>&1 | tail -10`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked (the CI-only item stays unticked with the note "CI verifies").
4. Deviations.
5. Questions.
6. Owner steps left (copy the Owner steps below).

Commit `0012b report`, then `git push -u origin task/0012b-pii-ci 2>&1 | tail -5`. The orchestrator opens the PR, waits for the `secrets` and `pii` jobs, and merges.

## Risk list (for the reviewer)

- `.gitleaks.toml`: the rule-level allowlists must stay rule-level (never a global `paths` allowlist, which would also exempt those paths from secret rules). The `docs/tasks/` path exemption applies to the four PII rules only. If the `secrets` job fails on the self-test with "did not flag", the `condition = "OR"` form is not honoured by 8.30.1: split each allowlist into two tables (one `paths`, one `regexes`).
- `.github/workflows/ci.yml` `pii` job: the three-dot PR range and the "last commit only" fallback; `fetch-depth: 0` is required for both.
- `scripts/gitleaks_selftest.sh`: `--log-opts='HEAD~1..HEAD'` isolates the second commit; without it the first (fake key) commit alone makes the scan fail and the new case proves nothing.

## Owner steps

1. After the merge, in GitHub: repository Settings → Branches (or Rules) → the rule for `main` and `phase/*` → "Require status checks to pass" → add `pii` next to `secrets`. Save.
2. Open the merged PR's Actions run and check that the `secrets` job printed both `SELFTEST OK` lines and the `pii` job printed `pii_guard: OK`. If the second `SELFTEST OK` is missing, tell the orchestrator (see Risk list, first item).
