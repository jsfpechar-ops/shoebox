# 0011: Secret scanning with gitleaks

Status: done
Ticket: P0-PII-01 | Depends on: none (P0-REPO-01 and P0-CI-01 merged) | Base commit: head of phase/0 | Branch: task/0011-secret-scanning | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add a `secrets` CI job that runs gitleaks on the commits of every PR (and push) with a repo config `.gitleaks.toml`, fails when a key, token or `.env` file is added, and proves itself with a self-test that a fake Supabase service key is caught. Shoebox stores tax and bank data for its users: one leaked service key exposes every organisation.

## 2. Context

Spec, M12 §4.3 step 2 (pasted): "Parallel jobs: … `secrets` (gitleaks on the diff)."

Spec, M12 §4.13 Secrets (pasted): `SUPABASE_SERVICE_ROLE_KEY` lives in Secret Manager. "Rules: nothing secret in `NEXT_PUBLIC_*`; `.env.example` lists names only; gitleaks in CI; local dev uses Supabase CLI defaults and replay cassettes, so no production secret is ever needed locally."

rules.md "Privacy and security" (pasted): "Never commit real documents, `.env`, keys or personal data. … The PII guard in CI (gitleaks + Czech rules …) blocks the PR." The Czech PII rules are ticket P0-PII-02, not this brief.

Ticket acceptance (P0-PII-01): CI job `secrets` runs gitleaks on the PR diff with `.gitleaks.toml`; a PR adding a fake Supabase service key fails. Optional local hook documented in the report (`gitleaks protect --staged`).

Orchestrator decisions for this brief (already tested by the orchestrator against this repo):

- gitleaks is owner-approved (decisions.md 2026-10-18, "gitleaks in CI and pre-commit").
- Version **8.30.1** (released 2026-03-12, the latest tag). We download the release binary and verify its SHA-256, instead of `gitleaks/gitleaks-action` (that action needs a paid licence key for organisation repos). linux_x64 checksum from `gitleaks_8.30.1_checksums.txt`: `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`.
- In 8.30, `gitleaks protect --staged` is replaced by `gitleaks git --pre-commit --staged`. Use the new form.
- No hook manager (husky, lefthook…) is approved. The local hook is a plain script `scripts/pre-commit-gitleaks.sh` that the owner links into `.git/hooks/` by hand (Owner steps).
- The default gitleaks rules have no Supabase rule. `.gitleaks.toml` extends the defaults and adds two: `sb_secret_…` keys and any value assigned to `SUPABASE_SERVICE_ROLE_KEY`.
- Allowlists: the public Supabase CLI local demo keys (issuer `supabase-demo`) and the obviously fake HMAC test secrets of brief 0009 (`a-secret-of-at-least-32-characters-aaaa`); without the second, the 0009 PR fails this job.
- The self-test builds the fake key at run time inside a temporary git repo, so no secret-looking value is ever committed and no fixture needs an allowlist.
- Brief 0010 also edits `ci.yml` and inserts its jobs AFTER `context-lint`. This brief inserts `secrets` BEFORE `  context-lint:`. Do not touch anything else in `ci.yml`.

Excerpt of `.github/workflows/ci.yml` (the anchor for step 5; must be found verbatim):

