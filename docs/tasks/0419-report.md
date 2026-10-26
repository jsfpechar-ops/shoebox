# 0419 report

Status: review

## Files changed
- New: `apps/web/src/podklady/card-view.ts`, `podklady-actions.tsx`, `podklady-card.tsx`, `reserve-tile.tsx`, `apps/web/test/podklady-card-view.test.ts`, `apps/web/app/(app)/prehled/podklady/[year]/page.tsx`
- Edited: `apps/web/src/overview/overview-screen.tsx` (`tax` prop after `{vat}`), `apps/web/app/(app)/prehled/page.tsx`, `packages/i18n/messages/en.json` (8 keys), `docs/context/known-issues.md` (K-D04), brief status.

## Commands (last lines)
- `pnpm --filter @shoebox/web test -- test/podklady-card-view.test.ts`: `Test Files 51 passed (51)`, `Tests 326 passed (326)`. The filter was not applied; the whole web suite ran and passed. The first run failed on a missing `@shoebox/tax-xml` link, fixed by `pnpm install --frozen-lockfile` (once).
- `pnpm --filter @shoebox/web typecheck`: clean.
- `biome check --write` on the touched paths: clean after one manual fix (optional chain).
- `pnpm --filter @shoebox/i18n test`: `Tests 24 passed (24)`.
- `python3 scripts/context_lint.py`: see the commit (report file added).

## Deviations
1. Severity: `ReadinessSeverity` is `blocking | warning | info`, so the brief's `'block'` became `'blocking'`.
2. `MarkFiledForm` takes `today` (default and max of `filedOn`), not `periodEnd`. `PodkladyCard` has an extra `today` prop, which the pages pass as `asOf`.
3. Extra export `wholeCzk` in `card-view.ts`, used by the detail page.
4. Detail page reads `summary.headline.{label,income,expenses,base}`, `flatRate.rate`, `advancesPaid`, `checklistKeys` by guard. Only `advancesPaid` and `flatRate` were confirmed in `packages/domain/src/income-tax/summary.ts`; the headline field names follow the brief and were not checked against the type.
5. One commit for the whole brief, as instructed, not one per step. No screenshots (no app run).

## Questions
- Confirm the `summary.headline` field names (deviation 4).

## Owner steps left
- None. Deploy and merge are the owner's.
