# M07: Bank and payments (money accounts, transaction intake, matcher, missing-documents radar, paying own bills)

**Phase:** 2 (MVP+). The Fio API token sync (§4.4) is a **Later** item behind the flag `features.bank_fio_api`. `02-scope-and-phases.md` and ADR-009 (aligned on 2026-10-18) both list it under Later, after the legal opinion L-01.
**Package:** `packages/bank` (parsers, notice parsers, matcher, payment files: pure TS except the adapters in `packages/bank/src/io/*`), with workers in `apps/worker/src/bank/*`.
**Depends on:** M01/M02 (ingestion and extraction: documents, `pay_to_account`, statement/settlement breakdown lines), M03 (validation rule catalog, CRPDPH client), M12 (secrets/KMS, notifications, audit). **Consumed by:** M04 (cash-basis `tax_ledger_entries` rebuilt from `payment_links` / `paid_at`), M06 (podklady, advances paid), M09 (dashboard cards, obligations), M10 (bank reconciliation, completeness, radar).

---

## 1. Purpose and scope

The module answers three questions for every money movement: **what is it** (payment of a document, fee, transfer, tax, private), **is there a document for it** (else: missing-documents radar), and **when was each document paid** (`documents.paid_at`, the cash-basis date for daňová evidence, `04 §2.3`).

**In scope (Phase 2)**
1. Money accounts: `bank`, `cash`, `card`, `platform` (`04 §4`).
2. Transaction intake, all licence-free (ADR-009, `research/bank-connectivity.md §4.3, §6.1`):
   - statement file import with format auto-detection: GPC/ABO, CAMT.053, MT940, bank CSV/JSON (Fio, ČS incl. George JSON, ČSOB, KB, RB, Air Bank, MONETA, UniCredit, mBank), platform CSVs (Airbnb, Booking, ComGate, GoPay, PayPal, Zásilkovna), and a generic CSV column-mapping wizard as fallback;
   - bank notification e-mails sent to the `+banka` alias, with per-bank parsers;
   - derived transactions for documents paid by cash or card (`tx_source = 'document_evidence'`).
3. Dedupe across files and channels.
4. The **matcher** (§4.6): candidate generation, scoring, assignment, partial and multi-document payments, refunds, fees, own transfers, tax and insurance payments, platform payouts, card/cash evidence, `paid_at`.
5. The **missing-documents radar** (§4.8) with a supplier request e-mail draft.
6. **Paying own bills** (§4.9): QR Platba per unpaid document and an ABO batch file, both after pre-payment checks (unreliable payer, published account).
7. The **synthetic 500-transaction test set** (§9.3), which gates the Phase 2 exit (`02`: ≥ 95 % auto-match, zero false matches above 0.9).

**Out of scope:** PSD2/aggregators (Later, ADR-009), payment initiation of any kind (we only generate QR strings and files; `02` guardrail), PDF statement parsing (a PDF statement is classified `bank_statement` by M01 and the user is asked for a CSV/GPC/XML export), SEPA pain.001 (Later), FX revaluation and accounting entries, issuing invoices (Later).

## 2. User stories

| # | Persona | Story |
|---|---|---|
| US1 | P2 Tomáš | I upload my monthly Air Bank CSV. Every receipt I photographed is marked paid without me doing anything, and I see 2 payments with "chybí doklad". |
| US2 | P3 Lucie | I set up my ČSOB notifications to go to `…+banka@in.<domain>`. Incoming customer payments are paired within minutes, and supplier invoices paid by transfer get their paid date. |
| US3 | P3 Lucie | I import my ComGate and Zásilkovna CSVs. Payouts in the bank are paired with the gateway rows and the gateway fees are booked without asking me for invoices. |
| US4 | P3 Lucie | Before I pay a supplier I see "Dodavatel je spolehlivý, účet je zveřejněný" and a QR code; for 6 invoices I download one ABO file for my bank. |
| US5 | P4 Josef | My property manager pays me 80 % and keeps 20 %. The manager's invoice shows as paid by offset on the date of the payout, and the payout is linked to the settlement statement. |
| US6 | P4 Josef | My card payments to Cloudflare (USD) and Anthropic (EUR) are matched to their invoices even though the bank shows CZK. |
| US7 | P1 Petra | My monthly paušální daň advance and my VAT payment to the FÚ are recognised as tax payments; nobody asks me for a document. |
| US8 | P2 Tomáš | For a 2 105 Kč Alza card payment the app tells me "máme jen objednávku, faktura chybí" and drafts an e-mail to Alza asking for the invoice. |
| US9 | Any | I confirm or reject a suggested pairing with one tap; the app learns the supplier's account and card descriptor. |
| US10 | Accountant | I see a bank reconciliation where every movement is either linked to a document, categorised (fee/transfer/tax/private), or listed as missing a document. |

## 3. Inputs and outputs

**Inputs**
- Files routed from ingestion (M01): any upload whose bytes `detectStatementFormat()` recognises (§4.2) goes to bank import instead of the document pipeline. Documents classified `bank_statement` by M01 are re-offered to the detector; PDF statements produce the review question kind `statement_format_needed`.
- `inbound_emails` with `purpose = 'bank_notice'` (the `+banka` alias, ADR-005).
- Documents (`documents`, `document_lines`, `document_vat_summary`) in status `ready`/`finalized` (and `needs_review` as suggestion-only candidates).
- `partners`, `partner_bank_accounts`, `vendor_profiles`, `fx_rates`, rule tables (`bank.authority_accounts`, `vat.ruceni_cash_threshold`), CRPDPH via `packages/registries`.
- User actions: confirm/reject suggestion, manual link, categorise, ignore, mapping wizard answers.

**Outputs**
- `money_accounts`, `transactions`, `payment_links`, `documents.paid_at`, `transactions.match_state`, `transactions.category_code`.
- Tables (05 §6): `statement_imports`, `match_suggestions`, `counterparty_aliases`, `import_mappings` (`kind='bank_statement'`, shared with M01), `payment_orders` + `payment_order_items`; `bank_connections` (Later, 05 §9.1).
- `review_questions` (kinds `confirm_match`, `missing_document`, `overpayment`, `possible_duplicate_tx`, `refund_without_credit_note`, `card_payment_not_found`, `statement_format_needed`).
- Events (§6.4), radar items (§4.8), SPAYD strings, ABO files.

## 4. Detailed behavior and algorithms

### 4.1 Money accounts

| `type` | Created when | Identity used for matching incoming files/notices |
|---|---|---|
| `bank` | user adds it, or first statement import whose account is unknown (user confirms "Přidat účet 2400123456/2010?") | `iban` (normalised) or `account_number` + `bank_code` |
| `card` | user adds a credit card with its own statements; or automatically "Platby kartou (bez výpisu)" for card evidence (§4.7.9) | `card_last4` list in `raw` of the account settings, statement header |
| `cash` | automatically "Pokladna" on the first document with `payment_method = 'cash'` | single per currency |
| `platform` | first platform CSV import, or user adds it (`platform` ∈ `airbnb`, `booking`, `comgate`, `gopay`, `paypal`, `zasilkovna`, `property_manager`) | `platform` + merchant/account id from the file |

Rules:
- Account numbers are stored normalised: `account_number` = `[prefix-]number` without leading zeros, `bank_code` 4 digits, `iban` computed per `research/registries-and-formats.md §6.2` and validated (mod-11 per part, §6.1; mod-97 for IBAN). A failing check rejects the account with `bank.account.invalid`.
- `import_format` remembers the last detected format; `notice_parser` the last notice parser id.
- `is_business = false` marks a private account; its transactions are imported only if the user chooses to (never in the radar).
- A **platform** account is a clearing account: gross sales in, fees out, payouts out to a bank account. Its balance should return to ~0 after each payout (§4.7.7).

### 4.2 Format auto-detection

`detectStatementFormat(bytes, filename?, hints?) → { format, confidence, profile?, encoding, alternatives[] }`. Steps (first match wins unless noted):

