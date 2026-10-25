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
