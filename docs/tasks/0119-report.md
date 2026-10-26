# 0119 report

Status: review

Files changed: match-store.ts (3 functions, `createdBy`/`confirmedBy` on link insert), jobs.ts (`bank.match.decide`), worker handler/register (`refreshPaidAt` extracted, decide handler), `bank-match-decide.test.ts`, web `payment.ts`, `payment-actions.ts`, `payment-card.tsx`, `enqueue.ts`, inbox `[id]/page.tsx`, `payment.test.ts`, `en.json` (8 keys).

Commands:
- worker vitest (decide + bank-match): 2 files, 16 tests passed.
- web vitest payment: 5 passed. pipeline jobs.test: 15 passed. i18n test: 24 passed.
- typecheck db, pipeline, worker, web: clean.
- biome on changed paths: 0 errors (1 existing img warning in page.tsx).

Acceptance: no card when nothing found and unpaid (page renders it only if paid or found); the action only enqueues.

Deviations: steps 1 and 2 share one commit (`0119 step 1`). `doc.payment.paid` is "Paid on" with the date rendered beside it (placeholder not usable with `LegalDateText`). `refreshTransactionMatchState` has no DB test (DB tests run in CI only; SQL not executed locally). Job-count test needed no change.

Left: TODO(M07-learning), TODO(M07-transfer-accept), TODO(M07-supersede-on-accept), TODO(M07-fx).
