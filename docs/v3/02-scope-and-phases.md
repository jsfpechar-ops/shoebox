# 02: Scope and phases

**MVP first, prove it works, then expand.** Each phase ends with exit criteria that are checked in CI (tests + golden-set evaluation). Fable must not start a phase before the previous one passes. Module specs live in `modules/`. Tickets are in `backlog.md`.

```
Phase 0  Foundations
Phase 1  MVP: Scanner & Organizer   ← THE PRODUCT. Must be excellent before anything else.
Phase 2  MVP+: Accountant hand-off & payments (statement import, e-mail notices, matching, missing-docs radar)
Phase 3  Simple VAT (IO DPHDP3 → small payer DPHDP3 + KH + SH, only when "simple")
Phase 4  Income-tax podklady (annual PDF/XLSX for everyone; partial XML only for flat-rate users)
Later    Invoicing, Fio/bank APIs, API/MCP, PWA offline capture, accountant multi-client portal, billing, marketing
```

---

## Phase 0: Foundations

Specs: `03-architecture.md`, `05-data-model.md`, `modules/M12-platform-ops-security.md`.

**Build:**
- monorepo, CI, staging + preview deploys
- Postgres with migrations, auth, organizations with RLS
- object storage, job queue, error tracking
- i18n (Czech source, English), design-system shell
- rule tables (effective-dated law data), the Money type
- seed data: categories, VAT treatments, rates, limits

**Exit criteria**
- `pnpm typecheck && pnpm test` green. An automated RLS test proves cross-tenant isolation for **every** table.
- `pnpm dev` starts everything locally with one seeded demo organization per persona.
- `rules.at('2026-05-01')` returns 2026 values (incl. paušální daň band I = 9 162 Kč).

## Phase 1: MVP, Scanner and Organizer (modules M01, M02, M03, M04, M09, M11)

**User story:** *I sign up with my IČO, answer 4 questions, forward or upload documents, and within seconds they're read, checked, sorted and counted. Only doubtful things land in a short review queue.*

**In scope**
1. **Onboarding:** IČO → ARES autofill → tax profile (VAT status, VAT period, tax regime, flat-rate %, paušál band). Takes under 60 seconds.
2. **Ingestion:**
   - Channels: web upload (multi-file, drag-and-drop, phone camera via `<input capture>`) and a per-organization e-mail address.
   - Formats: PDF, JPEG/PNG/HEIC, ISDOC/ISDOCX.
   - Deduplication by content hash and by semantic key.
   - Splitting of multi-document PDFs.
3. **Document classification:** what is it? Received invoice, simplified receipt, issued invoice, credit note, proforma or advance, **order confirmation, statement/settlement, government form or filed return, contract, other, not a document**. Only accounting documents are booked; the rest are filed as supporting documents and linked.
4. **Extraction:** ISDOC, then QR (SPAYD/SID), then the PDF text layer, then the LLM (Haiku), escalating to Sonnet when needed. Fields include supplier, IČO/DIČ, numbers, VS, dates (issue, DUZP, due), lines, VAT recap, totals, currency, payment method, buyer.
5. **Validation:**
   - The math gate.
   - ARES and VIES checks, unreliable-payer status and published accounts (CRPDPH).
   - Buyer = me? Duplicates, date sanity.
   - Is it a tax document at all ("není daňový doklad")?
   - The cash limit.
6. **Categorization:** category, VAT treatment, deductibility hint, business/personal. Sources in order: vendor memory, rules, LLM. Plain-language explanations.
7. **Review queue:** per-field confidence, click-to-fill from the PDF, simple questions ("Je to soukromé, nebo firemní?" with chips [Firemní] [Soukromé] [Napůl], 07 §2.3).
8. **Přehled (dashboard):**
   - Income and expenses this month and year to date.
   - Limit meters: VAT registration 2 000 000 / 2 536 500 Kč (calendar-year turnover); paušál bands; flat-rate caps.
   - Identified-person alert, deadline calendar, review count.
9. **Simple accountant export (Phase-1 level):** a ZIP of documents named consistently plus a CSV/XLSX register.
10. **Manual entry** ("Přidat ručně") and substitute documents (náhradní doklad), always available (04 §2.2a).
11. **Trust basics (owner 2026-10-26):** the app installs to the phone home screen (web app manifest, M01 §4.1.1) and every manual change to a document value writes an `audit_log` row (M11 §13.1).

