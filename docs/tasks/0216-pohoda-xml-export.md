# 0216: Pohoda XML export (dataPack 2.0), pure builder

Status: review
Ticket: P2-EXPF-01 (part 1) | Depends on: lane C categorize (merged) | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0216-report.md

## 1. Objective

`buildPohodaDataPack(input, profile)` in `packages/exports/src/pohoda/`: turns a month of documents into one Pohoda dataPack XML that validates against the vendored Stormware XSD set. Pure, no DB. A later brief wires it into the accountant package. Accountants who use Pohoda (most Czech OSVČ accountants) import the month in one click instead of retyping.

## 2. Context

Spec: `docs/v3/modules/M10-*.md` §4.7.1–4.7.6 (read those lines only: `grep -n '^#### 4.7' docs/v3/modules/M10*.md`). This brief narrows it:

- XSD set is vendored at `packages/exports/xsd/pohoda/version_2/` (73 files, `data.xsd` is the root; encoding windows-1250, leave them unchanged). Validate in tests exactly like `packages/exports/test/isdoc-build.test.ts` does with xmllint (`xmllint --noout --schema …/data.xsd file`). CI installs xmllint.
- A hand-written dataPack with one `inv:invoice` (header: invoiceType, symVar, originalDocument, date, dateTax, dateDue, classificationVAT/typ:classificationVATType, text, partnerIdentity/typ:address{company, ico, dic}, paymentType/typ:paymentType; detail: one invoiceItem {text, quantity, payVAT false, rateVAT, homeCurrency{unitPrice, price, priceVAT}}; summary homeCurrency{priceHigh, priceHighVAT, priceHighSum}) is known to validate. Start from that shape.
- Scope of this brief:
  - Agendas: `inv:invoice` for `received_invoice` (receivedInvoice), `received_credit_note` (receivedCreditNotice), `issued_invoice` (issuedInvoice), `issued_credit_note` (issuedCreditNotice); `int:intDoc` for `received_advance_tax_doc`, `platform_statement` and `received_receipt` paid by card or other; `vch:voucher` (voucherType expense) for `received_receipt` paid in cash **only when** `profile.cashAccount` is set, else `int:intDoc` plus a warning `cash_account_missing`. Every other class is skipped (not an error).
  - CZK only. A document with `currency ≠ 'CZK'` is skipped with warning `foreign_currency` (TODO(pohoda-fx): `inv:foreignCurrency`).
  - Items: line mode `summary` only: one item per group `(categoryCode, vatTreatment, vatRateType)` of the input lines, text = `profile.categoryLabel(code)` (passed in), quantity 1, payVAT false, rateVAT standard→high, reduced→low, zero/none→none, homeCurrency unitPrice = price = Σ net, priceVAT = Σ vat. Item-level `accounting` and `classificationVAT` from the mappings below.
  - Summary `homeCurrency`: from `input.vatSummary` (never recomputed): priceNone, priceLow/LowVAT/LowSum, priceHigh/HighVAT/HighSum.
  - Header fields per §4.7.3: invoiceType, symVar (digits only, ≤ 10, else digits of the document number if ≤ 10, else omitted), originalDocument (document number; truncate to the XSD max length with warning `truncated`), date, dateTax (duzp), dateAccounting (received ?? issue date), dateKHDPH and dateApplicationVAT (VAT point date) only when `profile.vatStatus === 'platce'`, dateDue, text (summary, truncate to the XSD max), partnerIdentity (company, street, city, zip, ico, dic, country ids only if the XSD accepts it), paymentType (bank_transfer→draft, card→creditcard, cash→cash, cod→delivery, other→draft), paymentAccount accountNo/bankCode for a CZ account, intNote `Shoebox doc {documentId} r{revision}`. Look up each element in the XSD before using it; the XSD wins over the spec, note every difference in the report.
  - `classificationVAT` resolution per item and header: `profile.vatStatus === 'neplatce'` → `classificationVATType nonSubsume`; treatment in {`rcv_foreign_vat_charged`, `rcv_out_of_scope`, `iss_no_vat`} → `nonSubsume`; else `profile.classificationVAT[treatment]` as `typ:ids`; else omitted with warning `unmapped_classification`. Never invent codes like `PD`/`UD`.
  - `accounting`: `profile.accounting[categoryCode] ?? profile.accounting[groupOf(categoryCode)]` as `typ:ids`, else omitted and counted in warning `unmapped_accounting`. Groups per §4.7.5 (b): read the category codes from `packages/domain/src/taxonomy/` (import them, do not copy).
  - Ids: `dataPack@id` = `SB-{ico}-{periodLabel}-v{n}` (input), `dataPackItem@id` = `SB` + first 12 hex of documentId (no dashes) + `-r` + revision.
