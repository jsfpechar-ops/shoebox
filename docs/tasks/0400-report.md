# 0400 report

Status: review

## Files changed
- packages/i18n/messages/en.json (name Sysel, proto.page.title, 3 manifest keys)
- packages/i18n/messages/cs.json (shell.app.name and proto.page.title)
- apps/web/app/manifest.ts (new), apps/web/app/icon.svg (new)
- apps/web/src/auth/guard.ts, apps/web/test/guard.test.ts (2 public paths)
- apps/web/test/manifest.test.ts (new)

## Commands (last lines)
- i18n test: 24 passed (24)
- web test -- guard: 161 passed (161)
- web test -- manifest: 162 passed (162), all web files
- web typecheck: no output (0 errors)
- grep "Shoebox" in messages and apps/web/app: no hits
- biome check apps/web packages/i18n: 1 error, 1 warning (see Deviations)

## Deviations
- Commits: steps 2 and 3 (icon and manifest.ts) are one commit "0400 step 2". Steps 4, 5, 6 committed as "0400 step 4/5/6". Step 3 has no own commit.
- cs.json: step 1 also changed proto.page.title (brief §3 mentions shell.app.name only). Applied the step text.
- Biome lint error left open: apps/web/app/icon.svg:1 lint/a11y/noSvgWithoutTitle. Brief says the file content is exact, so no <title> was added. Owner or orchestrator to decide (add a title element).
- Biome warning pre-existing, not from this brief: apps/web/app/(app)/inbox/[id]/page.tsx:126 noImgElement. Not touched.
- guard.test.ts line 63 loop (existing list) left unchanged, as the brief said.
- Biome --write reflowed the PUBLIC_PATHS lines in guard.ts and guard.test.ts (formatting only).

## Questions
- Keep the icon.svg lint error open, or add `<title>Sysel</title>`?

## Owner steps left
- None for this brief. No push, no PR (executor rules; orchestrator opens the PR).
