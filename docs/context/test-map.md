# Test map

Run only the row for the area you changed, from the repo root, always ending `2>&1 | tail -30`. CI runs everything; the full suite locally only when the owner asks in the current chat. Add the test file you wrote or changed.

| Changed | Run |
|---|---|
| `packages/domain` (Money, rules, VAT and KH routing, ledgers) | `pnpm --filter @shoebox/domain test -- <file>` and `pnpm --filter @shoebox/domain typecheck` |
| `packages/domain/rules` (a law-driven value) | the row above plus `pnpm --filter @shoebox/domain test -- rules` |
| `packages/db` (schema, migration, RLS) | `pnpm --filter @shoebox/db test -- migrations rls` (needs `pnpm db:start`) |
| `packages/extraction` | `pnpm --filter @shoebox/extraction test -- <file>` and `pnpm eval --quick` |
| `packages/validation` | `pnpm --filter @shoebox/validation test -- <file>` and `pnpm eval --quick` |
| `packages/pipeline`, `apps/worker` | `pnpm --filter @shoebox/pipeline test -- <file>` and `pnpm --filter @shoebox/worker test -- <file>` |
| `packages/registries` | `pnpm --filter @shoebox/registries test -- <file>` (fakes only) |
| `packages/bank` | `pnpm --filter @shoebox/bank test -- <file>` |
| `packages/tax-xml` | `pnpm --filter @shoebox/tax-xml test -- <file>` (golden XML + XSD validation) |
| `packages/exports` | `pnpm --filter @shoebox/exports test -- <file>` |
| `packages/ui` | `pnpm --filter @shoebox/ui test -- <file>` and `pnpm --filter @shoebox/ui test:a11y` |
| `packages/i18n` (copy) | `pnpm --filter @shoebox/i18n test` (missing keys, ICU syntax) |
| `apps/web` (a screen) | `pnpm --filter @shoebox/web test -- <file>` and `pnpm --filter @shoebox/web e2e -- <spec>` (0 skipped, axe checks on) |
| `apps/email-worker` | `pnpm --filter @shoebox/email-worker test -- <file>` |
| `testdata/` (golden set or labels) | `pnpm eval --quick` |
| Agent context (`AGENTS.md`, `docs/context/`, `docs/tasks/`) | `python3 scripts/context_lint.py` |
| `scripts/` (Python guards) | `python3 scripts/test/test_pii_guard.py` and `python3 scripts/pii_guard.py --all apps packages scripts testdata` |
| `scripts/*.ts`, `scripts/test/*.test.ts` (TypeScript guards, e.g. migration-lint) | `pnpm exec vitest run --project unit scripts/test/<file>` and `pnpm exec biome ci scripts` |
| A package with no row | `pnpm --filter @shoebox/<pkg> test -- <file>` |

`pnpm eval --quick` runs the golden set with the faked LLM (seconds, free). `pnpm eval` (full, live LLM) only when the brief says so.

A row missing or wrong: the orchestrator fixes this table in the same brief. Until the Phase 0 scaffold exists (briefs 0001–0003), only the last-but-one row applies.