**Deliberately not in Phase 1** (moved during the 2026-10-18 consistency review to keep Phase 1 the minimal "scanner and organizer works" test):
- Phase 2: cash/document basis toggle and payables ageing on Přehled (need bank data); bulk "Označit jako zaplacené" in the register (creates transactions, so it belongs to M07); spreadsheet import (already Phase 2).
- Phase 4: the "Kolik si odložit" tax-reserve estimate (one implementation, M06 §4.11).
- Later: ⌘K command palette and global keyboard sequences (the register's search box and the review-flow keys stay), tips card, VAT-meter projection and 12-month sparkline, rolling-12-month turnover figure, QR separator sheets for scanning, Batch API re-processing, cross-tenant vendor priors, support-access impersonation grants.

**Exit criteria**
- Golden set `testdata/golden-v1`:
  - all 6 decoys classified as non-booking documents;
  - both duplicates detected;
  - field accuracy ≥ 98 % on totals, dates and IČO/DIČ;
  - every booked document reconciles or is flagged.
- Upload→ready p50 < 15 s on staging.
- Playwright E2E passes: sign up → forward an e-mail with 3 attachments → answer 1 question → dashboard totals update → download the export.

## Phase 2: MVP+, accountant hand-off and payments (modules M07, M10)

**In scope**
1. **Money accounts:** bank, cash, card, platform payouts (Airbnb, Booking, payment gateways).
2. **Transaction intake (licence-free):**
   - Bank statement file import (GPC/ABO, CAMT.053, CSV for Fio, ČS, ČSOB, KB, RB, Air Bank, MONETA).
   - Bank notification e-mails to a `+banka` address.
3. **Matcher:** VS + amount, then fuzzy matching (card merchant, date, amount), partial and multi-document payments, FX, fees, platform payout statements.
4. **Missing-documents radar:** payments without a document are listed as "chybí doklad" (missing document), with a one-tap "request from supplier" e-mail draft.
5. **Accountant package (monthly or annual):**
   - Completeness score.
   - All documents, the register (XLSX), the bank reconciliation, open questions, and notes.
   - Exports: **Pohoda XML** (received invoices, receipts/internal documents, bank) and **ISDOC**. Money S3 XML follows.
6. **Accountant seat:** invite by e-mail; read, comment and export; resolve questions.
7. **Paying own bills:** QR code per unpaid invoice, shown after an unreliable-payer and published-account check. ABO batch file.
8. **Spreadsheet import** of the user's old XLSX/CSV list (M01 §4.13), bulk "Označit jako zaplacené" in the register (M11 §5.1), and the cash/document basis toggle and payables ageing on Přehled (M09 §4.2, §4.11).

**Exit criteria**
- ≥ 95 % auto-match on the synthetic 500-transaction set (`modules/M07`), with zero false matches above 0.9 confidence.
- The Pohoda export validates against the Stormware XSD.
- A real accountant pilot imports one month into Pohoda with no manual fixes (manual checklist).

## Phase 3: Simple VAT (module M05)

**Guardrail:** the app generates filings only when the period is classified **simple** (`modules/M05 §4.3`). Otherwise it produces a VAT workbook for the accountant and says why.

**In scope**
1. **Identified person (IO):** monthly DPHDP3 when foreign services or EU goods were received (rows 3–13 output only, no deduction, no KH), with ČNB FX on the correct date.
2. **Simple VAT payer:**
   - DPHDP3 for domestic rows 1–2 and 40–41 and self-assessed rows 3–13 + 43–44.
   - DPHKH1 (A2, A4, A5, B2, B3).
   - DPHSHV for services to EU businesses.
3. XSD validation, a human-readable preview with drill-down, filing snapshots.
4. Amendments as a guided flow: řádné/opravné/dodatečné; KH řádné/následné.

**Exit criteria**
- For P4's anonymized August 2026 data, the IO DPHDP3 equals the filed return (row 5: 13 700 / 2 877).
- 100 % of XML passes the official XSD.
- KH ↔ DPHDP3 reconciliation property tests pass.

## Phase 4: Income-tax podklady (module M06)

**In scope:** annual summary for §7 business income:
- income received (cash basis) and expenses by category, deductible vs not;
- assets over 80 000 Kč (list only; depreciation is the accountant's job);
- a flat-rate vs actual expenses comparison;
- paušální daň band check and advances paid (from bank matching);
- private-use flags.

Outputs: a PDF summary and XLSX for the accountant or for MOJE daně, for every regime. *Optional, behind a flag, flat-rate users only:* a partial DPFDP7 XML containing only the header and příloha 1 rows that are fully derivable (ř. 101 income, ř. 102 flat-rate expenses, the rate). Offered for `pausalni_vydaje`, and for `pausalni_dan` only in a year where a return is required (M06 §4.4). **Not offered for `danova_evidence`**: those users get PDF/XLSX podklady for the accountant. Users upload the XML to EPO and complete it there.

**Exit criteria:** The podklady for each persona's golden year match hand-computed totals to the koruna. The summary clearly lists what still needs to be added on MOJE daně (credits, deductions, other income types).

## Later (not specified in detail)

Issued invoicing, Fio/MONETA token sync (after legal opinion L-01; ADR-009; owner 2026-10-26: not ordered yet), ABRA Flexi export (only if a pilot accountant uses it), REST API + webhooks + MCP server (+ OAuth/PATs), PWA offline capture, accountant multi-client portal, Money S3 export, competitor import (Competitors C, D and E), subscriptions/billing, marketing site, EET 2.0 (from 1 Jan 2027, only for users with in-person cash or card sales), PSD2 aggregator (owner 2026-10-26: not planned, too expensive), full DPFDP7 + přehledy with a tax-advisor partner, Batch API re-processing (M02 §4.10), cross-tenant vendor priors (M04 §4.7), support-access grants (M12 §4.9), ⌘K command palette, QR separator sheets, Factur-X/ZUGFeRD and Pay by Square parsing.

---

## Guardrails for every phase
- Never submit anything to a government system. Never initiate payments.
- Deleted documents go to a 30-day trash. Finalized tax documents are retained for 10 years even if the user deletes them, and the UI explains why. Full export and account closure are available anytime (`modules/M12`).