```yaml
      - name: Unit and ui tests with coverage gates
        run: pnpm test:unit

  context-lint:
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `.gitleaks.toml` | create | gitleaks config: defaults + 2 Supabase rules + 2 allowlists |
| `scripts/gitleaks_selftest.sh` | create | fake Supabase service key in a temp repo must be flagged |
| `scripts/pre-commit-gitleaks.sh` | create | optional local pre-commit hook |
| `.github/workflows/ci.yml` | edit | add job `secrets` before `context-lint` |
| `docs/tasks/0011-report.md` | create | report |
| `docs/tasks/0011-secret-scanning.md` | edit | Status line only |

No other file may change.

## 4. Steps

Write each file with one Write call. Do not re-read a file you just wrote. Do not explore the repo. The code blocks inside the steps are indented 3 spaces only because they sit in a numbered list: remove exactly those 3 leading spaces from every line (for step 4 the anchor is then identical to the §2 excerpt; YAML indentation inside is 2 spaces per level). Commit after each step: `git add -A && git commit -m "0011 step k"`.

0. Setup: `git fetch origin phase/0 && git checkout -b task/0011-secret-scanning origin/phase/0 2>&1 | tail -3`. Then install gitleaks for local use (no repo file changes):

   ```bash
   mkdir -p /tmp/gl && curl -sSfL -o /tmp/gl/gl.tgz https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz && echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  /tmp/gl/gl.tgz" | sha256sum -c - && tar -xzf /tmp/gl/gl.tgz -C /tmp/gl gitleaks && /tmp/gl/gitleaks version 2>&1 | tail -3
   ```
   Expected: `/tmp/gl/gl.tgz: OK` and `8.30.1`. In every later command, prefix `PATH=/tmp/gl:$PATH`.

1. Create `.gitleaks.toml` with exactly this content:

   ```toml
   # Shoebox secret scanning (M12 §4.13). gitleaks 8.30.1, owner-approved (decisions 2026-10-18).
   title = "Shoebox gitleaks config"

   [extend]
   useDefault = true

   [[rules]]
   id = "supabase-secret-key"
   description = "Supabase secret API key (sb_secret_...)"
   regex = '''\bsb_secret_[A-Za-z0-9_-]{20,}'''
   keywords = ["sb_secret_"]

   [[rules]]
   id = "supabase-service-role-key"
   description = "Value assigned to SUPABASE_SERVICE_ROLE_KEY"
   regex = '''SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']?([A-Za-z0-9._-]{20,})'''
   secretGroup = 1
   keywords = ["supabase_service_role_key"]

   [[allowlists]]
   description = "Supabase CLI local-dev demo keys (public, issuer supabase-demo)"
   regexTarget = "match"
   regexes = ['''eyJpc3MiOiJzdXBhYmFzZS1kZW1vIi''']

   [[allowlists]]
   description = "Obviously fake HMAC test secrets (brief 0009 tests)"
   regexTarget = "match"
   regexes = ['''-secret-of-at-least-32-characters-''']
   ```
   Command: `PATH=/tmp/gl:$PATH gitleaks git --no-banner --redact --config .gitleaks.toml . 2>&1 | tail -3`
   Expected: last line `no leaks found` (the whole history is clean).

2. Create `scripts/gitleaks_selftest.sh` with exactly this content, then `chmod +x scripts/gitleaks_selftest.sh`:

   ```bash
   #!/usr/bin/env bash
   # Self-test for .gitleaks.toml: a commit adding a fake Supabase service key must fail the scan.
   # The fake key is built at run time, so no secret-looking value is committed to the repository.
   set -euo pipefail
   config="$(cd "$(dirname "$0")/.." && pwd)/.gitleaks.toml"
   work="$(mktemp -d)"
   trap 'rm -rf "$work"' EXIT
   b64() { printf '%s' "$1" | base64 | tr -d '=\n' | tr '/+' '_-'; }
   header="$(b64 '{"alg":"HS256","typ":"JWT"}')"
   payload="$(b64 '{"iss":"shoebox-fake-test","role":"service_role","exp":1999999999}')"
   signature="$(b64 'obviously-fake-signature-for-the-gitleaks-self-test')"
   git -C "$work" init -q
   git -C "$work" config user.email selftest@example.invalid
   git -C "$work" config user.name selftest
   printf 'SUPABASE_SERVICE_ROLE_KEY=%s.%s.%s\n' "$header" "$payload" "$signature" > "$work/.env.local"
   git -C "$work" add .env.local
   git -C "$work" commit -q -m 'add fake key'
   if gitleaks git --no-banner --redact --config "$config" "$work"; then
     echo 'SELFTEST FAIL: gitleaks did not flag the fake Supabase service key' >&2
     exit 1
   fi
   echo 'SELFTEST OK: fake Supabase service key was flagged'
   ```
   Command: `PATH=/tmp/gl:$PATH bash scripts/gitleaks_selftest.sh 2>&1 | tail -3`
   Expected: `leaks found: 2` then `SELFTEST OK: fake Supabase service key was flagged`.

3. Create `scripts/pre-commit-gitleaks.sh` with exactly this content, then `chmod +x scripts/pre-commit-gitleaks.sh`:

   ```bash
   #!/usr/bin/env bash
   # Optional local pre-commit hook: scans staged changes with gitleaks.
   # Install once: ln -s ../../scripts/pre-commit-gitleaks.sh .git/hooks/pre-commit
   set -euo pipefail
   root="$(git rev-parse --show-toplevel)"
   if ! command -v gitleaks >/dev/null 2>&1; then
     echo 'gitleaks is not installed; see the owner steps in docs/tasks/0011-secret-scanning.md' >&2
     exit 1
   fi
   exec gitleaks git --pre-commit --staged --no-banner --redact --config "$root/.gitleaks.toml" "$root"
   ```
   Command: `git add scripts/pre-commit-gitleaks.sh && PATH=/tmp/gl:$PATH bash scripts/pre-commit-gitleaks.sh 2>&1 | tail -2`
   Expected: `no leaks found`.

4. Edit `.github/workflows/ci.yml`. Anchor (from §2):

   ```yaml
         - name: Unit and ui tests with coverage gates
           run: pnpm test:unit

     context-lint:
   ```
   Replace it with (the `secrets` job goes between `unit` and `context-lint`; the checkout digest is the one already used in the file):

   ```yaml
         - name: Unit and ui tests with coverage gates
           run: pnpm test:unit

     secrets:
       runs-on: ubuntu-24.04
       timeout-minutes: 5
       env:
         GITLEAKS_VERSION: 8.30.1
         GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
       steps:
         - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
           with:
             persist-credentials: false
             fetch-depth: 0
         - name: Install gitleaks (checksum-pinned)
           run: |
             curl -sSfL -o "$RUNNER_TEMP/gitleaks.tgz" \
               "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
             echo "${GITLEAKS_SHA256}  $RUNNER_TEMP/gitleaks.tgz" | sha256sum -c -
             tar -xzf "$RUNNER_TEMP/gitleaks.tgz" -C "$RUNNER_TEMP" gitleaks
             echo "$RUNNER_TEMP" >> "$GITHUB_PATH"
         - name: No .env file is tracked
           run: |
             if git ls-files | grep -E '(^|/)\.env(\..+)?$' | grep -vE '(^|/)\.env\.example$'; then
               echo '::error::.env file committed; only .env.example (names only) is allowed'
               exit 1
             fi
         - name: Config self-test (a fake Supabase service key must be flagged)
           run: bash scripts/gitleaks_selftest.sh
         - name: gitleaks on the commits of this PR or push
           env:
             EVENT: ${{ github.event_name }}
             PR_BASE: ${{ github.event.pull_request.base.sha }}
             PR_HEAD: ${{ github.event.pull_request.head.sha }}
             PUSH_BEFORE: ${{ github.event.before }}
             SHA: ${{ github.sha }}
           run: |
             if [ "$EVENT" = pull_request ]; then
               range="$PR_BASE..$PR_HEAD"
             elif [ -n "$PUSH_BEFORE" ] && git cat-file -e "${PUSH_BEFORE}^{commit}" 2>/dev/null; then
               range="$PUSH_BEFORE..$SHA"
             else
               range="$SHA"
             fi
             gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--no-merges $range" .

     context-lint:
   ```
   Command: `python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); print(list(d['jobs']))" 2>&1 | tail -3`
   Expected: a list containing `'secrets'` directly before `'context-lint'` (other jobs unchanged).

