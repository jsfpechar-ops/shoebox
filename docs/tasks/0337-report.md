# 0337 report

Status: review

## Files changed
- packages/pipeline/src/jobs.ts: `opsDriftMonitorsJob` (`ops.drift_monitors`, cron `15 4 * * *`, retryLimit 0)
- apps/worker/src/jobs/ops/drift-monitors.ts (new): parser, detector, in-memory state, handler, register
- apps/worker/src/main.ts: import + `registerDriftMonitors(registry, process.env, logger)`
- apps/worker/package.json: `@shoebox/tax-xml` workspace link; pnpm-lock.yaml updated
- apps/worker/test/drift-monitors.test.ts (new, brief verbatim, biome formatting only)
- docs/runbooks/epo-version-bump.md (new, 22 lines)

## Checks
- `pnpm --filter @shoebox/pipeline typecheck`: clean
- `pnpm --filter @shoebox/worker typecheck`: clean
- `pnpm exec vitest run --root apps/worker test/drift-monitors.test.ts`: 3 passed
- biome check --write on each changed file: clean (formatting only)

## Deviations
- Worker had no dependency on @shoebox/tax-xml; added the workspace link (executor rule allows it).
- `epo.forms` is an untyped record in the rules schema; cast to `typeof CZ_EPO_FORMS` (same as domain test).
- parseEpoVersions tries every occurrence of a code until a version appears within 400 chars.
- A form missing from a parsed list page produces no version finding (brief silent).
- Biome info `useTemplate` in the test left as the brief gave it.

## Open
- [verify] real list-page markup: not fetched (no network in session). Parser tolerance is unverified.
- Alert channel is log only; persisted dedupe is TODO(decision-drift-state).

## Owner steps
1. Add to docs/context/decisions.md: "2026-10-26 ops.drift_monitors runs nightly 04:15 (log alert; persisted dedupe TODO)".
2. Once a live list page is recorded, check the parser against it and update 22 T-02.
