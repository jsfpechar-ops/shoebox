# 0104 report

Status: blocked

## Files changed (steps 1 to 4)

- apps/web/test/inbound-email-webhook.test.ts (new, from brief §4 step 1)
- apps/web/src/inbound-email/webhook.ts (new: parseInboundAddress, messageIdOf, handleInboundEmail)
- apps/web/src/documents/enqueue.ts (edit: emailReceivedJob import, enqueueEmailReceived appended)
- apps/web/app/api/inbound-email/route.ts (new, as given; blob options match apps/worker register.ts)
- docs/tasks/0104-inbound-email-webhook.md (Status line only)
- docs/tasks/0104-report.md (this file)

## Commands

- `pnpm --filter @shoebox/web exec vitest run test/inbound-email-webhook.test.ts 2>&1 | tail -30`: 11 passed (11).
- `pnpm --filter @shoebox/web exec vitest run test/guard.test.ts`: not run (step 5 stopped).
- `pnpm --filter @shoebox/web typecheck` and `pnpm exec biome check apps/web`: not run.

## Section 7 checklist

- [ ] Tests pass (webhook file only; guard not run)
- [ ] CI green (not checked)
- [ ] Diff limited to §3 files (step 5 files not yet changed)

## Deviations

Done: steps 1 to 4. Left: step 5 (guard.ts and guard.test.ts).

## Questions

- Step 5 stop: the anchor `export const PUBLIC_PATHS = [LOGIN_PATH, '/auth/callback', '/api/health'] as const;` is not in apps/web/src/auth/guard.ts. PUBLIC_PATHS is now a multi-line array (line 4, `/api/health` at line 7). The test in apps/web/test/guard.test.ts line 11 is also multi-line (`expect(PUBLIC_PATHS).toEqual([`). Owner or orchestrator should re-brief step 5 with the current text, or confirm that `'/api/inbound-email'` goes after `'/api/health'` in both files.
- Brief status: §8 says write the report as blocked, so Status is blocked, not review.

## Owner steps left

- Decide step 5 (above). After that, run the guard test and typecheck.
- Set SHOEBOX_INBOUND_WEBHOOK_SECRET, DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the web app env (secrets, owner only).