5. Simulate the PR diff scan locally: `PATH=/tmp/gl:$PATH gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--no-merges origin/phase/0..HEAD" . 2>&1 | tail -3`
   Expected: `no leaks found`. No file changes, no commit.

## 5. Do not touch

`apps/`, `packages/`, `package.json`, `pnpm-lock.yaml`, `turbo.json`, `.github/actions/`, every other job in `ci.yml`, `.env.example`. Hard rules: 4 (never commit a real key or `.env`; the only fake key is generated at run time), 7 (no tool other than gitleaks; no hook manager), 8 (never push to `main`).

## 6. Commands

Test-map has no row for CI files; these are the checks:

- `PATH=/tmp/gl:$PATH bash scripts/gitleaks_selftest.sh 2>&1 | tail -3` → `SELFTEST OK …`
- `PATH=/tmp/gl:$PATH gitleaks git --no-banner --redact --config .gitleaks.toml . 2>&1 | tail -3` → `no leaks found`
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo yaml-ok 2>&1 | tail -3` → `yaml-ok`
- `pnpm lint 2>&1 | tail -5` → no errors
- `python3 scripts/context_lint.py 2>&1 | tail -8` → no errors (a warning that 0010 and 0011 both list `ci.yml` is expected)

## 7. Acceptance

- [ ] `ci.yml` has job `secrets` that installs gitleaks 8.30.1 with SHA-256 check and runs `gitleaks git` with `.gitleaks.toml` on the PR range (`base..head`) or push range.
- [ ] A fake Supabase service key fails the scan: `scripts/gitleaks_selftest.sh` prints `SELFTEST OK` locally, and CI runs it in the `secrets` job. A real failing PR can only be shown on GitHub: owner step 3 (optional).
- [ ] The job also fails when a `.env` file (other than `.env.example`) is tracked.
- [ ] The full history scans clean with `.gitleaks.toml`.
- [ ] Optional local hook documented in the report: `scripts/pre-commit-gitleaks.sh` (runs `gitleaks git --pre-commit --staged`, the 8.30 replacement for `gitleaks protect --staged`).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- the checksum check in step 0 fails (do not try another version);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0011-report.md` (600 tokens at most) and set `Status: review` in this brief. The report has:

