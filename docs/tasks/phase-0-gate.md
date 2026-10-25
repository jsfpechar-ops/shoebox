# Phase 0 gate list

Phase run on `phase/0` (from `main` at 01750cd). Orchestrator: Opus 5.5. The owner reads the HIGH-risk diffs below and merges `phase/0` → `main`.

## Merged tickets

| Ticket | Briefs | PR | Risk |
|---|---|---|---|
| P0-REPO-01 | 0001, 0001-cont-1, 0001-fix-1, 0001-fix-2, 0002 | [#6](https://github.com/jsfpechar-ops/leonoperations/pull/6), [#7](https://github.com/jsfpechar-ops/leonoperations/pull/7) | normal |
| P0-CI-01 | 0003 | [#8](https://github.com/jsfpechar-ops/leonoperations/pull/8) (green run [39113683442](https://github.com/jsfpechar-ops/leonoperations/actions/runs/39113683442)); broken-link proof [#9](https://github.com/jsfpechar-ops/leonoperations/pull/9) red on context-lint, closed | normal |
| P0-PLAT-01 | 0008 | [#10](https://github.com/jsfpechar-ops/leonoperations/pull/10) | normal |
| P0-PII-01 | 0011 | [#11](https://github.com/jsfpechar-ops/leonoperations/pull/11) (`secrets` job green, incl. self-test) | normal |
| P0-REPO-02 | 0010a, 0010b | [#12](https://github.com/jsfpechar-ops/leonoperations/pull/12), [#13](https://github.com/jsfpechar-ops/leonoperations/pull/13) (T-17: GritQL, see decisions) | normal |
| P0-PLAT-03 | 0009 | [#15](https://github.com/jsfpechar-ops/leonoperations/pull/15) | **HIGH** |
| P0-PII-02 | 0012a, 0012b | [#14](https://github.com/jsfpechar-ops/leonoperations/pull/14), [#16](https://github.com/jsfpechar-ops/leonoperations/pull/16) (`pii` job green) | normal |
| P0-DOM-03 | 0005 | [#17](https://github.com/jsfpechar-ops/leonoperations/pull/17) | normal |
| P0-I18N-01 | 0006, 0006-cont-1 | [#18](https://github.com/jsfpechar-ops/leonoperations/pull/18) | normal |
| P0-UI-01 | 0007 | [#19](https://github.com/jsfpechar-ops/leonoperations/pull/19) | normal |
| P0-DOM-01 | 0004 | [#20](https://github.com/jsfpechar-ops/leonoperations/pull/20) | **HIGH** |
| P0-TEST-01 | 0013 | [#21](https://github.com/jsfpechar-ops/leonoperations/pull/21) | normal |
| P0-DOM-02 | 0016 | [#23](https://github.com/jsfpechar-ops/leonoperations/pull/23) | **HIGH** |
| P0-DOM-04 | 0017a, 0017b, 0017c | [#24](https://github.com/jsfpechar-ops/leonoperations/pull/24), [#25](https://github.com/jsfpechar-ops/leonoperations/pull/25), [#27](https://github.com/jsfpechar-ops/leonoperations/pull/27) | **HIGH** |
| P0-TEST-02 | 0018a, 0018b | [#22](https://github.com/jsfpechar-ops/leonoperations/pull/22), [#30](https://github.com/jsfpechar-ops/leonoperations/pull/30) | normal |
| P0-UI-02 | 0015a, 0015b, 0015c, 0015c-fix-1 | [#28](https://github.com/jsfpechar-ops/leonoperations/pull/28), [#31](https://github.com/jsfpechar-ops/leonoperations/pull/31), [#37](https://github.com/jsfpechar-ops/leonoperations/pull/37) (axe a11y) | normal |
| P0-TEST-03 | 0019 | [#33](https://github.com/jsfpechar-ops/leonoperations/pull/33) | normal |
| P0-EVAL-01 | 0020 | [#35](https://github.com/jsfpechar-ops/leonoperations/pull/35) | normal |
| P0-DOM-05 | 0021 | [#34](https://github.com/jsfpechar-ops/leonoperations/pull/34) | **HIGH** |
| P0-DB-02 | 0022a, 0022b | [#36](https://github.com/jsfpechar-ops/leonoperations/pull/36) | **HIGH** |
| P0-DB-01 | 0014a, 0014b, 0014c, 0014c-fix-2 | [#26](https://github.com/jsfpechar-ops/leonoperations/pull/26), [#29](https://github.com/jsfpechar-ops/leonoperations/pull/29), [#38](https://github.com/jsfpechar-ops/leonoperations/pull/38) (Postgres 17) | **HIGH** |
| P0-PLAT-04a | 0026a | [#40](https://github.com/jsfpechar-ops/leonoperations/pull/40) | normal |
| P0-EVAL-02 | 0024a, 0024b | [#41](https://github.com/jsfpechar-ops/leonoperations/pull/41), [#45](https://github.com/jsfpechar-ops/leonoperations/pull/45) | normal |
| P0-UI-03a/b | 0023a, 0023b | [#42](https://github.com/jsfpechar-ops/leonoperations/pull/42), [#44](https://github.com/jsfpechar-ops/leonoperations/pull/44) | normal |
| P0-DB-03a | 0025a | [#46](https://github.com/jsfpechar-ops/leonoperations/pull/46) (RLS suite part a) | **HIGH** |
| P0-CI-02 | 0027, 0027-fix-1 | [#43](https://github.com/jsfpechar-ops/leonoperations/pull/43) (`db` job green) | **HIGH** |
| P0-UI-03c | 0023c | [#47](https://github.com/jsfpechar-ops/leonoperations/pull/47) (theme) |  |
| P0-DB-03b | 0025b | [#48](https://github.com/jsfpechar-ops/leonoperations/pull/48) (isolation + roles tests, tenant-SQL lint) |  |
| P0-PLAT-04b | 0026b | [#49](https://github.com/jsfpechar-ops/leonoperations/pull/49) (job registry, pg-boss 12.35.1) |  |
| P0-PLAT-04c | 0026c | [#51](https://github.com/jsfpechar-ops/leonoperations/pull/51) (health, heartbeat) |  |
| P0-UI-03d | 0023d | [#52](https://github.com/jsfpechar-ops/leonoperations/pull/52) (Playwright + axe e2e) |  |
| P0-DB-04 | 0028a, 0028b | [#54](https://github.com/jsfpechar-ops/leonoperations/pull/54) (partners + registries) | **HIGH** |
| P0-DB-05 | 0029a, 0029b | [#56](https://github.com/jsfpechar-ops/leonoperations/pull/56) (documents core) | **HIGH** |
| P0-AUTH-03a | 0031a | [#57](https://github.com/jsfpechar-ops/leonoperations/pull/57) (security headers, CSP) |  |
| P0-AUTH-01a | 0030a | [#58](https://github.com/jsfpechar-ops/leonoperations/pull/58) (auth foundation; supabase-js, zod) |  |
| P0-AUTH-01b | 0030b | [#59](https://github.com/jsfpechar-ops/leonoperations/pull/59) (login page /prihlaseni) |  |
| P0-AUTH-03b | 0031b | [#60](https://github.com/jsfpechar-ops/leonoperations/pull/60) (/api/health) |  |
| P0-AUTH-01c | 0030c | [#62](https://github.com/jsfpechar-ops/leonoperations/pull/62) (fake auth server, e2e setup) |  |
| P0-DB-06 | 0032a, 0032b | [#63](https://github.com/jsfpechar-ops/leonoperations/pull/63) (document detail tables) | **HIGH** |
| P0-AUTH-01d | 0030d | [#64](https://github.com/jsfpechar-ops/leonoperations/pull/64) (login guard, logout) | **HIGH** |
| P0-DB-07 | 0033a, 0033b | [#66](https://github.com/jsfpechar-ops/leonoperations/pull/66) (platform tables) | **HIGH** |

## HIGH-risk PRs (owner reads these files)

| Ticket | PR | Files to read |
|---|---|---|
| P0-DOM-02 rounding | [#23](https://github.com/jsfpechar-ops/leonoperations/pull/23) | `packages/domain/src/money/rounding.ts`, `packages/domain/test/rounding.test.ts` |
| P0-DOM-04a rules resolver | [#24](https://github.com/jsfpechar-ops/leonoperations/pull/24) | `packages/domain/src/rules/resolver.ts`, `segment.ts`, `test/rules-engine.test.ts` |
| P0-DOM-04 rules (law + keys) | [#25](https://github.com/jsfpechar-ops/leonoperations/pull/25), [#27](https://github.com/jsfpechar-ops/leonoperations/pull/27) | `packages/domain/src/rules/law.ts`, `keys.ts`, `product.ts` |
| P0-DB-01a DB enums | [#26](https://github.com/jsfpechar-ops/leonoperations/pull/26) | `packages/db/migrations/0001_enums.sql`, `packages/db/test/enums-parity.test.ts` |
| P0-DB-01b tenancy + RLS | [#29](https://github.com/jsfpechar-ops/leonoperations/pull/29) | `packages/db/migrations/0002_tenancy.sql`, `packages/db/test/migrations/tenancy.db.test.ts` |
| P0-DOM-05 seed rules 2025/2026 | [#34](https://github.com/jsfpechar-ops/leonoperations/pull/34) | `packages/domain/src/rules/cz/2025.ts`, `2026.ts`, `packages/domain/test/rules-values.test.ts` |
| P0-DB-02 `app_worker` + withTenant | [#36](https://github.com/jsfpechar-ops/leonoperations/pull/36) | `packages/db/migrations/0003_app_worker.sql`, `packages/db/src/tenant.ts`, `packages/db/test/with-tenant.db.test.ts` |
| P0-DB-03a RLS suite | [#46](https://github.com/jsfpechar-ops/leonoperations/pull/46) | `packages/db/src/rls-catalog.ts`, `packages/db/test/rls/helpers.ts`, `meta.db.test.ts`, `worker.db.test.ts` |
| P0-CI-02 CI db job | [#43](https://github.com/jsfpechar-ops/leonoperations/pull/43) | `.github/workflows/ci.yml` (`db` job, CI-only `app_worker` password) |
| P0-DB-04 partners | [#54](https://github.com/jsfpechar-ops/leonoperations/pull/54) | `packages/db/migrations/0004_*.sql`, `schema/partners.ts`, `partners.db.test.ts` |
| P0-DB-05 documents core | [#56](https://github.com/jsfpechar-ops/leonoperations/pull/56) | `packages/db/migrations/0005_*.sql`, `schema/documents.ts`, `documents-core.db.test.ts` |
| P0-DB-06 document details | [#63](https://github.com/jsfpechar-ops/leonoperations/pull/63) | `packages/db/migrations/0006_documents_detail.sql`, `test/rls/roles.db.test.ts`, `documents-detail.db.test.ts` |
| P0-AUTH-01d login guard | [#64](https://github.com/jsfpechar-ops/leonoperations/pull/64) | `apps/web/middleware.ts`, `supabase/config.toml`, `apps/web/e2e/auth.spec.ts` |
| P0-DB-07 platform tables | [#66](https://github.com/jsfpechar-ops/leonoperations/pull/66) | `packages/db/migrations/0007_platform.sql`, `src/rls-catalog.ts`, `test/rls/helpers.ts`, `platform.db.test.ts` |
| P0-DOM-01 Money | [#20](https://github.com/jsfpechar-ops/leonoperations/pull/20) | `packages/domain/src/money/money.ts`, `packages/domain/src/money/currency.ts`, `packages/domain/test/money.test.ts` |
| P0-PLAT-03 signed webhooks | [#15](https://github.com/jsfpechar-ops/leonoperations/pull/15) | `packages/platform/src/webhooks/webhook.ts`, `packages/platform/test/webhooks.test.ts` |

## In progress

- Briefs 0028a/b (P0-DB-04, migration 0004) and 0029a/b (P0-DB-05, migration 0005) written by Fable; executing 0028a first. Fable defaults to confirm at the gate: `app_worker` read on categories/fx_rates/bank_codes and read/write on registry_cache (05 §10.3 edit); vendor_profiles ships inside 0004; categories seed left to P0-DB-11.
- Briefs 0031a/b (P0-AUTH-03 headers, health) and 0030a–d (P0-AUTH-01 login, guard) written by Fable. Order 0031a → 0031b → 0030a → 0030b → 0030c → 0030d. 0030a waits on the owner for `@supabase/supabase-js` (peer of `@supabase/ssr`). Fable defaults to confirm at the gate: env names `APP_URL`, `CSP_REPORT_URI`, `SUPABASE_AUTH_EXTERNAL_GOOGLE/APPLE_SECRET`; route `/prihlaseni`, logout in the shell header (`TODO(P1-UI)`); auth cookies always `secure`; HIBP check is a dashboard owner step; `getUser()` per request.
- Merged since the last update: 0025b (#48), 0026b (#49), 0026c (#51), 0023c (#47), 0023d (#52).
- Briefs 0032a/b (P0-DB-06 document detail tables, migration 0006) written by Fable. Defaults to confirm at the gate: accountant may only change answer columns on review_questions (extra update policy + trigger, 42501 otherwise); extraction_runs read-only for users; Drizzle module `schema/document-details.ts`.
- Briefs 0033a/b (P0-DB-07 platform tables, migration 0007) by Fable. Defaults to confirm at the gate: privacy_requests owner-only; app_worker reads rules_overrides only; `app.rate_limit_hit()` for service_role and app_worker; app_worker gets the audit_log id sequence.
- Briefs 0036a/b (P0-AUTH-02 org context, role guard, org switcher) by Fable. Defaults to confirm at the gate: code in `apps/web/src/auth/` (not `lib/`); active org in the `shoebox_org` cookie (no migration); memberships read via PostgREST under the user session; native-select switcher landing on `/inbox`; staff role out of scope. Owner step: run `org.spec.ts` once against local Supabase.

## Resume (next session)

1. Read AGENTS.md, status, this file; `git log --oneline -20 origin/phase/0`.
2. Queue, briefs already written and committed (`Status: todo`). One executor at a time when its §3 lists `pnpm-lock.yaml`; no two executors on the same file:
   - 0014b → 0014c (DB tenancy + RLS, Supabase CLI; HIGH; #26 is merged: start each from a fresh branch off phase/0 unless the brief says otherwise).
   - 0015a → 0015b → 0015c (UI primitives, status components, a11y; deps approved).
   - 0018b (fake registries, branch `task/0018-registries`), 0019 (LLM cassette), 0020 (golden labels): all edit `packages/testkit/src/index.ts`, run one after another.
3. After those: write briefs for newly unblocked tickets (P0-DOM-05 seed rules HIGH/Fable, P0-DB-02/03…, P0-UI-03, P0-EVAL-02, P0-CI-02/03, P0-PLAT-02/04, P0-AUTH-*), per backlog `Depends on`.
4. Executor prompt (Haiku, `isolation: worktree`): setup `git fetch origin phase/0 && git checkout -b <branch> origin/phase/0 && pnpm install --frozen-lockfile`; read AGENTS.md, executor.md, the brief; one Write per file; never edit brief tests; filter tests with `pnpm --filter <pkg> test <file>` (not `-- <file>`); `git checkout -- AGENTS.md` if turbo touches it; no cloud sessions/MCP session tools; commit each step with the Co-Authored-By/Claude-Session trailers; push the branch; no PR (orchestrator opens and merges).
5. Writer prompt: Opus for normal tickets, Fable (`model: fable`) for HIGH and Fable-listed; ≤ 8 files and ≤ 10 steps per brief, full test files, verify in a scratch copy, write the file early. Keep fix/continuation briefs OFF phase/0 (put them on the task branch) to avoid add/add conflicts.
6. Review: compare §3 with `git diff --stat origin/phase/0...origin/<branch>`; for HIGH, check the test file is byte-identical to the brief and read the full implementation; open the PR, subscribe, merge on green CI.

## Stopped tickets

None.

## Process notes

- P0-REPO-01 brief 0001 took 4 executor sessions (limit is 3). Sessions 3 and 4 fixed brief bugs, not executor failures: the per-package Vitest config was missing, and turbo's agent guidance appended a block to `AGENTS.md` (now `agentGuidance: false`). Later briefs are capped at 8 files and 10 steps.
- The 4 Biome ignore-pattern warnings were fixed in 0010b.
- Container restarts lose running subagents and their reports: check `git log origin/<branch>` and the branch's report file instead.
- Test-map: `pnpm --filter <pkg> test -- <file>` runs every test file (pnpm forwards `--` to vitest); `test <file>` filters. Fix the test-map rows in a context brief.

## Open questions

All answered by the owner on 2026-10-18 (recommended options; see decisions): Vitest 4 projects split recorded in M12 §4.1; TypeScript 5.9.3 / Vitest 4.1 pins kept; `@vitest/coverage-v8` approved; SES secret names and logger env names kept; golden-set and logger-test PII hits are synthetic; i18n keeps the small formatter for now.

UI dependencies for P0-UI-02: approved by the owner 2026-10-18 (decisions [deps]).

Infrastructure: decided 2026-10-18 (keep current stack, Fable-reviewed). LLM: owner switched to the Anthropic Claude API directly (EU-only waived for the LLM); see decisions [stack], ADR-011, rule 4.

Owner steps added: sign Anthropic DPA (SCCs/DPF) and request zero data retention before real documents are processed (Phase 1); list Anthropic as a sub-processor (22 L-03).

Defaults applied 2026-10-18, owner may veto: `pnpm lint` (CI lint job) also runs `check:tenant-sql` (0025b); a function with a `TenantTx`/`ServiceTx` parameter counts as scoped (0025b); `ops.heartbeat` is the M12 §4.2 cron tick (0026c); `@tailwindcss/postcss` under "Tailwind 4" and Playwright 1.56.1 (0023). 0027: `supabase db diff` replaced by migrate-twice no-op + ledger count = journal + `drizzle-kit check` (diff would always print the full schema since migrations are Drizzle's); a schema-drift check is a follow-up ticket; `check:tenant-sql` joins the db job with 0025b. Open card: pg-boss 12.35.1 (+ `pg` 8) for 0026b.

## Owner steps

1. Make the CI checks `secrets`, `pii`, `lint`, `typecheck`, `unit`, `depcruise`, `context-lint` required for `main` and `phase/**` (GitHub → Settings → Branches → Add rule → Require status checks).
2. Optional: link the local secret scan: `ln -s ../../scripts/pre-commit-gitleaks.sh .git/hooks/pre-commit` (needs gitleaks installed locally).
3. Before the worker ships (after 0022a): on Supabase run `alter role app_worker password '<generated>'` and store it as secret `WORKER_DATABASE_URL` (default name; `DATABASE_URL` stays the migration/service role).
4. Delete the leftover test branch `test/0003-broken-link` on GitHub (Branches page → trash icon); the session could not delete it.
