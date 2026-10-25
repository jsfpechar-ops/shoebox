# 0044c report: passkey sign-in on the login page

Status: review

## Files changed (git diff --stat, before this commit)

```
apps/web/app/(auth)/prihlaseni/page.tsx | 2 ++
apps/web/e2e/fake-auth-server.mjs       | edit (passkey endpoints, header comment)
apps/web/src/auth/passkey-actions.ts    | 47 ++++++++++++++++++++++++++++++++++++
packages/i18n/messages/cs.json          | 3 ++
packages/i18n/messages/en.json          | 3 ++
apps/web/e2e/passkey.spec.ts            | new
apps/web/src/auth/passkey-sign-in.tsx   | new
```

## Commands (last lines of output)

1. `pnpm --filter @shoebox/web test`: `Test Files 11 passed (11)`, `Tests 96 passed (96)`.
2. `pnpm --filter @shoebox/web typecheck`: clean, no errors.
3. `pnpm --filter @shoebox/i18n test`: `Test Files 3 passed (3)`, `Tests 24 passed (24)`.
4. `pnpm exec biome check apps/web packages/i18n`: `Checked 73 files`, `No fixes applied` (after one formatting fix, see Deviations).
5. `python3 scripts/context_lint.py`: `context lint: OK` (WARN lines only: packages/domain/rules not created yet; 18 commits since status.md update).
6. Playwright (setup, desktop-chromium, mobile-chromium): `67 passed (58.9s)`. No skips, no failures.

## §7 Acceptance

- [x] All §6 commands pass.
- [x] 375 px screenshot of `/prihlaseni` with the passkey button: `/tmp/claude-0/-home-user-leonoperations/e092e891-17fc-53b1-8e6b-0b5f58326e96/scratchpad/0044c-prihlaseni-375.png` (kept out of the repo, since §3 lists no image file).

## Deviations

- Step 4 fake server: `biome check --write` reformatted the new `passkeyRoute` regex line (formatting only, same file).
- Step 1: `touchLastSeen` import added directly after the `../supabase/server` import, as the brief says.
- Commit: all steps and this report in one local commit (not one per step). No push.
- Commit trailer: the brief and the session note disagree on the Co-Authored-By model line. The commit uses the trailer given in the executor instruction (Opus 5.5).

## Questions

- None blocking.

## Owner steps left

- Review and merge the branch into `phase/0` after review (this is a local commit only, not pushed).
