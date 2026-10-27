# 0610: Rounding within 1 Kč is normal, not an issue

Status: review
Ticket: REAL-DATA (owner test 2026-10-27, Josef) | Depends on: none | Base commit: d5c65a1 | Branch: claude/project-thread-w656wo | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Czech invoices round the total to whole crowns (haléřové vyrovnání). A difference of up to ±1.00 between the printed total and net + VAT is normal. It must never show "Please check" on a field, never appear under "Needs your attention", and never send a document to review. It shows at most one quiet line ("Total rounded by −0,40 Kč, as usual.") and the difference is stored in `documents.rounding`.

Real case: LAMOVA invoice, net 13 654,88 + VAT 2 867,52 = 16 522,40, printed total 16 522,00. Today: three "Please check" marks plus two attention lines.

## 2. Context

- `packages/validation/src/proto-checks/checks.ts`: `checkTotalsMath` (±1.00 → `warn`), `checkVat` / vat_sum and `checkRecapVsTotals` (use `roundingLineAllowed`, result `warn`). Severities pass/warn/fail map to stored pass/warning/blocking in `proto-checks/stored.ts`; DB `severity` enum also has `info`.
- Field marks: `apps/web/src/documents/trust.ts` and `detail-data.ts` turn warnings with `fieldKeys` into "Please check".
- `documents.rounding numeric(15,2) default 0` exists (`packages/db/src/schema/documents.ts:162`) but nothing writes it. Reading write: `apps/worker/src/doc-extract/rows.ts` (`DocumentPatch`) → `packages/db/src/document-reading.ts`. User fixes: `apps/web/src/documents/correction.ts` `planCorrection`.
- Money is `Money` from `@shoebox/domain`, never a float (hard rule 1). The 1.00 limit should come from rules if a rounding key exists in `packages/domain/src/rules` (grep `rounding`); otherwise keep the existing literal and leave `TODO(rules)`.

## 3. Files

As named in §2 and §4.

## 4. Steps

1. In `checks.ts`, a within-tolerance difference (non-zero, |diff| ≤ 1.00 for totals_math; the existing `roundingLineAllowed` rule for vat_sum and recap) returns a new severity `info` (add it to `ProtoCheckSeverity`) with new keys `proto.check.totals_math.rounded`, `proto.check.vat_sum.rounded`, `proto.check.recap.rounded` (check the RECAP_KEYS shape) and `fieldKeys` empty. `stored.ts` maps `info` → `info`. Only one rounding line should show: when totals_math is `info`, vat_sum/recap rounding results for the same diff may be dropped.
2. Everything that reads severities (`renderProtoChecks`, `statusAfterRead`, `detail-data.ts`, `trust.ts`, `correction.ts`, `imports.ts`, `scripts/proto`) must treat `info` as non-blocking and never as "Please check". On the document page, `info` rows show as a small muted note under the totals, not under "Needs your attention".
3. Write `documents.rounding = gross − (net + vat)` (two decimals, Money) at read time and after a user fix, only when that diff is within tolerance; else 0.
4. Copy in `packages/i18n/messages/en.json` only: "Total rounded by {diff} Kč, as usual on Czech invoices."
5. Tests: update `packages/validation/test/proto-checks.test.ts` (LAMOVA numbers → info; 1.01 diff → fail as before), a rows/document-reading test for `rounding`.

## 5. Do not touch

Ledger code, VAT return code, the buyer and IČO checks. Hard rules 1, 2, 6.

## 6. Commands

- `pnpm --filter @shoebox/validation test 2>&1 | tail -30`, `pnpm --filter @shoebox/worker test -- doc-extract 2>&1 | tail -30`, `pnpm --filter @shoebox/web test -- correction detail trust 2>&1 | tail -30`, typecheck of validation, worker, web, db.

## 7. Acceptance

- [ ] Tests pass, typecheck clean, no float on money, copy only in `en.json`.

## 8. Stop and ask

As in TEMPLATE.md §8.

## 9. Report

`docs/tasks/0610-report.md` (600 tokens max), `Status: review`, commit `0610: rounding within 1 Kč is a quiet note, not an issue`. Do not push.