1. The files changed (`git diff --stat origin/phase/0 2>&1 | tail -10`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left (copy the Owner steps below), including the local hook install line.

Commit `0011 report`, then `git push -u origin task/0011-secret-scanning 2>&1 | tail -5`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `.github/workflows/ci.yml` `secrets` job: range logic for push events (new branch → scans full history of `$SHA`; force push with a vanished `before` → same), checksum line, no secret used, `--redact` on.
- `.gitleaks.toml` allowlists: they must stay narrow (one public demo-key prefix, one fake test string). Any wider allowlist hides real leaks.
- The job does not block merges until the owner adds `secrets` as a required check (owner step 2).

## Owner steps

1. Nothing to set up for CI: the job needs no secret and no account.
2. After the PR is merged: GitHub → the repository → Settings → Branches (or Rules → Rulesets) → the rule for `main` and `phase/**` → Require status checks → add `secrets` → Save.
3. Optional proof: open a throwaway branch, add a file `leak.txt` with the line `SUPABASE_SERVICE_ROLE_KEY=` followed by any 40 random letters, open a PR to `phase/0`, see the `secrets` job turn red, then close the PR and delete the branch.
4. Optional local hook on your computer: install gitleaks 8.30.1 (`brew install gitleaks`, or download it from github.com/gitleaks/gitleaks/releases), then in the repo folder run `ln -s ../../scripts/pre-commit-gitleaks.sh .git/hooks/pre-commit`. Every `git commit` now scans the staged files first.
