# 0117 report

Status: review

## 1. Files changed (`git diff --stat 44d1e64 HEAD`)
- packages/domain/src/rules/cz/2025.ts, 2026.ts: `bank.authority_accounts` seed (prefixes 705, 2866; account lists empty), FU_ACCOUNTS const
- packages/domain/test/rules-values.test.ts: key list and counts
- packages/domain/test/rules-authority-accounts.test.ts (new)
- packages/db/src/match-store.ts (new), packages/db/src/index.ts (export line)
- packages/db/test/match-store.db.test.ts (new)
- docs/tasks/0117-report.md (this file)

## 2. Commands (last lines)
- `pnpm --filter @shoebox/domain typecheck`: no errors (exit 0)
- `pnpm --filter @shoebox/domain exec vitest run test/rules-values.test.ts test/rules-authority-accounts.test.ts test/rules-law.test.ts`: `Test Files 3 passed (3)`, `Tests 69 passed (69)`
- `pnpm biome check` on domain files: `Checked 4 files ... No fixes applied.` (0 errors)
- `pnpm --filter @shoebox/db typecheck`: no errors (exit 0)
- `pnpm biome check` on db files: 0 errors
- `pnpm --filter @shoebox/db exec vitest run test/match-store.db.test.ts`: `Test Files 1 skipped (1)`, `Tests 4 skipped (4)`. No DATABASE_URL and no Postgres on localhost:5432, so the DB test did not run. CI must run it.

## 3. §7 acceptance
- [x] rules-authority-accounts and rules-values pass
- [x] Only 705 and 2866 seeded; all accounts lists empty; source and verified_at present
- [ ] match-store.db.test.ts: skipped (no local database), see above
- [x] `grep -c org_id packages/db/src/match-store.ts` = 15 (≥12)

## 4. Deviations
- rules-values counts: the brief said 18/19/18. The repo had 23/24/23, so I added +1 to each (24/25/24). Intent kept.
- `tx.execute<T>` needs `Record<string, unknown>`. Five calls use `T & Record<string, unknown>`. Exported interfaces are unchanged.
- Drizzle expands a JS array inside a `sql` template into `($1, $2)`, which breaks `= any(${ids}::uuid[])`. Arrays go through `sql.param([...])`.
- The brief gave no SQL for `loadOwnAccounts`. I wrote a plain org-scoped select ordered by name, id.
- Added `org_id` to the context queries that the brief left unscoped (aliases, rejected suggestions, VS history), per rule 3.
- Non-null assertions in the two tests replaced with a `must()` helper. Assertions unchanged.
- `[verify]` (FÚ accounts page, §4.7.4): not verified, no network. Owner to confirm the page and prefixes 705 and 2866.
- No PR opened: the orchestrator said do not push.

## 5. Questions
- Should the DB test run in CI against a Postgres service? It is skipped locally.

## 6. Owner steps left
1. Open https://financnisprava.gov.cz, find "Bankovní účty finančních úřadů", and confirm 705 = DPH and 2866 = paušální daň. Send the income-tax prefix (721) to the orchestrator.
2. Push branch claude/project-thread-236iho and open the PR against phase/0.