1. Reject > 10 MB (`bank.import.too_large`). Read the first 64 KB.
2. Encoding: UTF-8 BOM → utf-8; valid UTF-8 → utf-8; else windows-1250 (`research/registries-and-formats.md §10.1`: GPC is "usually windows-1250 [I]").
3. XML whose root or namespace contains `camt.053` / `BkToCstmrStmt` → `camt053` (store the version from the namespace `urn:iso:std:iso:20022:tech:xsd:camt.053.001.NN`).
4. Text with lines starting `:20:` and containing `:25:` and `:61:` → `mt940` (`.sta` extension raises confidence).
5. First non-empty line starts with `074` and length 128 (± CR/LF) → `gpc`; profile chosen per §4.3.1.
6. JSON with `accountStatement.transactionList` → `fio_json`; JSON array/object matching the George signature (§4.3.4) → `json_cs_george`.
7. XLSX → first sheet converted to CSV rows, continue at 8.
8. CSV: sniff delimiter among `;` `,` `\t` (the one giving the most constant column count over 20 lines); find the header row (first row with ≥ 3 cells matching any profile's header tokens, after lowercase + ASCII-fold + trim of `#` and quotes). Score each CSV profile = |profile tokens ∩ header tokens| / |profile required tokens|. Best ≥ 0.6 and ahead of the runner-up by ≥ 0.05 → that profile. A saved `import_mappings` row (`kind='bank_statement'`) whose `header_signature` (sha256 of the normalised header row) equals the file's → that mapping, confidence 1.
9. PDF → `{ format: 'unsupported_pdf' }` → review question `statement_format_needed` with bank-specific export instructions (i18n `bank.import.pdf_instructions.<bank>`).
10. Nothing matched, or two profiles within 0.05 → `csv_generic` → mapping wizard (§4.3.6), with the ambiguous profiles offered as one-tap choices.

### 4.3 Statement parsers

All parsers implement `StatementParser` (§6.1), output `CanonicalTx[]` with **signed** amounts in account currency (+ incoming, − outgoing; `05 §6`), and never throw on a bad row: the row is skipped with a `ParseWarning { line, code, raw }`. An import with > 5 % bad rows is `partially_parsed` and the user sees the rows.

Common normalisation (`packages/bank/src/normalize.ts`):
- Amounts: strip spaces/NBSP/apostrophes as thousand separators; decimal separator is the last `,` or `.` followed by exactly 1–2 digits; result as `Money` (ADR-007). Never parse money via `Number`.
- VS/KS/SS: digits only, strip leading zeros, `''` → null, VS > 10 digits → keep in `message`, VS null.
- Counterparty account: split `prefix-number/bank` forms; IBAN `CZ…` → derive `account_number`/`bank_code` too; foreign IBAN kept in `counterparty_iban` only.
- Dates: per format; local legal date (no TZ).

#### 4.3.1 GPC / ABO (records 074 and 075)

Source: `research/registries-and-formats.md §10.1` (Fio `struktura-gpc.pdf`, ABO_format.pdf, RB IB formats), `research/bank-connectivity.md §5.1`. Positions are 1-based, record = 128 chars + CRLF; numbers left zero-padded, text right space-padded, amounts in haléře, dates `DDMMYY` (century: 20YY).

**074, statement header → `statement_imports`**

| Pos | Len | Field | Mapping |
|---|---|---|---|
| 1–3 | 3 | `074` | record type |
| 4–19 | 16 | client account | decode per profile `account_encoding` (below); must equal the target money account, else ask the user |
| 20–39 | 20 | short account name | `raw.account_name` |
| 40–45 | 6 | old balance date | `period_from` = this date + 1 day when the profile says "balance as of end of previous day" (Fio: yes **[verify]**), else this date |
| 46–59 / 60 | 14 / 1 | old balance / sign | `opening_balance` (sign `+`/`-`) |
| 61–74 / 75 | 14 / 1 | new balance / sign | `closing_balance` |
| 76–89 / 90 | 14 / 1 | debit turnover / sign (`0` or `-` at Fio) | control total Σ outgoing |
| 91–104 / 105 | 14 / 1 | credit turnover / sign | control total Σ incoming |
| 106–108 | 3 | statement number | `statement_number` |
| 109–114 | 6 | posting date | `period_to` |
| 115–128 | 14 | filler | ignored |

**075, transaction → `transactions`**

| Pos | Len | Field | Mapping |
|---|---|---|---|
| 1–3 | 3 | `075` | |
| 4–19 | 16 | client account | must equal the 074 account |
| 20–35 | 16 | counter-account (prefix 6 + number 10) | decode per `account_encoding` → `counterparty_account`; all zeros → null |
| 36–48 | 13 | document / transaction id | `external_id = 'gpc:' + value` if the profile has `tx_id_unique = true` and value ≠ 0, else dedupe hash (§4.5) |
| 49–60 | 12 | amount in haléře | absolute amount / 100 |
| 61 | 1 | kód účtování | sign and reversal per profile `posting_codes` (below) |
| 62–71 | 10 | VS | `variable_symbol` |
| 72–81 | 10 | KS field | per profile `ks_layout`: `ks10` (plain KS) or `bank4_ks4` (Fio "BBBBKSYM": counterparty bank code + KS, left-padded **[verify against Fio struktura-gpc.pdf]**) → `counterparty_bank_code`, `constant_symbol` |
| 82–91 | 10 | SS | `specific_symbol` |
| 92–97 | 6 | valuta | `value_date`; `000000` → null |
| 98–117 | 20 | doplňující údaj / counterparty name | `counterparty_name` (trimmed; also kept in `raw`) |
| 118 | 1 | kód změny položky (`0`) | ignored |
| 119–122 | 4 | druh dat / currency (`0203` = CZK at Fio) | ISO 4217 numeric (last 3 digits) → `currency`; must equal the account currency, else warning |
| 123–128 | 6 | due/posting date | `booked_on`; if `000000` → `value_date`; if also null → 074 posting date |

Optional **078/079** records (AV1–AV4, up to 140 chars) following a 075 are concatenated into `message` (`research/registries-and-formats.md §10.1`).

Sign and reversal (`posting_codes`): default (Fio) `1` → −amount, `2` → +amount, `4` → +amount with `is_reversal` (storno of a debit), `5` → −amount with `is_reversal` (storno of a credit). Profile `gpc_cs_servis24` maps `3`/`4` as storno codes (**[verify]**, the SERVIS 24 doc lists 3/4). Comgate uses posting codes like `1102` and encodes currency in the account prefix (`help.comgate.eu/docs/en/abo`) → profile `gpc_comgate` with its own code table **[verify with fixture]**.

`account_encoding`: `edicni` (readable, zero-padded) or `vnitrni` (digits permuted, RB IB formats doc). Auto-detect when no profile is pinned: decode the 074 account both ways; keep the encoding whose result passes mod-11 and equals a known money account; if both or neither → ask the user once and pin it on the account.

Profiles shipped: `gpc_fio`, `gpc_cs_servis24`, `gpc_kb`, `gpc_rb`, `gpc_creditas`, `gpc_comgate`, `gpc_generic`. Profile selection: money account `bank_code` (2010 → fio, 0800 → cs, 0100 → kb, 5500 → rb, 2250 → creditas, 8620 or `platform = 'comgate'` → comgate), else `gpc_generic` with encoding auto-detect.

Balance check: `opening_balance + Σ amount = closing_balance` and the debit/credit turnovers match → `balance_check = 'ok'`, else `'mismatch'` (warning on the import and in M10 reconciliation).

#### 4.3.2 CAMT.053

Paths per `research/registries-and-formats.md §10.2` (marked [I] there; every bank profile must be confirmed with a fixture):
- Statement: `Stmt/Id` → `statement_number`; `FrToDt` → period; `Acct/Id/IBAN` → money account; `Bal` with `Tp/CdOrPrtry/Cd = OPBD` / `CLBD` → opening/closing.
- Each `Ntry`: `Amt@Ccy` + `CdtDbtInd` (`CRDT` +, `DBIT` −); `RvslInd = true` → `is_reversal`; `Sts` other than `BOOK` → skipped (pending); `BookgDt/Dt|DtTm` → `booked_on`; `ValDt` → `value_date`; `external_id = 'camt:' + (AcctSvcrRef ?? NtryRef ?? NtryDtls/TxDtls/Refs/AcctSvcrRef ?? TxId)`, else hash.
- `NtryDtls/TxDtls` with more than one element and individual `Amt` → one transaction per `TxDtls` (batch booking split); otherwise one transaction per `Ntry`.
- Counterparty: if `CRDT` use `RltdPties/Dbtr/Nm` + `DbtrAcct/Id/(IBAN|Othr/Id)`, else `Cdtr` + `CdtrAcct`.
- Symbols: in order: `RmtInf/Strd/CdtrRefInf/Ref`; `Refs/EndToEndId`; `RmtInf/Ustrd`. Apply regexes `/(?:^|\/)VS[:\/]?\s*(\d{1,10})/`, `/(?:^|\/)KS[:\/]?\s*(\d{1,10})/`, `/(?:^|\/)SS[:\/]?\s*(\d{1,10})/`; an `EndToEndId` that is 1–10 digits only is the VS. `Ustrd` → `message`.
- `AmtDtls/InstdAmt/Amt@Ccy` (or `TxAmt`) different from the entry currency → `amount_original`/`currency_original` (same sign as `amount`).
- Card: `BkTxCd/Domn/Fmly/Cd` in `CCRD`/`MCRD` or a profile-specific proprietary code → `card_merchant` = `Cdtr/Nm` ?? first 40 chars of `Ustrd`; `card_last4` from a `\d{4}` after `*` or `XXXX` in `Ustrd`.
- `Chrgs` is kept in `raw`; no separate transaction (the entry amount already includes it at Czech banks **[verify per bank]**).
- Profile overrides keyed by `Svcr/FinInstnId/BIC` (e.g. `FIOBCZPP`, `GIBACZPX`).

#### 4.3.3 MT940

`:25:` account (IBAN or `account/bank`) → money account; `:28C:` statement number; `:60F:`/`:60M:` opening (`C`/`D` + `YYMMDD` + currency + amount with comma); each `:61:` = value date `YYMMDD`, optional entry date `MMDD` (→ `booked_on`, year from value date with Dec/Jan rollover), mark `C`/`D`/`RC`/`RD` (`R*` → `is_reversal`), amount, `N` + 3-char type, reference `//` bank reference (→ `external_id = 'mt940:' + bank ref` when present); the following `:86:` lines (until the next tag) → `message`, parsed for `?20…?29` subfields when present (`?32/?33` name, `?31` account **[verify per bank]**) and the VS/KS/SS regexes from §4.3.2; `:62F:` closing balance. Used for Fio `.sta`, ČSOB and UniCredit MultiCash STA (internal research (not published)).

#### 4.3.4 Bank CSV/JSON profiles

Each profile is a data file `packages/bank/src/profiles/<format>.ts`: `{ format, version, encodingHint, delimiter, headerTokens (required/optional), columnMap, dateFormat, amountMode ('signed' | 'debit_credit' | 'direction_column'), preambleRows, footerRows, idColumn?, merchantRule? }`. Column names below are what the profiles look for. **All header names are [verify against a real anonymised export] before a profile is enabled** (acceptance criterion A3): public documentation does not publish them, and the lists below are a starting point for fixture collection, not facts.

| Format | Source | Key columns to map (expected header tokens) | Id for dedupe | Notes |
|---|---|---|---|---|
| `csv_fio` | Fio IB export | `ID pohybu`, `Datum`, `Objem`, `Měna`, `Protiúčet`, `Kód banky`, `Název protiúčtu`, `KS`, `VS`, `SS`, `Zpráva pro příjemce`, `Typ`, `Upřesnění`, `Komentář` | `ID pohybu` (most reliable key, `research/bank-connectivity.md §5.1`) | preamble with account info lines |
| `fio_json` | Fio IB/API JSON | `columnN` objects per `research/registries-and-formats.md §10.3` (0 date, 1 amount, 2 counter-account, 3 bank code, 4 KS, 5 VS, 6 SS, 10 counter name, 14 currency, 16 message, 22 ID pohybu, 26 BIC) | column22 | date: accept `yyyy-mm-dd+GMT` **and** epoch ms |
| `csv_cs` | ČS George CSV | date, amount, currency, partner name, partner account, VS/KS/SS, note, reference | bank reference column if present | also "Servis 24"/"Business 24" GPC via `gpc_cs_servis24` |
| `json_cs_george` | ČS George JSON export | booking date, partner name, partner account `{number, bankCode, iban}`, amount `{value, precision, currency}` (amount = value / 10^precision **[verify]**), reference, variable/constant/specific symbol, note | reference id | listed by Competitor E (internal research (not published)) |
| `csv_csob` | ČSOB IB | account, posting date, amount, currency, counter-account, counter bank code, counter name, KS, VS, SS, operation label, transaction id, note | transaction id | ČSOB lacks a unique id at some channels (`bank-connectivity.md §2`) → hash fallback |
| `csv_kb` | KB / KB+ | due date, counterparty, counterparty name, amount, original amount, original currency, rate, VS, KS, SS, transaction identification, system description, AV fields | transaction identification | preamble rows |
| `csv_rb` | Raiffeisenbank | execution date, posting date, counter-account, counter name, transaction type, message, note, VS, KS, SS, posted amount, account currency, original amount + currency, fee, transaction id | transaction id | separate card-statement variant (internal research (not published)) |
| `csv_airbank` | Air Bank | execution date, direction, payment type, account currency, amount in account currency, fee, original currency + amount, counterparty name, counterparty account, VS, KS, SS, message for payee, card name/number, merchant location (`Obchodní místo`), exchange rate, reference number, posting date | reference number | merchant column → `card_merchant` |
| `csv_moneta` | MONETA | to be defined from fixture | — | MONETA exports "XML" per EOS (`bank-connectivity.md §2`) **[verify]** |
| `csv_unicredit` | UniCredit | to be defined from fixture; MultiCash STA goes through `mt940` | — | card CSV variant |
| `csv_mbank` | mBank | headers prefixed `#` (transaction date, posting date, description, message, payer/payee, account, KS, VS, SS, amount, balance) **[verify]** | hash | mBank notices are unusable (`bank-connectivity.md §5.1`), so CSV import is the only channel |

#### 4.3.5 Platform CSV profiles

Platform rows are imported into the **platform** money account. Each source row yields 1–3 canonical transactions with `raw.platform_kind` ∈ `sale`, `fee`, `payout`, `refund`, `adjustment` and `raw.platform_ref` (reservation/order/transaction id):

| Format | Rows → transactions | Matching use |
|---|---|---|
| `csv_airbnb` | reservation: `sale` +gross (incl. cleaning fee), `fee` −host service fee; payout row: `payout` −amount | payout ↔ bank incoming (own transfer §4.7.6); occupancy taxes kept in `raw` |
| `csv_booking` | per reservation: `sale` +amount, `fee` −commission, `fee` −payments service fee; per payout: `payout` −net | fees aggregated per month ↔ Booking commission invoice (offset, §4.7.7) |
| `csv_comgate` (CSV or `gpc_comgate`) | per payment: `sale` +gross, `fee` −fee; per transfer: `payout` | sale ↔ issued invoice by VS/order number (`raw.platform_ref` vs `documents.order_number`/VS) |
| `csv_gopay` | same pattern | same |
| `csv_paypal` | activity download: `Gross` → `sale`/`refund`, `Fee` → `fee`, withdrawal rows → `payout`; `Transaction ID` → external id; currency per row | FX: PayPal account may hold several currencies → one platform account per currency |
| `csv_zasilkovna` | COD per parcel: `sale` +COD amount; fees `fee`; payout `payout` | sale ↔ issued invoice by order number |

Per-platform profile flag `fees_invoiced` (Booking: `true`, Airbnb: `false`, gateways: `false` advisor question TA-17).

#### 4.3.6 Generic CSV column-mapping wizard

1. Show the first 10 parsed rows. The user maps columns to canonical fields: `booked_on` (required), `amount` (required) **or** `debit` + `credit` **or** `amount` + `direction` (with the values meaning "out"), `currency` (column or fixed), `counterparty_name`, `counterparty_account` (combined `123/0100` or separate bank code), `variable_symbol`, `constant_symbol`, `specific_symbol`, `message`, `external_id`, `card_merchant`, `value_date`.
2. Auto-guess every mapping from header synonyms (`datum|date|zaúčtování`, `částka|amount|objem`, `vs|variabilní`, …) so the user usually only confirms.
3. Date format: auto-detect among `DD.MM.YYYY`, `D.M.YYYY`, `YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`; if both `DD/MM` and `MM/DD` fit every row, ask. Decimal separator: auto (§4.3 normalisation).
4. Dry run over all rows; the mapping can be saved only if ≥ 95 % of rows parse and ≥ 1 row has a non-zero amount.
5. Save as `import_mappings` (`kind='bank_statement'`, header signature → mapping) on the money account; next imports of the same layout skip the wizard.

### 4.4 Other intake channels

#### 4.4.1 Bank notification e-mails (`+banka`)

Inbound e-mails to `{slug}-{random8}+banka@in.<domain>` arrive with `purpose = 'bank_notice'` (ADR-005). Job `bank.notice.parse`:
1. **Forwarding confirmations first.** Messages from mail providers' forwarding-verification senders (e.g. Gmail "forwarding-noreply") are detected and shown to the user as a notification with the confirmation link (`bank.notice.forwarding_confirm`). They are not parsed as transactions.
2. **Unwrap forwards.** If the body contains a forwarded-header block (`From:`/`Od:` + `Subject:`/`Předmět:`), parse the original sender and body.
3. **Choose a parser** by original sender domain + subject pattern. Parsers: `notice_fio`, `notice_cs`, `notice_csob`, `notice_kb`, `notice_rb`, `notice_airbank`, `notice_moneta`, `notice_unicredit`, `notice_creditas` (banks with usable notices per `research/bank-connectivity.md §2` and internal research (not published) Competitor C bank list). mBank and Partners: none (unusable, `bank-connectivity.md §2`) → reply notification "Upozornění z mBank neumíme číst, nahrajte výpis CSV".
4. **Parser contract.** Each parser = `{ id, version, senderDomains, subjectPatterns, labelMap, directionRules }` over a shared label grammar: lines `Label: value` or table cells, with Czech/English synonyms (`Částka|Amount`, `Variabilní symbol|VS`, `Protiúčet|Z účtu|Na účet|Účet protistrany`, `Zpráva|Zpráva pro příjemce|Message`, `Obchodník|Místo|Merchant`, `Datum|Dne`). Output `NoticeParseResult` (§6.1). Sender domains and templates are **[verify with ≥ 3 real anonymised notices per bank and direction]** before a parser is enabled (A4).
5. **Account binding.** The parsed (possibly masked, e.g. `****1234`) account must resolve to exactly one `money_accounts` row (suffix match on `account_number` or `iban`). Otherwise the notice is held (`processed_at` stays null) and the user is asked to bind it. This is also the anti-spoofing control: the secret address plus a known account. A notice from a bank domain with a verified `dkim=fail` that was not forwarded is discarded.
6. **Card authorisations** (notice says "platba kartou"/"autorizace") create a transaction with `is_pending = true`; a later statement row merges into it (§4.5) with amount tolerance `matcher.card_fx_tolerance_pct`.
7. Unknown template: store, increment the drift metric `bank_notice_unparsed{bank}`, show "Upozornění jsme nerozpoznali" once per bank. **No LLM fallback** in Phase 2 (a notice can mark invoices paid; deterministic only).

#### 4.4.2 Fio API token (Later, flag `features.bank_fio_api`)

Licence-free per ADR-009, **subject to the legal opinion** on whether polling a user-generated token counts as AIS (`research/bank-connectivity.md §4.3, §7 item 6`; L-01 in `22-open-questions.md`). Facts from `research/registries-and-formats.md §10.3`:
- Base `https://fioapi.fio.cz/v1/rest/`; first sync `periods/{token}/{from}/{to}/transactions.json` for at most the last 90 days (older data needs the user's temporary unlock); then `last/{token}/transactions.json`; `set-last-id` to move the marker after a successful commit.
- **≥ 30 s between calls per token.** Enforced by a Postgres advisory lock on `bank_connections.id` plus `last_call_at`; the poll runs hourly. HTTP 409 → reschedule in 60 s; 413 → split the period in halves; 401/404 on a valid-looking token → `state = 'expired'`.
- Token: 64 chars, read-only requested, **max 180 days** validity. We ask for a **dedicated** token (Fio keeps one "last downloaded" marker per token). `expires_on = created_on + 180 days`; reminders at D-14, D-3, D0 (`notifications`). On expiry the UI falls back to "nahrajte výpis".
- Token stored encrypted (KMS envelope, M12), only `token_last4` visible. Mapping columns as in `fio_json`; `external_id = 'fio:' + column22`.

#### 4.4.3 Derived transactions (`document_evidence`)

See §4.7.9. They carry `external_id = 'doc:' + document_id` (unique per account).

### 4.5 Dedupe and merge

Order of keys for a new canonical transaction `t` on account `A`:
1. **External id.** `(org_id, money_account_id, external_id)` is unique (`05 §6`); a hit → skip (`tx_duplicate++`).
2. **Dedupe hash.** `dedupe_hash = sha256(A.id | booked_on | amount | norm(counterparty_account) | vs | ks | ss | lower(ascii(message)).slice(0,40) | seq)` where `seq` is the 0-based occurrence index of the identical tuple within the same import file and day (so two identical coffees on one day both survive). A hit → skip.
3. **Cross-channel merge** (notice vs statement/API). If `t` comes from `statement_file`/`bank_api` and an existing row on `A` has `source = 'email_notice'`, no external id, same sign, `|booked_on Δ| ≤ 2` days, amount equal (or within `matcher.card_fx_tolerance_pct` when the existing row `is_pending`), and VS equal or both null, and counterparty account equal when both present → **merge**: update the existing row in place (keep `id` and its links), set `external_id`, `source` (precedence `statement_file` > `bank_api` > `email_notice`), `statement_import_id`, overwrite null fields, `is_pending = false`, append the old values to `raw.merged_from[]`. If two existing rows qualify, merge into the one with the smaller `|Δdate|`, then earlier `created_at`; if still tied, insert `t` and create review question `possible_duplicate_tx`.
4. Re-importing the same file (same `source_files.sha256` for the same account) short-circuits to `statement_imports.state = 'duplicate_file'`.

**Reversals (storno).** For `t.is_reversal`: find the original on `A` with opposite sign, equal absolute amount, same VS/counterparty when present, `booked_on` within 31 days before. Found → set `reversal_of_transaction_id`, set both `match_state = 'ignored'`, delete the original's system links (manual links → review question), recompute `paid_at` for affected documents. Not found → keep `t` unmatched with warning `bank.reversal_orphan`.

### 4.6 The matcher

Pure core in `packages/bank/src/matcher/` (no I/O; inputs are views loaded by the worker). Configuration (not law, so not a rule table) lives in `matcher/config.ts`, exported as `MATCHER_CONFIG` with `version` (stored on every link and suggestion as `matcher_version`):

```ts
export const MATCHER_CONFIG = {
  version: 1,
  autoThreshold: 0.90, suggestThreshold: 0.60, minMargin: 0.10,
  roundingToleranceCzk: '1.00', bankFxTolerancePct: '2', cardFxTolerancePct: '3',
  weights: { bias: -4.0, amountExact: 3.0, amountRounding: 2.5, amountFxMax: 1.5, amountPartial: 1.0,
             vsExact: 4.0, vsConflict: -3.0, msgDocNumber: 3.0, accountMatch: 2.5, accountOtherPartner: -3.0,
             nameMax: 3.0, dateMax: 1.5, dateOutside: -1.0, alias: 1.0, unique: 1.0 },
  windows: { transfer: { before: 3, after: 45, plateauAfterDue: 5, defaultDueDays: 30 },
             card: { before: 3, after: 7, plateau: 1 }, payout: { before: 5, after: 5 },
             filing: { before: 0, after: 30 } },
  subsetSum: { maxDocs: 20, maxSubsetSize: 6 },
  cardEvidenceWaitDays: 10, radarGraceDays: 7 /* = 'radar.grace_days' read by M09 */, sweepLookbackDays: 400,
} as const;
```

#### 4.6.1 Pass order for a batch of transactions

Run per org in `withTenant()`; transactions sorted by `booked_on`, then `id`. Each pass only sees transactions still `unmatched`/`partial`:

1. **Reversals** (§4.5).
2. **Own transfers** (§4.7.6).
3. **Rule categorisation** (§4.7.4 tax/insurance, §4.7.5 fees/interest/ATM). A tax payment may additionally link to a `government_filing` document.
4. **Single-document matching**: candidates (§4.6.2) → scores (§4.6.3) → assignment (§4.6.4).
5. **Multi-document** subset-sum (§4.7.2) for transactions still unmatched.
6. **Residuals**: partial/overpayment handling (§4.7.1), persist suggestions, refresh the radar.

Triggers: `bank.match.transactions` after every import/notice; `bank.match.document` when a document becomes `ready`/`finalized` or its `amount_due`, `variable_symbol`, `partner_id`, `pay_to_account` or `class` changes (re-scores unmatched transactions of the last `sweepLookbackDays`); nightly `bank.match.sweep`.

#### 4.6.2 Candidate generation

For transaction `t` (sign `s`):
- **Eligible documents** (not deleted, status ∈ `ready`, `finalized`, `needs_review`; `open_amount > 0`):
  - `s < 0`: `direction = 'in'` and class ∈ `received_invoice`, `received_receipt`, `received_advance_tax_doc`, `received_proforma`; class `issued_credit_note` (refund to a customer); class `government_filing` with `amount_due > 0` (own filed return, municipal fee report).
  - `s > 0`: class ∈ `issued_invoice`, `platform_statement`, `settlement_statement` (payout), `received_credit_note` (supplier refund).
  - Never: `order_confirmation`, `delivery_note`, `contract`, `other_supporting`, `non_document`, `bank_statement`, status `duplicate`/`supporting`.
  - `entry_mode` (`captured`/`manual`/`imported`) does not change eligibility; manual and substitute documents (`substitute_reason` set) are matched like any other. An `imported` spreadsheet row with `paid_at` already recorded by the user gets a `document_evidence` link only if no bank transaction matches within the windows (same upgrade rule as §4.7.9).
- `open_amount(d) = amount_due(d) − Σ links(d)` with `amount_due(d) = coalesce(documents.amount_due, documents.total_gross)` and Σ over link types `payment`, `offset`, `platform_payout`, `fx_difference` minus `refund` (in document currency).
- Retrieval (union, each indexed), capped at 50 candidates per transaction:
  (a) VS key: `norm(t.variable_symbol)` ∈ `docKeys(d)` where `docKeys(d)` = {norm(`variable_symbol`), digits of `document_number` if 1–10 digits, last 10 digits of `document_number` digits};
  (b) message keys: any `docKeys(d)` or the literal `document_number` appears in `t.message` as a whole token;
  (c) amount: `|open_amount_in_account_ccy(d) − |t.amount|| ≤ tolerance(d,t)` within the date window;
  (d) counterparty: `t.counterparty_account`/`iban` ∈ `d.pay_to_account` ∪ `partner_bank_accounts(d.partner_id)` ∪ `counterparty_aliases(kind='account')`;
  (e) name: `similarity(normMerchant(t), d.partner.name) ≥ 0.5` (pg_trgm prefilter ≥ 0.3), or an alias `kind ∈ ('merchant','name')`.
- Amount in account currency: same currency → as is; `t.currency_original = d.currency` → compare `t.amount_original` against `open_amount` directly (exact path); else `open_amount × rate(d.currency, t.booked_on)` from `fx_rates` (rate valid on the date, else the last published before; `vat.cnb_rate_rule`), tolerance `bankFxTolerancePct` (transfer) or `cardFxTolerancePct` (card, i.e. `card_merchant` not null).

#### 4.6.3 Scoring (pure, explainable)

`score = σ(logit)`, `logit = bias + Σ feature contributions` (weights in `MATCHER_CONFIG.weights`). Every contribution is recorded in `match_suggestions.features` and shown to the user as reasons.

| Feature | Value | Contribution |
|---|---|---|
| Amount | exact (`|Δ| < 0.005` in compared currency) | `amountExact` |
| | within `roundingToleranceCzk` (CZK docs) | `amountRounding` |
| | within FX tolerance: `amountFxMax × (1 − |Δ%| / tol%)` | 0…`amountFxMax` |
| | partial: VS exact and `|t| < open_amount` | `amountPartial` (only with VS exact; else candidate dropped) |
| | otherwise | candidate dropped from single-doc matching |
| VS | `norm(t.vs) ∈ docKeys(d)` | `vsExact` |
| | both present, different, and the partner used a VS on ≥ 1 earlier confirmed match | `vsConflict` |
| Message | `docKeys(d)` or `document_number` in `t.message` (not already counted as VS) | `msgDocNumber` |
| Account | counterparty ∈ document/partner accounts or account alias | `accountMatch` |
| | counterparty account is known (alias or `partner_bank_accounts`) for a **different** partner | `accountOtherPartner` |
| Name | `nameSim = max(tokenSetRatio(normMerchant(t), normName(partner.name)), same vs aliases, vs partner e-mail domain stem)`; contribution `nameMax × max(0, (nameSim − 0.5) / 0.5)` | 0…`nameMax` |
| Date | `f_date ∈ [0,1]` from the window (below): `dateMax × f_date`; outside the window (only kept when VS exact) | `dateOutside` |
| Alias | partner reached via a `counterparty_aliases` row with `confirmations ≥ 2` | `alias` |
| Uniqueness | `d` is the only candidate of `t` with an amount feature, and `t` is the only unmatched transaction in the batch window that has `d` as an amount candidate | `unique` |

Caps: document in `needs_review` → `min(score, 0.89)`; multi-document → `min(score, 0.89)` unless every document number appears in the message.

`normMerchant`: uppercase, ASCII-fold, drop prefixes `PAYPAL *`, `SUMUP *`, `SQ *`, `GOOGLE *`, `APPLE.COM/BILL`→`APPLE`, `AMZN MKTP`→`AMAZON`; drop tokens that are pure digits, 2-letter country codes, `WWW`, `.COM`/`.CZ` suffixes, and a stoplist of city names (`PRAHA`, `BRNO`, `OSTRAVA`, …, data file); drop legal forms (`S.R.O.`, `SRO`, `A.S.`, `B.V.`, `LTD`, `LIMITED`, `INC`, `GMBH`, `SE`). `normName` applies the same to partner names. `tokenSetRatio` per the standard token-set Levenshtein ratio (pure TS, `fastest-levenshtein`).

Date windows (`f_date`), with `issue = d.issue_date`, `due = d.due_date ?? issue + defaultDueDays`, `x = t.booked_on`:
- transfer: plateau 1 on `[issue, due + plateauAfterDue]`; linear to 0 at `issue − before` and `due + after`.
- card (`t.card_merchant` not null or `d.payment_method = 'card'`): 1 if `|x − issue| ≤ plateau`; linear to 0 at `issue − before` and `issue + after`.
- payout (`platform_statement`/`settlement_statement`): anchor `d.due_date` (payout date extracted by M02) ?? `service_period_to`; ±5 days linear.
- filing (`government_filing`): plateau `[period_end, due + after]`, where due comes from the linked `obligations` row.

Worked examples (σ values, with `f_date = 1`): VS + exact amount → σ(4.5) = 0.989 (auto). Account + exact amount, no VS → σ(3.0) = 0.953 (auto if margin holds). Card exact amount + nameSim 0.9 → σ(2.9) = 0.948 (auto). Card exact amount + nameSim 0.7 → σ(1.7) = 0.846 (suggest). Exact amount + date only → σ(0.5) = 0.62 (suggest); with uniqueness σ(1.5) = 0.82 (suggest, never auto). VS + exact amount but 3 months late → σ(2.0) = 0.88 (suggest).

#### 4.6.4 Assignment

Pure `assign(candidates, config)`:
1. Drop pairs with `score < suggestThreshold`, and pairs the user rejected before (`match_suggestions.state = 'rejected'` for the same `(transaction_id, document_id)`).
2. **Margin rule** per transaction: if best − second-best < `minMargin`, none of its pairs may auto-link. Same per document across transactions.
3. Sort pairs by `score` desc; tie-breakers in order: smaller `|x − anchor date|`, older `due_date` (FIFO), older `documents.created_at`, lexical `document_id`, lexical `transaction_id`. Deterministic.
4. Greedy: for each pair, if `score ≥ autoThreshold` and margin-eligible and both sides still have capacity (`t` remaining amount > 0.005, `d` open > 0.005) → create link `amount = min(open_amount(d), remaining(t) in doc currency)`; else → `match_suggestions` row (`state = 'open'`), max 3 per transaction (highest scores).
5. `match_method`: `vs_amount` (VS exact + amount), `vs_only` (VS exact, partial/FX amount), `card_merchant_fuzzy` (name feature > 0 and `t.card_merchant` not null), `platform_statement` (payout/offset paths), `amount_date_counterparty` (otherwise).
6. `confidence = score` (3 decimals). Auto links have `confirmed_by = null`; user-confirmed or manual links set `confirmed_by`, `confirmed_at`.

Invariants (checked in a DB constraint trigger and in property tests):
- I1: per transaction, Σ `amount_account_currency` of links with `link_type` ∈ (`payment`, `refund`, `fee`, `platform_payout`) ≤ `|amount|` + 0.005. `offset` and `fx_difference` links are excluded (they record settlement evidenced by, not paid by, the transaction).
- I2: per document, Σ (payment + offset + platform_payout + fx_difference − refund) ≤ `amount_due` + `roundingToleranceCzk` (CZK) or + 1 % (foreign).
- I3: links never point to a document of a different org (RLS + FK) or to a non-eligible class.
- I4: re-running the matcher on unchanged data creates no new links or suggestions (idempotent).

`match_state` after a pass: `matched` if I1 sum reaches `|amount|` within tolerance or the transaction got a category with no document needed (`no_document_needed`); `partial` if some links; `unmatched` otherwise. `ignored` only by user or reversal.

Learning on user confirmation or manual link: upsert `counterparty_aliases` for the transaction's normalised counterparty account (`kind = 'account'`), merchant (`'merchant'`) and name (`'name'`) → `partner_id`, `confirmations + 1`; upsert `partner_bank_accounts` for a CZ account. On user unlink of an auto link: the suggestion is stored as `rejected`, the alias `confirmations` decrements (min 0), and the metric `matcher_auto_link_undone` increments (§10).

User links always win: re-runs never delete links with `confirmed_by` set. System links are deleted only by reversal, document deletion, reclassification to a non-eligible class, or a change of `amount_due`/`currency` that violates I2 (then the transaction returns to `unmatched` and is re-matched).

### 4.7 Special cases

#### 4.7.1 Partial payments and overpayments
- **Partial:** VS exact and `|t| < open_amount` → link `amount = |t|` (converted), `match_method = 'vs_only'`. The document stays partially paid (`paid_at` null) until the sum closes. Score per §4.6.3 (auto with VS + partial + date → σ(2.5) = 0.92).
- **Overpayment:** VS exact and `|t| > open_amount` + tolerance → link `open_amount`; `t.match_state = 'partial'`; review question `overpayment` ("Přeplatek 500 Kč: vrátit, nebo započíst?"). The residual is never matched automatically to another document.
- **Closing residual (foreign currency):** if after a link the document's residual ≤ 1 % of `amount_due` (foreign) → add an `fx_difference` link for the residual (`amount = residual`, `amount_account_currency = 0`) on the same transaction. CZK residual ≤ `roundingToleranceCzk` needs no link (the paid rule tolerates it, `04 §4`).

#### 4.7.2 Multi-document payments
For a still-unmatched `t` whose counterparty resolves to partner `p` (account match, alias, VS of one of `p`'s documents, or ≥ 2 document numbers of `p` in the message):
1. Take `p`'s open eligible documents of the same direction, oldest due first, up to `subsetSum.maxDocs`.
2. Integer subset-sum in haléře over `open_amount` (account currency) with target `|t|` and tolerance `roundingToleranceCzk`, subset size ≤ `maxSubsetSize` (DP over sums; ≤ 20 × 6 is trivial).
3. Exactly one subset → score = σ(bias + amountExact + accountMatch/name/alias contributions + dateMax × mean f_date) capped at 0.89, uncapped (and `msgDocNumber` added) if the message contains every document number of the subset. Several subsets → keep the one with the oldest maximum due date, cap 0.75 (suggestion only).
4. Links: one per document with its `open_amount`; the rounding residual goes on the last document by due date.

#### 4.7.3 Refunds
- Incoming from a supplier (counterparty resolves to the partner of a received document): first candidates are that partner's `received_credit_note`s (`link_type = 'refund'` is **not** used here: paying out a credit note is a `payment` link on the credit note). If none: a refund of an earlier **paid** received document with equal amount (card refund: same merchant, ≤ 120 days) → `link_type = 'refund'` on the original document, and review question `refund_without_credit_note` (radar item "chybí opravný doklad").
- Outgoing to a customer: candidates are `issued_credit_note`s of that customer (`payment` link); else a refund (`refund` link) on the paid issued invoice + radar item.
- A `refund` link reduces the original document's paid sum; `paid_at` is recomputed (§4.7.10).

#### 4.7.4 Tax and insurance payments
Rule table **`bank.authority_accounts`** (new key, data in `packages/domain/rules/cz/<year>.ts`, effective-dated, each entry with `source` URL and `verified_at` per `06 §2`):

```ts
{ kind: 'fu', bank_code: '0710', prefix_map: { '705': 'tax_vat_payment', '721': 'tax_income_payment', /* paušální daň: */ '2866'?: 'tax_pausal_advance' },
  vs_rule: 'dic_digits_or_rc' }
{ kind: 'cssz', bank_code: '0710', accounts: [ /* per OSSZ */ ], category: 'ins_social_own', vs_rule: 'cssz_assigned' }
{ kind: 'insurer', insurer: 'vzp'|'vozp'|'cpzp'|'ozp'|'zpskoda'|'zpmv'|'rbp', accounts: [...], category: 'ins_health_own', vs_rule: 'rc_or_assigned' }
{ kind: 'municipality', code: 'praha3', accounts: [...], category: 'pt_tourist_fee' }
```

Facts available: VAT is paid to the FÚ account with prefix 705 and VS = DIČ (`research/czech-tax-filings.md` "VAT is paid to the FÚ account with prefix 705 and VS = DIČ [I]"); paušální daň to the FÚ account with prefix 2866 (same file, §"Flat-tax regime" [O]). The income-tax prefix, the ČSSZ/OSSZ and insurer account lists and the municipal accounts are **[verify]** and must be filled from official pages before release (A12). Recognition order:
1. `counterparty_bank_code = '0710'` and prefix in the FÚ map → that category; VS equal to the org's DIČ digits (or IČO) raises nothing further but is recorded.
2. Counterparty account in a ČSSZ/insurer/municipality list → that category.
3. Fallback by name (normalised) containing `FINANCNI URAD`, `CSSZ`, `OSSZ`, `PSSZ`, `ZDRAVOTNI POJISTOVNA` or an insurer name → **suggestion** of the category (not auto).
4. Result: `transactions.category_code` set, `match_state = 'no_document_needed'`; additionally, if a `government_filing` document (own filed DPHDP3, municipal tourist-fee report) has `amount_due = |t|` within the filing window → `payment` link (`match_method = 'amount_date_counterparty'`, or `vs_amount` when the VS rule matches). Event `bank.authority_payment_recognised { transactionId, categoryCode, period? }` lets M09 mark the matching `obligations` row paid.
5. Incoming from `0710` FÚ accounts → `income_vat_refund` suggestion (overpayment refund).

#### 4.7.5 Bank fees, interest, ATM, private
- Fees: GPC/CAMT bank transaction type or message matching `/^(poplatek|cena za|vedení účtu|měsíční poplatek|fee)/i` with no counterparty account, or counterparty = the bank's own fee account → `exp_bank_fees`, `no_document_needed` (the statement is the evidence).
- Interest: `/úrok|interest/i`, incoming, no counterparty → `income_interest`; outgoing tax on interest (`daň z úroku`) → `tax_other_fees`.
- ATM: `/výběr z bankomatu|výběr hotovosti|ATM/i` or card transaction type ATM → `transfer_cash_withdrawal`, `no_document_needed`. Cash deposits → `transfer_cash_deposit`.
- Private: the user can mark any transaction private (`private_expense` outgoing / `income_owner_deposit` incoming / `private_withdrawal` for transfers to a private account); `no_document_needed`. A counterparty alias learned from a "private" answer suggests (never auto) the same next time.

#### 4.7.6 Transfers between own accounts
Outgoing `t1` on account A with counterparty = another own `money_accounts` row B (account/IBAN match), and incoming `t2` on B with equal absolute amount, `|Δ booked_on| ≤ 3` days (and counterparty = A when present) → set `paired_transaction_id` on both, `category_code = 'transfer_own_accounts'`, `match_state = 'no_document_needed'`. If B is not imported yet, `t1` alone gets the category with the suggestion state; `t2` pairs when it arrives. Platform payouts: a `payout` row on a platform account pairs the same way with the bank incoming (counterparty name matches the platform's known payout names, amount equal, ±5 days).

#### 4.7.7 Platform payouts, offsets and fees
- **Payout ↔ statement document.** Incoming bank `t` vs `platform_statement`/`settlement_statement` `d` whose `amount_due` (= net payout, M02 contract) equals `t` → `link_type = 'platform_payout'`, `match_method = 'platform_statement'`.
- **Offset (netting).** A received document settled by deduction instead of a transfer: (a) `d.payment_method = 'platform_offset'`, or (b) a `document_links` row `same_period_reconciles`/`supports` between the statement and `d` (the property-manager invoice, golden set: "20 % správce" = manager invoice total incl. VAT), or (c) Booking: Σ platform `fee` rows of the invoice's `service_period` equals the invoice `amount_due` within 1 CZK. Then, when the related payout is linked, create an `offset` link from the payout transaction to `d` (`amount = open_amount(d)`, `amount_account_currency = 0`, `match_method = 'platform_statement'`). `d.paid_at` = the payout's `booked_on`.
- **Fees without invoice** (`fees_invoiced = false`): platform `fee` rows → `exp_payment_fees`, `no_document_needed`, evidence = the statement import.
- **Sales** on platform accounts match issued invoices or `platform_statement` documents like bank incomings (VS = order number / reservation id via `raw.platform_ref` against `documents.order_number`, `variable_symbol`).

#### 4.7.8 FX
Covered in §4.6.2/§4.6.3: exact match on `amount_original` when the bank provides the original currency; otherwise ČNB rate on `booked_on` with 2 % (transfer) / 3 % (card) tolerance (`research/bank-connectivity.md §5.3`). The link stores both amounts; the realised CZK amount is `amount_account_currency` (M04 uses it for the cash-basis entry). No FX revaluation is computed.

#### 4.7.9 Documents paid by card or cash (`document_evidence`)
- **Cash** (`payment_method = 'cash'`, or a receipt with cash wording): on `ready`, create a transaction on the "Pokladna" cash account (`source = 'document_evidence'`, `booked_on = issue_date`, `amount = −amount_due`, `external_id = 'doc:' + id`) and a `payment` link with `match_method = 'document_evidence'`, `confidence = 1`.
- **Card** (`payment_method = 'card'` or `is_paid_per_document`): wait `cardEvidenceWaitDays` for a bank/card transaction. Daily job `bank.evidence.card_fallback`:
  - if a business bank/card account has statement coverage (`statement_imports` period) including `issue_date + cardEvidenceWaitDays` and nothing matched → review question `card_payment_not_found` ("Platba kartou 1 198 Kč v IKEA není na výpisu. Platili jste jinou kartou?"); answer "jinou/soukromou kartou" → evidence transaction on the account "Platby kartou (bez výpisu)" (type `card`);
  - else (no coverage) → evidence transaction immediately.
- **Upgrade:** when a real transaction later scores ≥ `autoThreshold` for a document whose only link is `document_evidence`, the matcher deletes the evidence link and its synthetic transaction (audit-logged) and links the real one; `paid_at` is recomputed. This prevents double counting in the M04 ledger.

#### 4.7.10 `paid_at`
Pure `computePaidAt(doc, links)`:
1. Order links by the transaction `booked_on`, then link `created_at`.
2. Running sum `S` of (payment + offset + platform_payout + fx_difference − refund) in document currency.
3. `paid_at` = `booked_on` of the first link after which `S ≥ amount_due − tol` (`tol` = `roundingToleranceCzk` for CZK, 1 % of `amount_due` for foreign currencies); later `S` dropping below (refund) → `paid_at = null` and event.
4. `amount_due ≤ 0` (e.g. "Nehraďte", fully prepaid) → `paid_at` = issue_date via a `document_evidence` link of amount 0 only if `is_paid_per_document`; else null.
Written by job `bank.paid_at.recompute` (idempotent) after every link change; emits `document.paid_at_changed` (M04 rebuilds the affected `tax_ledger_entries`).

### 4.8 Missing-documents radar

`radarItems(ctx, { from, to })` returns:
- **`missing_document`**: transactions with `amount < 0`, `match_state ∈ ('unmatched','partial')`, money account `is_business`, no category, `booked_on ≤ today − radarGraceDays`, not `is_pending`. Amount shown = unexplained remainder.
- **`missing_credit_note`**: refunds linked with `link_type = 'refund'` (§4.7.3).
- **`unexplained_income`**: incoming business transactions unmatched after the grace period (informational: "Příjem bez faktury").
- **`expected_invoice`** (hint only): an open `expected_documents` row (05 §4, created by M01 for order confirmations and proformas); shown next to a `missing_document` item when `partner_id` and `expected_amount` (± 1 %) agree ("Máme jen objednávku Alza 2 105 Kč, faktura chybí"). When the user uploads the invoice from the radar, M01 fulfils the expected document.
- **`substitute_unpaid`** (warning): a bookable document with `substitute_reason` set and no payment link after the grace period (04 §2.2a: a náhradní doklad counts for income tax with a warning until a payment is linked). Action: "Vybrat platbu" (manual link). Linking resolves the M03 warning via `bank.link_created`.

Each item carries a guessed partner (alias → partner; else counterparty name; else merchant) and actions:
1. **Nahrát doklad** (upload; the new document triggers `bank.match.document`).
2. **Vybrat z dokladů** (manual link from a searchable list of open documents, ranked by score).
3. **Je to soukromé** → private category (§4.7.5).
4. **Doklad nebude** → user picks a category (`exp_*`); `match_state = 'no_document_needed'`; flagged for the accountant as "bez dokladu" with the user's note (M10 lists these).
5. **Požádat dodavatele** → `draftSupplierRequest(txId)`: recipient = most recent `inbound_emails.from_address` that delivered a document of that partner, else an address on `partners.email_domains` (`fakturace@`/`info@` are **not** guessed; the field is left empty for the user). Subject and body from i18n templates (§7.3) with transaction date, amount, VS, card last 4 / merchant, and the org's invoicing details (name, IČO, DIČ, address from the taxpayer profile) so the supplier can issue a proper tax document. Delivered as `mailto:` + "Kopírovat text"; the app does not send e-mail itself in Phase 2. Item state `requested_at` is stored on the review question's `answer`.

Radar items are materialised as `review_questions` (`kind = 'missing_document'`, `transaction_id` set) by `bank.radar.refresh` so they appear in the Inbox review queue and in M10 completeness; they auto-resolve when the transaction becomes `matched`/`no_document_needed`/`ignored`.

### 4.9 Paying own bills

#### 4.9.1 Pre-payment checks
`prePaymentChecks(ctx, documentIds)` per document, each check → `ok | info | warning | blocking`:

| Check | Logic | Severity |
|---|---|---|
| `ALREADY_PAID` | `paid_at` not null or `open_amount ≤ tol` | blocking |
| `NO_ACCOUNT` | no `pay_to_account` and no `partner_bank_accounts` | blocking (QR/ABO) |
| `ACCOUNT_INVALID` | mod-11 / IBAN check fails (`research/registries-and-formats.md §6`) | blocking |
| `UNRELIABLE_PAYER` | partner with CZ DIČ: CRPDPH `getStatusNespolehlivySubjektRozsirenyV2` (`research/registries-and-formats.md §2.2–2.4`), result ≤ 1 h old, `nespolehlivyPlatce = 'ANO'` | `blocking` if org `vat_status = 'platce'` (§109 liability), else `warning` |
| `ACCOUNT_NOT_PUBLISHED` | supplier `typSubjektu = 'PLATCE_DPH'`, org is `platce`, and the normalised pay-to IBAN is not among `zverejneneUcty` (active: no `datumZverejneniUkonceni`) | `blocking` when the amount exceeds the threshold defined by rule `vat.ruceni_cash_threshold` (`04 §7`, `06 §2`; exact §109 multiplier **[verify]**), else `warning` |
| `ACCOUNT_CHANGED` | pay-to account differs from every account used in earlier confirmed payments to this partner | warning ("Účet se liší od minulých plateb. Ověřte, že nejde o podvod.") |
| `REGISTRY_UNAVAILABLE` | CRPDPH status 2/3 or timeout (00:00–00:10 outage) | warning ("Nepodařilo se ověřit"), never blocking (`06 §1`) |
| `FOREIGN_CURRENCY` | currency ≠ CZK | info: QR/ABO not offered (SEPA later) |

"Blocking" hides the QR code until the user ticks "Rozumím, přesto chci zaplatit" (audit-logged). We never prevent the user from paying; we prevent paying unknowingly. The check result and timestamp are snapshotted on `payment_order_items.checks`; the UI says "Ověřeno dnes 10:42. Pokud platíte později, ověříme znovu." (§109 turns on the payment date, `research/registries-and-formats.md §2.4`).

#### 4.9.2 QR Platba (SPAYD)
Pure `buildSpayd()` per `research/registries-and-formats.md §5.1`: `SPD*1.0*ACC:{IBAN}[+{BIC}]*AM:{amount, dot, 2 dp}*CC:CZK*X-VS:{vs}*[X-KS:{ks}*][X-SS:{ss}*][DT:{YYYYMMDD due, omitted if in the past}*]MSG:{…}*[RN:{…}*]CRC32:{hex}`. Rules: `AM` = `open_amount`; VS = document VS (digits, ≤ 10) else digits of the document number if ≤ 10 else omitted; `MSG` ≤ 60 = "Úhrada {document_number}", `RN` ≤ 35 = partner name, both ASCII-folded, `*` → `%2A`; BIC from the ČNB bank code list (§6.3 there); CRC32 over the header and all other attributes sorted by key (§5.1). QR rendered with error correction **M**, labelled "QR Platba", ≥ 23 mm in print. Keys order in the string: alphabetical except the header (makes the output deterministic for tests).

#### 4.9.3 ABO batch export
`buildAboBatch({ sourceAccount, dueDate, items[] })` produces the domestic payment-order file (KPC/ABO) the user uploads to internet banking. Validation per item (mirrors Competitor A's checks, internal research (not published) `payments.abo_validation_errors`): `alreadyPaid`, `missingBankAccount`, `invalidBankAccount`, `varSymTooLong` (> 10), `invalidCurrency` (only CZK), `unableToPayNegativeAmount`, and **one file per source account and currency**. Any pre-payment `blocking` check without the user's acknowledgement excludes the item.
Structure (header `UHL1` record, group header, item lines, group and file trailers) follows the banks' "ABO formát pro tuzemský platební styk" description. The exact record layout is **[verify against the bank import specs of Fio, ČSOB and KB]** (the research files document the statement format 074/075, not the payment-order format); the writer is table-driven (`abo/layout.ts`) so a correction is a data change. Encoding windows-1250, CRLF, amounts in haléře. The file name is `prikazy_{account}_{YYYYMMDD}.kpc`; `payment_orders`/`payment_order_items` record what was exported. Exporting does **not** mark documents paid; payment is confirmed only by a matched transaction.

## 5. Data

### 5.1 Read / written (existing tables, `05`)

| Table | Read | Written |
|---|---|---|
| `money_accounts` | all columns | insert/update (`import_format`, `notice_parser`) |
| `transactions` | all | insert, merge-update, `category_code`, `match_state`, `raw` |
| `payment_links` | all | insert/delete (system), insert (user) |
| `documents` | class, status, direction, partner_id, numbers, symbols, dates, currency, totals, `amount_due`, `payment_method`, `pay_to_account`, `is_paid_per_document`, `business_flag` | `paid_at` only |
| `document_lines` | for platform/settlement breakdowns (§4.7.7) | — |
| `document_links` | `supports`, `same_period_reconciles`, `fulfills` | — |
| `partners`, `partner_bank_accounts` | all | `partner_bank_accounts` upsert (learning), `published_in_crpdph`, `checked_at` |
| `inbound_emails` | `purpose='bank_notice'` | `processed_at` |
| `source_files` | sha256, mime, storage | — |
| `fx_rates`, `registry_cache` | rates, CRPDPH cache | via `packages/registries` |
| `review_questions` | | insert/resolve (kinds §3) |
| `obligations` | for filing windows | via event (M09 writes) |
| `notifications`, `audit_log` | | insert |

### 5.2 Schema
Merged into 05 on 2026-10-18; see 05 §6 `statement_imports`, `transactions` (statement_import_id, dedupe_hash, paired/reversal ids, is_pending, counterparty_partner_id, matched_at), `payment_links` (matcher_version, created_by), `match_suggestions`, `counterparty_aliases`, `import_mappings` (the proposed `import_mapping_profiles` merged with M01's table, `kind='bank_statement'`), `payment_orders`, `payment_order_items`, the `review_questions.transaction_id` foreign key; `bank_connections` is Later (05 §9.1). Rule key `bank.authority_accounts`: 06 §2.1.

## 6. Interfaces

### 6.1 Types and public functions (`packages/bank`)

```ts
export type StatementFormat = 'gpc'|'camt053'|'mt940'|'fio_json'|'csv_fio'|'csv_cs'|'json_cs_george'|'csv_csob'|'csv_kb'
  |'csv_rb'|'csv_airbank'|'csv_moneta'|'csv_unicredit'|'csv_mbank'|'csv_airbnb'|'csv_booking'|'csv_comgate'|'csv_gopay'
  |'csv_paypal'|'csv_zasilkovna'|'csv_generic';
export interface CanonicalTx {
  externalId?: string; bookedOn: IsoDate; valueDate?: IsoDate;
  amount: Money; amountOriginal?: Money;                       // signed, same sign
  counterparty: { name?: string; account?: string; bankCode?: string; iban?: string; bic?: string };
  vs?: string; ks?: string; ss?: string; message?: string; cardMerchant?: string; cardLast4?: string;
  isReversal?: boolean; isPending?: boolean; bankTxCode?: string;
  platformKind?: 'sale'|'fee'|'payout'|'refund'|'adjustment'; platformRef?: string;
  raw: Record<string, unknown>;
}
export interface ParsedStatement {
  format: StatementFormat; parserVersion: number; profile?: string;
  account?: { number?: string; bankCode?: string; iban?: string; currency?: string };
  periodFrom?: IsoDate; periodTo?: IsoDate; statementNumber?: string;
  openingBalance?: Money; closingBalance?: Money; controlDebit?: Money; controlCredit?: Money;
  txs: CanonicalTx[]; warnings: ParseWarning[];
}
export interface ParseWarning { line?: number; code: string; raw?: string }
export interface StatementParser { format: StatementFormat; version: number;
  detect(s: DetectSample): number; parse(bytes: Uint8Array, o: ParseOptions): ParsedStatement }
export function detectStatementFormat(bytes: Uint8Array, filename?: string, hints?: DetectHints): DetectionResult;
export function parseStatement(bytes: Uint8Array, d: DetectionResult, o?: ParseOptions): ParsedStatement;
export function applyMapping(rows: string[][], m: CsvMapping): ParsedStatement;          // wizard
export function computeDedupeHash(accountId: string, t: CanonicalTx, seq: number): string;
export interface NoticeParseResult { parserId: string; parserVersion: number; accountHint: string;
  tx: CanonicalTx; balance?: Money; confidence: 1 }                                   // deterministic only
export function parseBankNotice(e: { from: string; subject: string; text: string; html?: string }): NoticeParseResult | { unknown: true; reason: string } | { forwardingConfirmation: { url: string } };

// matcher (pure)
export function generateCandidates(t: TxView, docs: DocView[], ctx: MatchContext): Candidate[];
export function scoreCandidate(t: TxView, d: DocView, ctx: MatchContext, cfg?: MatcherConfig): CandidateScore;
export function assign(scores: CandidateScore[], cfg?: MatcherConfig): { links: LinkDraft[]; suggestions: SuggestionDraft[] };
export function findSubsetSum(targetHalere: bigint, items: { id: string; halere: bigint }[], tolHalere: bigint, maxSize: number): string[][];
export function classifyByRules(t: TxView, rules: AuthorityRules, own: OwnAccount[]): RuleOutcome | null;
export function computePaidAt(doc: DocAmountView, links: LinkView[], cfg?: MatcherConfig): IsoDate | null;
export function normMerchant(s: string): string;
export function tokenSetRatio(a: string, b: string): number;                           // 0..1

// payments (pure)
export function buildSpayd(i: { iban: string; bic?: string; amount: Money; vs?: string; ks?: string; ss?: string;
  dueDate?: IsoDate; message?: string; recipientName?: string }): string;
export function buildAboBatch(i: AboBatchInput): { bytes: Uint8Array; fileName: string; errors: AboItemError[] };

// services (I/O, apps/worker + apps/web server actions)
export function importStatement(ctx: TenantCtx, i: { sourceFileId: string; moneyAccountId?: string;
  format?: StatementFormat; mappingId?: string }): Promise<ImportResult>;
export function runMatch(ctx: TenantCtx, i: { transactionIds?: string[]; documentId?: string; sweep?: boolean }): Promise<MatchRunResult>;
export function linkManually(ctx: TenantCtx, i: { transactionId: string; documentId: string; amount?: Money; linkType?: LinkType }): Promise<void>;
export function decideSuggestion(ctx: TenantCtx, id: string, d: 'accept'|'reject'): Promise<void>;
export function categorizeTransaction(ctx: TenantCtx, txId: string, categoryCode: string, note?: string): Promise<void>;
export function radarItems(ctx: TenantCtx, p: { from: IsoDate; to: IsoDate }): Promise<RadarItem[]>;
export function listMissingDocuments(orgId: string, p: { year: number } | { from: IsoDate; to: IsoDate }): Promise<{ count: number; sumAbs: Money; items: RadarItem[] }>; // used by M09 §4.11 (kind = 'missing_document' only)
export function draftSupplierRequest(ctx: TenantCtx, txId: string): Promise<{ to?: string; subject: string; body: string; mailto: string }>;
export function prePaymentChecks(ctx: TenantCtx, documentIds: string[]): Promise<PaymentCheckResult[]>;
```

### 6.2 Jobs (pg-boss; payloads validated with zod; idempotency key per ADR-003)

```ts
export const BankJobs = {
  'bank.import.statement':   z.object({ orgId: z.string().uuid(), sourceFileId: z.string().uuid(), moneyAccountId: z.string().uuid().optional(), format: z.string().optional(), mappingId: z.string().uuid().optional() }),
  'bank.notice.parse':       z.object({ orgId: z.string().uuid(), inboundEmailId: z.string().uuid() }),
  'bank.match.transactions': z.object({ orgId: z.string().uuid(), transactionIds: z.array(z.string().uuid()).min(1).max(5000) }),
  'bank.match.document':     z.object({ orgId: z.string().uuid(), documentId: z.string().uuid(), revision: z.number().int() }),
  'bank.match.sweep':        z.object({ orgId: z.string().uuid() }),                       // nightly 02:30 Europe/Prague
  'bank.paid_at.recompute':  z.object({ orgId: z.string().uuid(), documentIds: z.array(z.string().uuid()).min(1) }),
  'bank.evidence.card_fallback': z.object({ orgId: z.string().uuid() }),                   // daily 03:00
  'bank.radar.refresh':      z.object({ orgId: z.string().uuid() }),
  'bank.fio.sync':           z.object({ orgId: z.string().uuid(), connectionId: z.string().uuid() }),   // Later
  'bank.fio.expiry_reminder':z.object({ orgId: z.string().uuid(), connectionId: z.string().uuid(), daysLeft: z.number().int() }),
};
```
Idempotency keys: `{org}:bank.import:{sourceFileId}:{account}`, `{org}:bank.notice:{inboundEmailId}`, `{org}:bank.match.doc:{documentId}:{revision}:{matcherVersion}`. Failures: retry 3× with exponential backoff, then dead-letter + Sentry; a failed import sets `statement_imports.state = 'failed'` with `errors`.

### 6.3 API routes (REST `/api/v1`, same handlers as server actions)

| Method | Route | Purpose |
|---|---|---|
| GET/POST/PATCH | `/money-accounts`, `/money-accounts/{id}` | list/create/update |
| POST | `/bank/imports` `{sourceFileId, moneyAccountId?}` | 202 `{importId}` |
| GET | `/bank/imports/{id}` | state, counts, warnings, `needs_mapping` preview |
| POST | `/bank/imports/{id}/mapping` `{mapping, save}` | wizard result → re-run import |
| GET | `/transactions?account=&from=&to=&state=` | list with links and suggestions |
| POST | `/transactions/{id}/links` `{documentId, amount?}` | manual link |
| DELETE | `/payment-links/{id}` | unlink (system or user) |
| POST | `/match-suggestions/{id}/accept`, `/reject` | decide |
| POST | `/transactions/{id}/category` `{categoryCode, note?}` | no-document categorisation / private |
| POST | `/transactions/{id}/ignore` | ignore |
| GET | `/radar?from=&to=` | radar items |
| GET | `/transactions/{id}/supplier-request` | e-mail draft |
| POST | `/payments/checks` `{documentIds}` | pre-payment checks |
| POST | `/payments/qr` `{documentId, acknowledgeRisk?}` | `{spayd, svg, checks}` |
| POST | `/payments/abo` `{moneyAccountId, dueDate, documentIds, acknowledgeRisk?}` | file download + errors |
| POST/DELETE | `/bank/connections/fio` | Later |

Accountant role: GET only (RLS `05 §10`).

### 6.4 Events (pg-boss topics, consumed by M06/M09/M10)
`transactions.imported {orgId, importId, accountId, txIds}` (name used by M09), `bank.link_created {linkId, documentId, transactionId, method, confidence}`, `bank.link_removed {…}`, `document.paid_at_changed {documentId, paidAt|null}`, `bank.authority_payment_recognised {transactionId, categoryCode, period?}`, `bank.radar_changed {orgId, count}`.

## 7. UX touchpoints

No new top-level screen (`06 §6`). Placement: **Přehled** card "Banka" (balances, last import, unmatched count) → sub-view "Platby"; **Inbox** review queue receives `confirm_match`, `missing_document`, `overpayment`, `card_payment_not_found` questions; **Nastavení → Účty a banka** (accounts, `+banka` address, import, mapping profiles); **Pro účetní** shows the radar in completeness (M10). Dropping a statement file anywhere in Inbox routes it here.

### 7.1 Copy (cs source, i18n keys)

| Key | Czech |
|---|---|
| `bank.card.title` | Banka |
| `bank.card.unmatched` | {count, plural, one {# platba čeká na spárování} few {# platby čekají na spárování} other {# plateb čeká na spárování}} |
| `bank.import.done` | Načteno {new} nových pohybů, {dup} už jsme měli. Spárováno {matched}. |
| `bank.import.balance_mismatch` | Zůstatek na výpisu nesedí ({diff}). Nechybí nějaký výpis? |
| `bank.import.pdf_instructions.airbank` | PDF výpis neumíme přečíst spolehlivě. V Air Bank zvolte Historie plateb → Exportovat → CSV a nahrajte soubor sem. |
| `bank.import.wizard.title` | Pomozte nám přečíst tento soubor |
| `bank.import.wizard.hint` | Označte, ve kterém sloupci je datum a částka. Příště už to poznáme sami. |
| `bank.notice.address` | Upozornění z banky posílejte na: {address} |
| `bank.notice.forwarding_confirm` | Váš e-mail chce potvrdit přeposílání. Klikněte na odkaz: {url} |
| `bank.notice.unknown` | Upozornění z {bank} jsme nerozpoznali. Spárujeme je z výpisu. |
| `bank.match.reason.vs` | Sedí variabilní symbol {vs} |
| `bank.match.reason.amount` | Sedí částka {amount} |
| `bank.match.reason.account` | Platba šla na účet dodavatele |
| `bank.match.reason.merchant` | Obchodník „{merchant}“ odpovídá dodavateli {partner} |
| `bank.match.question` | Je platba {amount} ze dne {date} za doklad {number} od {partner}? |
| `bank.match.accept` / `.reject` | Ano, spárovat / Ne |
| `bank.radar.title` | Chybí doklad |
| `bank.radar.item` | {date} · {amount} · {counterparty} |
| `bank.radar.hint_order` | Máme jen objednávku {partner} na {amount}. Faktura zatím nepřišla. |
| `bank.radar.action.upload` / `.pick` / `.private` / `.none` / `.request` | Nahrát doklad / Vybrat z dokladů / Je to soukromé / Doklad nebude / Požádat dodavatele |
| `bank.request.subject` | Žádost o daňový doklad k platbě {amount} ze dne {date} |
| `bank.request.body` | Dobrý den,\n\ndne {date} jsme Vám zaplatili {amount}{vsLine}. Prosíme o zaslání daňového dokladu (faktury) na tuto adresu.\n\nFakturační údaje: {name}, IČO {ico}{dicLine}, {address}.\n\nDěkujeme,\n{name} |
| `bank.overpayment.question` | Zákazník zaplatil o {diff} víc. Vrátíte to, nebo to započtete? |
| `bank.card_not_found.question` | Platbu kartou {amount} u {partner} jsme na výpisu nenašli. Platili jste jinou nebo soukromou kartou? |
| `bank.pay.checks.ok` | Dodavatel je spolehlivý plátce a účet je zveřejněný. |
| `bank.pay.checks.unreliable` | Pozor: dodavatel je nespolehlivý plátce DPH. Při platbě můžete ručit za jeho DPH. |
| `bank.pay.checks.not_published` | Pozor: účet {account} není zveřejněný v registru plátců DPH. |
| `bank.pay.checks.changed` | Účet se liší od minulých plateb. Ověřte ho u dodavatele. |
| `bank.pay.checks.unavailable` | Registr se teď nepodařilo ověřit. Zkusíme to znovu. |
| `bank.pay.checks.verified_at` | Ověřeno {time}. Pokud platíte později, ověříme znovu. |
| `bank.pay.qr.label` | QR Platba |
| `bank.pay.abo.done` | Soubor s {count} příkazy je připraven. Nahrajte ho do internetového bankovnictví. |
| `bank.fio.expiry` | Přístup k Fio vyprší za {days} dní. Vygenerujte nový token. |

### 7.2 Interaction rules
- One tap to confirm a suggestion; the reasons (§4.6.3 features) are shown as 1–3 short lines, never as a score number. "Proč?" reveals the features.
- Transaction list default filter: "Čeká na vás" (suggestions + radar). No accounting terms ("párování" is acceptable; avoid "likvidace").
- After a manual link, a toast "Příště spárujeme platby z účtu {account} automaticky." when an alias was learned.

## 8. Edge cases and failure modes

1. **Same amount, same supplier, no VS (monthly rent twins):** margin rule → suggestion only (synthetic case O14).
2. **Card posting lag and weekends:** card window plateau ±1 day, linear to 7 days.
3. **One card receipt photographed twice (golden IKEA NFC/NFD):** the duplicate document has status `duplicate` and is not a candidate.
4. **VS with leading zeros / document number with letters** (`FV2026-0815` vs VS `20260815`): `docKeys` normalisation.
5. **Notice and statement of the same movement:** merge rule (§4.5); a notice arriving after the statement is skipped by the same rule in reverse (statement row exists with external id → the notice's hash differs, so the merge check also runs for `email_notice` inputs against existing statement rows: same criteria → drop the notice, `tx_duplicate++`).
6. **ČSOB/UniCredit without unique ids:** hash with `seq`; re-export with a different message truncation produces duplicates only if the message prefix changes → the merge check (step 3) also applies between two `statement_file` rows lacking external ids, with `|Δdate| = 0` and equal VS/account/amount.
7. **Statement for a different account than selected:** 074/`:25:`/IBAN mismatch → `needs_account`, the user confirms or creates the account.
8. **Overlapping statement periods:** dedupe handles rows; balance check uses the import's own balances.
9. **Storno without the original** (original before the first import): warning, no automatic action.
10. **Foreign-currency account (EUR) paying a CZK invoice:** account currency EUR, doc CZK → convert open amount by ČNB rate; tolerance 2 %.
11. **Invoice amount changes after linking (credit note or correction):** I2 violation → system links removed and re-matched; user links kept and a review question "Doklad se změnil, platba už nesedí" is created.
12. **Document reclassified to `order_confirmation` after linking:** links removed; transaction back to the radar with the `expected_invoice` hint.
13. **Private account accidentally imported:** user marks the account `is_business = false`; its transactions leave the radar and M10 counts.
14. **CRPDPH outage 00:00–00:10:** `REGISTRY_UNAVAILABLE` warning, retry once after 15 min.
15. **Platform payout with several reservations and a fee invoice from another month:** offsets only when sums match within 1 CZK; otherwise a suggestion "Započíst fakturu Booking.com za 07/2026?".
16. **Encoding garbage** (CP1250 read as UTF-8): the detector prefers valid UTF-8; if decoded text contains U+FFFD in > 0.5 % of characters, retry as windows-1250.
17. **Huge files** (> 50 000 rows): parse streaming; matcher batches of 5 000 transactions.
18. **Matcher crash mid-batch:** each transaction's links are written in one DB transaction; the job is idempotent and resumes.
19. **Two organisations (same user) with the same bank account:** accounts are per org; a notice binds only within the org of the address.
20. **Fake notice e-mail to the secret address:** requires a known account; DKIM-failed direct bank mail is dropped; notices are later confirmed by statements (reconciliation shows "jen z upozornění").

## 9. Acceptance criteria and test plan

### 9.1 Acceptance criteria
- **A1** GPC: a Fio GPC fixture with 074 + 40 × 075 (+078/079) parses with 0 warnings; every 075 field in §4.3.1 lands in the stated column; balance check `ok`; posting codes 1/2/4/5 give the specified signs and `is_reversal`.
- **A2** CAMT.053 `.001.02` and MT940 fixtures (Fio `cba_xml` and `.sta` of the same period) produce the same set of transactions (same `booked_on`, `amount`, VS, counterparty) as the Fio GPC of that period.
- **A3** Each CSV/JSON bank and platform profile is enabled only with ≥ 1 real anonymised export fixture in `packages/bank/fixtures/<format>/` and a test asserting row count, Σ amounts, and 3 spot-checked rows. Until then the profile is disabled and the file goes to the wizard.
- **A4** Each notice parser is enabled only with ≥ 3 fixtures per direction (incoming/outgoing/card), all parsed to the expected `NoticeParseResult`.
- **A5** Re-importing the same file creates 0 transactions (`duplicate_file`); importing a notice and then the statement row yields 1 transaction with the statement's `external_id`.
- **A6** Detector: on the fixture corpus (all formats + 20 non-statement CSVs) accuracy 100 % for supported formats and 0 false positives on non-statement files.
- **A7** Wizard: a CSV with unknown headers can be mapped; after saving, the next import of a file with the same header row needs no interaction.
- **A8** Synthetic set (§9.3): auto-match rate ≥ 95 % over the 446 auto-expected transactions (≥ 424 correct); **0** links with `confidence ≥ 0.90` that differ from the expected outcome over all 500; correct target among the top-3 suggestions for ≥ 98 % of the auto-expected transactions that were not auto-linked.
- **A9** Golden companion (§9.4): all G-cases produce the stated outcome.
- **A10** `computePaidAt`: property test — for random link sequences, `paid_at` is the booked date of the first prefix reaching `amount_due − tol`, and null if the final sum is below.
- **A11** Invariants I1–I4 hold in property tests (fast-check, 10 000 runs) over random documents/transactions.
- **A12** `bank.authority_accounts` for the current year has every entry sourced and `verified_at` set; the rule test asserts the FÚ 705 → `tax_vat_payment` mapping.
- **A13** SPAYD: `buildSpayd` output for the example in `research/registries-and-formats.md §5.1` equals the expected string with a correct CRC32; output decodes in two independent QR readers (zxing-wasm test).
- **A14** ABO: generated files for 3 fixtures validate against the table-driven layout; manual checklist: imported successfully into Fio, ČSOB and KB internet banking test/real accounts (pilot) before the feature flag is removed.
- **A15** Pre-payment checks with a fake CRPDPH client: unreliable → blocking for `platce`, warning for `neplatce`; unpublished account above `vat.ruceni_cash_threshold` → blocking; outage → warning only.
- **A16** Radar: an outgoing unmatched business transaction appears after `radarGraceDays` and disappears within one job run after a matching document arrives.
- **A17** Performance: matching 5 000 transactions against 20 000 open documents completes in < 60 s on the staging worker.

### 9.2 Test plan
- **Unit (Vitest):** each parser on fixtures; normalisers (amount, VS, account, IBAN, merchant); `scoreCandidate` table tests for every feature row; `assign` tie-breakers and margin; `findSubsetSum`; `computePaidAt`; `buildSpayd`; ABO writer; authority classification.
- **Property (fast-check):** invariants I1–I4; idempotency (`assign(assign-input)` twice → identical); dedupe hash stability under row reordering within a day (only `seq` changes when tuples are identical).
- **Integration (Postgres + pg-boss, `packages/testkit`):** import → match → paid_at → events; notice → statement merge; reversal; card evidence upgrade; RLS (accountant cannot write links).
- **E2E (Playwright):** upload an Air Bank CSV → 2 suggestions confirmed → 1 radar item → "Požádat dodavatele" opens a mailto with the expected subject; QR for an unpaid invoice shows checks and a QR.
- **Eval harness (M12):** the synthetic set runs nightly and on every matcher change; the report lists auto rate, false auto links, suggestion recall by case group. A matcher change that lowers any metric fails CI.

### 9.3 Synthetic 500-transaction test set

Generator `packages/testkit/bank/synthetic.ts`, seed `20261018`, deterministic. Output `testdata/bank-synthetic-v1/{documents.json, transactions.json, expected.json}` with an org profile (`platce`, quarterly), 6 money accounts (2 bank, 1 card, 1 cash, 2 platform: ComGate + property manager), ~60 partners with bank accounts, card descriptors and VS habits, and ~520 documents. `expected.json` per transaction: `{ txId, expect: 'link'|'links'|'category'|'transfer'|'suggest'|'radar'|'ignore', documentIds?, amounts?, categoryCode?, autoExpected: boolean }`.

| Group | Pattern (generation recipe) | n | Expected outcome | Auto-expected |
|---|---|---|---|---|
| **Outgoing** | | | | |
| O1 | domestic invoice paid by transfer, VS = invoice VS (30 % with leading zeros, 20 % VS = digits of `FV2026-0123`), amount exact, lag 0–20 d after issue | 85 | link `vs_amount` | yes |
| O2 | as O1, amount off by 0.01–1.00 Kč | 15 | link `vs_amount` | yes |
| O3 | no VS, counterparty account = `pay_to_account`, amount exact, unique open doc | 25 | link `amount_date_counterparty` | yes |
| O4 | no VS field, invoice number in message ("FA 2026123", "fakt.2026123") | 15 | link | yes |
| O5 | card CZK, receipt doc, merchant variants (`IKEA PRAHA ZLICIN`, `DECATHLON CZ 1234`, `ALZA.CZ`, `SUMUP *KAVARNA`), lag 0–3 d | 60 | link `card_merchant_fuzzy` | yes |
| O6 | card FX SaaS (USD/EUR): 10 with `amount_original` exact; 10 CZK only, partner alias confirmed ≥ 2 | 20 | link | yes |
| O7 | partial payments: 5 invoices × 2 instalments, VS exact | 10 | link `vs_only`, paid after 2nd | yes |
| O8 | one transfer pays 2–4 invoices: 4 with all numbers in message, 4 account only | 8 | links | 4 yes / 4 suggest |
| O9 | tax/insurance: FÚ 705 VAT (4, one linked to a filed DPHDP3 doc), paušál 2866 (2), ČSSZ (3), health (3) | 12 | category (+ link for 1) | yes |
| O10 | own transfers, outgoing legs | 6 | transfer | yes |
| O11 | bank fees | 6 | `exp_bank_fees` | yes |
| O12 | ATM withdrawals | 4 | `transfer_cash_withdrawal` | yes |
| O13 | unexplained (no document exists): 10 card, 6 transfers, 4 card to a partner that has only an order confirmation | 20 | radar (4 with `expected_invoice` hint) | no |
| O14 | twins: 4 pairs of open invoices same partner, same amount, no VS; one payment each | 8 | suggest (both docs listed) | no |
| O15 | decoys: amount equals an open invoice of a different partner, different account, no VS, date inside window | 6 | no auto link (suggest ≤ 0.89 allowed) | no |
| **Incoming** | | | | |
| I1 | issued invoice paid with VS + exact amount | 100 | link `vs_amount` | yes |
| I2 | known customer account, no VS, exact amount, unique | 20 | link | yes |
| I3 | platform payouts: 10 property-manager payouts ↔ settlement statement + offset of manager invoice; 10 ComGate payouts ↔ platform-account payout rows; 10 Booking payouts ↔ platform_statement | 30 | `platform_payout` (+ `offset`) / transfer | yes |
| I4 | own transfers, incoming legs | 6 | transfer | yes |
| I5 | refunds: 4 against a received credit note; 4 card refunds without credit note | 8 | link / `refund` + radar `missing_credit_note` | yes |
| I6 | interest | 4 | `income_interest` | yes |
| I7 | EUR invoices paid into the CZK account, VS exact, rate deviation 0.2–1.8 % | 8 | link `vs_only` + `fx_difference` residual | yes |
| I8 | overpayments, VS exact, +50…+2 000 Kč | 4 | link + `overpayment` question | yes |
| I9 | 2 incoming payments and their 2 storno rows | 4 | both `ignored`, links removed | yes |
| I10 | unexplained incoming | 14 | radar `unexplained_income` | no |
| I11 | VAT refund from FÚ 705 | 2 | suggest `income_vat_refund` | no |
| **Total** | | **500** | | auto-expected **446**, non-auto **54** |

Non-auto = O8 account-only (4) + O13 (20) + O14 (8) + O15 (6) + I10 (14) + I11 (2) = 54; auto-expected = 446. The generator asserts Σ n = 500, auto-expected = 446, and that every non-auto case has a plausible decoy candidate inside the date window. The exit threshold is therefore ≥ 424 correct auto outcomes (95 % of 446).

Additional suites (not counted in the 500): **dedupe** — 40 movements delivered as notice + statement (expect 40 rows), the same GPC imported twice (expect 0 new), 10 identical same-day coffees (expect 10 rows); **noise** — 5 % of O1/I1 cases get a ±1 day booking shift and a truncated counterparty name; metrics must still hold.

### 9.4 Golden-set companion fixture (P4)

`testdata/golden-v1/bank/p4-2026.json` (synthetic transactions written to fit the golden documents; amounts from the golden labels):

| Case | Transaction | Expected |
|---|---|---|
| G1 | transfer 11 600 Kč to the cleaning company, VS = invoice VS | `vs_amount` auto; CRPDPH check "not applicable" (non-payer) |
| G2 | transfer 8 150 Kč to the same account, no VS | auto via `accountMatch` + learned alias (after G1) |
| G3 | incoming payout from the property manager = "80 % majitele" of the Aug statement | `platform_payout` to the settlement statement; `offset` link to the manager invoice 12 960,84; manager invoice `paid_at` = payout date |
| G4 | outgoing 13 699,77 Kč to Booking.com B.V. (NL IBAN), message contains the invoice number | auto link (`msgDocNumber` + amount) |
| G5 | card −CZK with `amount_original` −10.46 USD, merchant `CLOUDFLARE` | `card_merchant_fuzzy` auto |
| G6 | card −CZK with `amount_original` −90.00 EUR, merchant `ANTHROPIC` | auto |
| G7 | card −26 990 Kč `APPLE.COM/CZ` (March) | auto |
| G8 | card −1 198 Kč `IKEA PRAHA`, booked 2 days after the receipt | auto, exactly one link (duplicate PDF not a candidate) |
| G9 | card −249 Kč `DECATHLON` | link; document `business_flag = 'personal'` → no radar, no business ledger effect |
| G10 | card −117 Kč `ALZA.CZ` | auto link to the Alza "Faktura" (`not_tax_document`) |
| G11 | card −2 105 Kč `ALZA.CZ` | **no link** to the order confirmation; radar `missing_document` with the `expected_invoice` hint |
| G12 | transfers 3 500 / 4 150 Kč to the Praha 3 account | `pt_tourist_fee`, linked to the municipal reports (`government_filing`), not in the radar |
| G13 | transfer 2 877 Kč to FÚ `705-…/0710`, VS = DIČ digits | `tax_vat_payment`, link to the filed DPHDP3 (Aug 2026), event `bank.authority_payment_recognised` |

## 10. Maintenance

| Source of change | Containment | Monitor | Effort/yr |
|---|---|---|---|
| Bank CSV/JSON layouts, notice templates | one small profile/parser per format, fixtures, wizard fallback | `bank_parser_failure_rate{format}` > 2 % over 7 days (`06 §3`); `bank_notice_unparsed{bank}` > 5/day | 1–3 days |
| GPC/CAMT/MT940 bank variants | profiles keyed by bank | same | included above |
| Authority accounts (FÚ prefixes, ČSSZ/insurer/municipal accounts) | rule table `bank.authority_accounts`, yearly check in the Annual Update Window | rule freshness (> 13 months) | 0.5 day |
| ČNB bank code list | monthly refresh job (`research/registries-and-formats.md §6.3`) | job failure | ~0 |
| CRPDPH endpoint | `packages/registries` (M03) | registry health | shared |
| Matcher quality | versioned config, synthetic set in CI | weekly: auto-link rate; **`matcher_auto_link_undone` / auto links > 1 %** → alert (proxy for false matches) | 0.5 day |
| Fio API (Later) | one client, contract tests | sync error rate, 409 rate | 0.5 day |

**Total: ~2–4.5 days/year**, mostly parser upkeep. It sits slightly above the 3-day guideline only when several banks change formats in one year; the wizard keeps users working meanwhile (`06 §5.6`).

## 11. Open questions
Consolidated in `22-open-questions.md`: L-01 (AIS licence for tokens), TA-16 (§109 threshold), T-14 (authority accounts), TA-17 (statement evidence for fees), T-15 (bank CSV headers and notice templates), T-16 (ABO layout). Resolved (22 §F): Fio token is Later (ADR-009 aligned); M02 writes the payout as `amount_due` / `due_date` (M02 §3); pending card authorisations are shown as "čeká na zaúčtování"; supplier requests stay `mailto:` + copy text.
