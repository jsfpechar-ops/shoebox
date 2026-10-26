# 0216 report

Status: review

Files: packages/exports/src/{xml.ts,index.ts,isdoc/build.ts (esc moved to xml.ts),pohoda/{build,types,mapping}.ts}, test/pohoda.test.ts, test/fixtures/pohoda-fixtures.ts.

Commands: exports tests 30/30 pass (14 new, each non-empty pack validated by xmllint against data.xsd); typecheck clean; depcruise no violations; biome clean; context_lint OK; no float/Number use in src/pohoda.

## Spec vs XSD differences
- `symVar` max is 20 in the XSD; spec/brief says 10, kept 10.
- Item `text` max is 90 (string90), not 240; header `text` is 240. `originalDocument` max 32.
- `intDoc` header has `originalDocumentNumber` (no max), no `dateApplicationVAT`, no `paymentType`/`paymentAccount`; `voucher` header has no `dateAccounting`/`symVar`/`dateDue`, adds `datePayment`.
- `paymentAccount` is documented as used only for liabilities, so emitted for received classes only; it needs both `accountNo` and `bankCode`.
- `percentVAT` not sent (only `rateVAT`).
- A dataPack with zero items is XSD-invalid (`dataPackItem` required); the builder still returns it, callers must not export an empty pack.
- Foreign VAT ID: only `typ:dic` (max 18, truncated with warning); `icDph` not used.

## Deviations
- `groupOf` returns the taxonomy `CategoryGroup` (`expense`, `asset`, `non_deductible`, ...), not the spec's exp_*/small_asset placeholders; finer splits use per-category keys.
- Voucher `datePayment` = issue date (input has no paid_at).
- Header accounting/classificationVAT taken from the first item group.
- `unmapped_*` warnings are per document with a count.
