# 0062 report: onboarding backend

Status: review

## Files changed
- `apps/web/package.json` (+1, `@shoebox/registries` workspace dep), `pnpm-lock.yaml` (+3, workspace link only)
- `apps/web/app/(app)/layout.tsx` (+4, gate call before the theme cookie read)
- new: `apps/web/src/onboarding/{prefill,schema,gate,actions}.ts`
- new: `apps/web/test/onboarding-{prefill,schema,gate}.test.ts`
- `docs/tasks/0062-onboarding-backend.md` (Status: review), this report

## Commands (last lines)
- `pnpm --filter @shoebox/web test -- onboarding`: the filter did not narrow the run; all 13 files ran. `Tests 112 passed (112)`. Covers the 3 new files.
- `pnpm --filter @shoebox/web test`: `Test Files 13 passed (13)`, `Tests 112 passed (112)`.
- `pnpm --filter @shoebox/web typecheck`: exit 0, no errors.
- `pnpm exec biome ci apps/web`: `Checked 63 files`, no errors (exit 0).

## §7 acceptance
- [x] §6 passes
- [x] `git diff --stat` lists only §3 files plus the report

## [verify] finding (§4 step 2)
- `vatGuess` uses `dphAktivni`, which `packages/registries/src/ares.ts:62` sets from `stavZdrojeDph === 'AKTIVNI'`.
- Live ARES REST record for 27082440 (Alza, payer): `stavZdrojeDph: "AKTIVNI"`. No separate identified-person field appears in the record.
- The developer-info page (`/stranky/vyvojar-info`) is a JS shell with no field documentation, so it could not be checked.
- Result: inconclusive for identified persons. Behaviour unchanged.

## Deviations
- `schema.ts`: the `pausalni_dan` rule uses `vat.startsWith('platce')` as "payer", so `identifikovana_osoba` passes. The brief's "not payer" was read as `vat_status` not `platce`.
- `schema.ts`: `ico` is space-stripped before `isValidIco`. `dic` and `zip` are normalised inside the schema, so the tests can pass raw input.
- `actions.ts`: `baseUrl` is passed only when `SHOEBOX_ARES_BASE_URL` is set, because of `exactOptionalPropertyTypes`.
- `actions.ts`: the RPC call is in try/catch and `redirect('/inbox')` runs outside it, so the redirect is not swallowed.
- Biome auto-formatted my own new files and the new layout lines (`biome check --write`). No other file was touched.
- `packages/db/migrations/meta/_journal.json` is modified in the tree by the 0061 executor. It is not mine and was not committed.

## Questions
- None.

## Owner steps left
- None now. Later on Render: `SHOEBOX_INBOUND_DOMAIN`, once the domain is chosen (`TODO(decision-inbound-domain)`).
