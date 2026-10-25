# 0011 report: secret scanning with gitleaks

Status: blocked. Steps 0 to 4 done. Step 5 and every gitleaks run are blocked by the sandbox.

## 1. Files changed (`git diff --stat origin/phase/0`)

```
 .github/workflows/ci.yml       | 43 +++++++
 .gitleaks.toml                 | 28 +++++++
 scripts/gitleaks_selftest.sh   | 22 +++++++
 scripts/pre-commit-gitleaks.sh | 10 +++++++
 4 files changed, 103 insertions(+)
```

Commits: `0011 step 1` (9df7eab), `0011 step 2` (a9cceeb), `0011 step 3` (b5f6378), `0011 step 4` (e250bcf). The brief's Status line is set to `blocked`.

## 2. Commands

- Step 0 checksum: `/tmp/gl/gl.tgz: OK`, `8.30.1`.
- Step 1 `gitleaks git ... .`: refused by the sandbox guard (see Deviations). Not run.
- Step 2 `bash scripts/gitleaks_selftest.sh`: refused by the sandbox guard. Not run.
- Step 3 pre-commit: not run (it calls `gitleaks git`, same guard).
- Step 4 `yaml.safe_load(ci.yml)`: `['setup', 'lint', 'typecheck', 'unit', 'secrets', 'context-lint']`.
- Step 5 `gitleaks git ... origin/phase/0..HEAD`: refused by the sandbox guard. Not run.
- `python3 scripts/context_lint.py`: `context lint: OK` (warnings only, pre-existing).
- `pnpm lint`: fails, `biome: not found`, `node_modules` missing. Not installed. The changes are YAML, TOML and shell, which biome does not lint.

## 3. §7 acceptance

- [x] `ci.yml` has job `secrets` (checksum-pinned 8.30.1, range from PR or push, `.gitleaks.toml`). Not run locally.
- [ ] Self-test `SELFTEST OK` not seen locally. CI runs it in the `secrets` job.
- [x] `.env` check is in the job. Not run locally.
- [ ] Full history clean: not verified locally. CI runs it.
- [x] Optional hook `scripts/pre-commit-gitleaks.sh` written (`gitleaks git --pre-commit --staged`).

## 4. Deviations

- Sandbox guard: every command that runs `gitleaks` with `git` or `dir` or `.` as an operand was refused ("names git in a form too complex to verify"). This includes the step 1, 2, 3 and 5 commands and `gitleaks dir`. I did not work around the guard. The only local gitleaks run was `gitleaks version`.
- Step 0 `git checkout` was done before the brief's step 0 command, in the same form. Branch and HEAD match.
- `pnpm lint` not run (no `node_modules`).
- Done: steps 0 to 4. Left: step 5 and the local verifications above.

## 5. Questions

- Can the orchestrator or owner run the step 1, 2 and 5 gitleaks commands from a shell outside this sandbox? Or rely on the CI `secrets` job, which runs the same self-test and history scan on push?

## 6. Owner steps left

1. Nothing to set up for CI: the job needs no secret and no account.
2. After the PR is merged: GitHub → the repository → Settings → Branches (or Rules → Rulesets) → the rule for `main` and `phase/**` → Require status checks → add `secrets` → Save.
3. Optional proof: open a throwaway branch, add a file `leak.txt` with the line `SUPABASE_SERVICE_ROLE_KEY=` followed by any 40 random letters, open a PR to `phase/0`, see the `secrets` job turn red, then close the PR and delete the branch.
4. Optional local hook on your computer: install gitleaks 8.30.1 (`brew install gitleaks`, or download it from github.com/gitleaks/gitleaks/releases), then in the repo folder run `ln -s ../../scripts/pre-commit-gitleaks.sh .git/hooks/pre-commit`. Every `git commit` now scans the staged files first.
