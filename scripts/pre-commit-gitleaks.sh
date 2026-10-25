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
