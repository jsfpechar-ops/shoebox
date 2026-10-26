# 0118 report

Status: blocked (one brief test expectation looks wrong; everything else done)

## 1. Files changed
jobs.ts (2 jobs), bank-match/handler.ts + register.ts (new), main.ts, bank-import/handler.ts + register.ts, doc-extract/handler.ts + register.ts, test/bank-match.test.ts (new). Commits 0118 step 1 to 6.

## 2. Commands
- pipeline `jobs` test: 15 passed; pipeline and worker typecheck: no errors.
- bank-import, doc-extract-handler: pass. bank-match: 10 of 11 pass.
- biome on changed paths: 0 errors.

## 3. Acceptance
- [ ] bank-match passes unchanged: FAILS "VS + amount" on `confidence`: expected '0.989', got '0.996'.
- [x] bank-import, doc-extract-handler still pass
- [x] TODO(M07 ...) comments present in handler.ts
- [x] main.ts registers bank.match after doc.split

## 4. Deviations
- Test failure: logit = bias -4 + amount_exact 3 + vs_exact 4 + date 1.5 (plateau) + unique 1 = 5.5, sigmoid = 0.996. The brief's 0.989 is sigmoid(4.5), i.e. without `unique`. The other scores (0.622, 0.818, 0.998) match with `unique` counted where scoreBatch applies it, so 0.989 looks like an arithmetic slip. Test not edited.
- Test: `!` replaced by a throwing `must()` helper (biome).
- Brief excerpt said `insertTransactions` returns inserted; real call is `deps.store.insertTransactions` (insertStatementTransactions), id variable `importId`; used `result.inserted > 0`.
- Handler type of transactions payload uses `| undefined` (exactOptionalPropertyTypes, needed to register).
- `vs` and counterparty account passed through unchanged from DB rows.

## 5. Questions
- Confirm 0.996 (fix the test) or tell me which feature should not count.
- Document scope: `syncOpenSuggestions` with only the one document supersedes open suggestions of the same transaction for other documents (brief step 5 says sync every tx). Keep?
- doc-extract: enqueueMatch sits inside the existing try block after save; an enqueue error routes to onError.

## 6. Owner steps left
Push, PR against phase/0, run DB tests in CI; brief's owner step after deploy.
