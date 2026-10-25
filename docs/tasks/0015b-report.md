# 0015b report: StatusBadge, MoneyText, LegalDateText

Status: review. Base: ed0f917 (phase/0 at fetch). Branch: task/0015b-ui-status.

## Files (git diff --stat ed0f917 HEAD)

8 files, 440 insertions:
- packages/i18n/messages/cs.json, en.json (13 status.badge.* keys each)
- packages/ui/src/components/format-text.tsx (new)
- packages/ui/src/components/status-badge.tsx (new)
- packages/ui/src/index.ts (2 export lines)
- packages/ui/test/money-text.test.tsx, legal-date.test.tsx, status-badge.test.tsx (new)

## Commands (last lines)

- `pnpm --filter @shoebox/i18n test`: Test Files 3 passed, Tests 24 passed.
- `pnpm --filter @shoebox/ui test money-text legal-date`: Tests 9 passed.
- `pnpm --filter @shoebox/ui test status-badge`: Tests 26 passed.
- `pnpm --filter @shoebox/ui test` (step 8, full UI package): Test Files 8 passed, Tests 61 passed.
- `pnpm --filter @shoebox/ui typecheck`: tsc clean, no error TS.
- `pnpm lint`: exit 0.

## §7 acceptance

- [x] status-badge.test.tsx: every M11 §4 row (26 cases).
- [x] money-text.test.tsx: 1 234,56 Kč with NBSP, num class.
- [x] legal-date.test.tsx: 18. 10. 2026.
- [x] i18n catalog test passes with 13 new keys in cs and en.

## Deviations

1. Commit granularity: steps 1 and 2 were first committed together; fixed by splitting into two commits before continuing. Each step now has its own commit.
2. money-text.test.tsx: the written NBSP constant was a plain space (transcription error). Changed to `const NBSP = ' ';` (brief intent: NBSP). No expectation changed; no source change needed.
3. Step 8 `biome check --write` reformatted packages/ui/test/status-badge.test.tsx (formatting only).
4. The base ref origin/phase/0 has since moved to 85c3f6e, so `git diff --stat origin/phase/0` shows unrelated db deletions. Use the base ed0f917 for this branch's diff.

## Questions

None.

## Owner steps

None.