- Money: amounts are decimal strings; add with `Money` from `@shoebox/domain` (ADR-007), never floats. Format with 2 decimals.
- Escape text like `esc()` in `packages/exports/src/isdoc/build.ts` (reuse it: move it to `packages/exports/src/xml.ts` if needed).
- Input types: define `PohodaDocument` (id, revision, class, issueDate, duzp, receivedDate, vatPointDate, dueDate, documentNumber, variableSymbol, summary, currency, paymentMethod, payToAccount {accountNumber, bankCode}, partner {name, ico, dic, street, city, zip, country}, lines [{net, vat, gross, vatRateType, vatRatePct, vatTreatment, categoryCode}], vatSummary [{vatRateType, base, vat}]) and `PohodaProfile` (vatStatus, ico, cashAccount?, classificationVAT: Partial<Record<treatment,string>>, accounting: Record<string,string>, categoryLabel(code)). Use the enum string types from `@shoebox/domain` where they exist.

## 3. Files

`packages/exports/src/pohoda/{build,types,mapping}.ts`, `packages/exports/src/index.ts` (export), `packages/exports/src/xml.ts` (optional), `packages/exports/test/pohoda.test.ts`, `packages/exports/test/fixtures/pohoda-*.ts` (synthetic only).

## 4. Steps

1. Read M10 §4.7 and the XSD elements you need (`grep -n 'name="invoiceHeader"' -A80 …/invoice.xsd`, same for intDoc and voucher headers).
2. Write types, mapping (`resolveClassificationVAT`, `resolveAccounting`, `groupOf`), build.
3. Tests (each XML validated with xmllint): a received invoice 21 % from a platce supplier for a `neplatce` org (nonSubsume, A7 style: an invoice for 117.00 marked `tax_doc_status not_tax_document` still exports as receivedInvoice); an issued invoice; a mixed invoice (two categories → two items with their own accounting codes); a cash receipt with and without `cashAccount` (voucher vs intDoc + warning); a card receipt (intDoc); a EUR invoice (skipped, warning); a skipped `non_document`; item ids deterministic across two runs; special characters `&<>"` escaped; a long document number truncated with warning.

## 5. Do not touch

Lane A, C and D folders (`packages/domain/src/{taxonomy,vat,ledgers,fx}` read-only imports are fine, `packages/domain/rules/cz`, `apps/**`), the XSD files, migrations, `cs.json`. No new dependency.

## 6. Commands

End every command with `| tail -30`. Commands are in section 7.

## 7. Acceptance

- [ ] `pnpm --filter @shoebox/exports test 2>&1 | tail -30` passes, every generated XML validates against `data.xsd`.
- [ ] `pnpm --filter @shoebox/exports typecheck`, `pnpm depcruise`, `pnpm exec biome check packages/exports`, `python3 scripts/context_lint.py` clean.
- [ ] No float arithmetic on money (`grep -n "parseFloat\|Number(" packages/exports/src/pohoda` returns nothing money-related).

## 8. Stop and ask

Stop and report instead of guessing when an XSD element needed by this brief does not exist or has a different shape, or a check fails twice for a reason outside these files.

## 9. Report

`docs/tasks/0216-report.md`: files changed, every spec-vs-XSD difference found, deviations, the test output tail. Then set this brief's Status to `review`.
