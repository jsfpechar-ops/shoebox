# 0415 report

Status: blocked

Files changed (steps 1-3, commit 0086e50):
- packages/i18n/messages/en.json (7 `settings.vendors.*` keys)
- apps/web/src/settings/vendor-memory-data.ts (new)
- apps/web/test/vendor-memory-data.test.ts (new)
- apps/web/src/settings/forget-vendor-button.tsx (new)

Commands:
- `pnpm --filter @shoebox/web test -- vendor-memory-data`: 41 files, 254 tests passed. The filter did not narrow the run, so the full web suite ran.
- `pnpm --filter @shoebox/i18n test`: 3 files, 24 tests passed.
- Not run: web typecheck, biome (both are step 5, after step 4).

Stopped at step 4: the anchor "Who has access" is not in `apps/web/app/(app)/nastaveni/page.tsx`. The closest card is the team card (`settings.team.title`, the last card). Step 4 and step 5 are not done.

Owner or orchestrator to decide: where the card goes (before the team card, or elsewhere), then rerun step 4 and step 5.
