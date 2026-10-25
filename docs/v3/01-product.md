# 01: Product

> Working name: **Shoebox**. The final brand is open (`22-open-questions.md`). Everywhere in this spec, "the app" means this product.

## 1. Positioning (read this first)

**We are not accounting software. We are a technology layer for small businesses that collects, reads, checks and organizes every document and payment, then hands a clean, complete package to the accountant.**

- **The core is the scanner and organizer.** Documents arrive from anywhere (e-mail, upload, phone photo). They are read automatically, checked against public registries and arithmetic, sorted, and shown on one simple dashboard.
- **The accountant is the destination.** The main output is a perfect hand-off: a monthly or annual package (PDFs, structured data, Pohoda/Money/ISDOC export, notes on anything unusual) and an accountant login.
- **Tax filing only where it's simple and safe.** For users with few documents and simple situations, the app also prepares:
  - **VAT filings:** the identified person's monthly DPHDP3, and DPHDP3 + KH + SH for small, simple VAT payers.
  - **Income-tax "podklady":** a PDF summary and an XLSX workbook for everyone, which the user gives to the accountant or uses on MOJE daně. A **partial DPFDP7 XML** (header + příloha 1 income and flat-rate expense rows) is offered **only for flat-rate expenses (výdajový paušál)**, and for paušální daň users only in a year in which they must file a return. Actual-expense users (daňová evidence) get the PDF/XLSX podklady and **no XML**: their expenses depend on depreciation and the accountant's adjustments. This follows Competitor C's proven line and is the lowest-maintenance option.

  The app **never** produces a full income-tax return or the ČSSZ/ZP overviews in V3. That is a deliberate maintenance decision; see `06-maintenance-playbook.md`.

### Why this positioning
- **Low maintenance:** document formats barely change. Tax forms change every year. We keep the yearly-changing surface small and data-driven.
- **Lower liability:** the accountant (or the user on MOJE daně) is the final reviewer of anything filed.
- **A distribution channel:** accountants recommend tools that save them time. One accountant brings 30–100 clients.

## 2. Why this can win (evidence in `research/`)

| Gap observed | Evidence | Our answer |
|---|---|---|
| AI extraction is a metered add-on (4–5 Kč/doc or 5–50 docs/month per tier) and makes visible mistakes (sign errors, `69,002`). Math mismatches only warn. | internal research (not published), internal research (not published), internal research (not published) | Deterministic-first reading (ISDOC, QR, PDF text) plus an LLM, behind a **hard math gate**. Generous volumes. |
| Inboxes accept anything. Order confirmations, statements and government forms end up as "expenses". | Founder's test set (`testdata/golden-v1`) | **Document classification first**: decoys are recognized, kept as supporting documents, and never booked. |
| Hand-off to the accountant is "add them as a user" or a raw export. | internal research (not published) | A **monthly accountant package** with a completeness check ("3 documents missing for bank payments"), notes, and exports in their software's format. |
| Identified persons (§6g) get no help with monthly self-assessed VAT. | `research/czech-tax-filings.md §3.2` | Detect foreign invoices, explain the obligation, generate the monthly DPHDP3. |
| Classification is either a single "deductible" checkbox or an expert taxonomy. | internal research (not published) | The AI predicts a full taxonomy. The user sees one plain sentence they can tap to change. |
| Bank matching needs an exact VS and amount. | `research/bank-connectivity.md` | The same licence-free channels and a smarter matcher. A "missing document" radar for unexplained payments. |

## 3. Product principles (non-negotiable)

1. **Simple, intuitive, lightweight.** Four main screens (Inbox, Přehled, Pro účetní, Nastavení). No accounting jargon in the default view. Every screen must make sense to someone who has never seen a balance sheet.
2. **Zero typing by default.** Everything derivable (registries, ISDOC, QR, history, rules) is derived. The user only confirms exceptions.
3. **Never silently wrong.** Every value has a source and a confidence score. Low confidence becomes a question. Math failures block "ready".
4. **The law is data.** Rates, limits, deadlines and form versions live in effective-dated rule tables (`06-maintenance-playbook.md`). Code never hard-codes a tax number.
5. **Deterministic core, AI at the edges.** AI reads and suggests. Sums, routing and XML generation are pure, tested functions.
6. **Accountant-first outputs.** If in doubt, produce data for the accountant rather than a filing.
7. **Privacy by design.** EU-only processing, minimal retention of raw AI payloads, audit log, full data export and account deletion.
8. **Sustainable to run.** Prefer fewer, solid features over many fragile ones. Every feature lists its yearly maintenance cost in its module spec.

## 4. Personas

The data model supports every combination of `vat_status` × `tax_regime` (`04-domain-model.md`). The **accountant** is a secondary user in every persona.

### P1: Petra, paušální daň freelancer (graphic designer)
- Non-payer, *paušální daň* band I, ~850 000 Kč/year, buys Adobe/Canva/Figma (EU/US SaaS), occasional Meta ads.
- **Needs:**
  - a document organizer and income tracker against band limits (1 M / 1.5 M / 2 M Kč);
  - reminders for the paušál advance (20th of each month), and the 10 January entry/exit deadline;
  - **identified-person detection** with a registration checklist;
  - the monthly IO DPHDP3 when she buys foreign services.
- **Accountant:** usually none.

### P2: Tomáš, actual-expense OSVČ (electrician)
- Non-payer, daňová evidence, ~1.4 M Kč income, many material receipts (thermal), van, phone, fuel.
- **Needs:** photo capture, readable archive, categorization with deductibility hints, a missing-document radar, and a year-end **podklady** package (PDF + XLSX, no XML) for his accountant (income and expense totals by category, asset list, documents).
- **Accountant:** yes, once a year.

### P3: Lucie, small VAT payer (e-shop, quarterly)
- VAT payer, quarterly, ~3.5 M Kč, Shoptet, payment gateways, Zásilkovna COD, EU suppliers.
- **Needs:**
  - unreliable-payer and published-account checks before paying;
  - bank and gateway matching;
  - a **monthly accountant package with Pohoda export**;
  - optionally DPHDP3/KH/SH drafts when her quarter is simple.
- **Accountant:** yes, monthly or quarterly.

### P4: Josef, identified person with short-term rental and a software side business (founder; real anonymized documents in `testdata/golden-v1/`)
- Identified person (§6g), daňová evidence, Airbnb + Booking apartment with a property manager (VAT payer, 20 % fee), cleaning invoices, Booking commission (NL), Cloudflare (US) and Anthropic (IE) SaaS, Praha 3 tourist-fee reports, a few personal-looking purchases.
- **Needs:**
  - the monthly IO DPHDP3 (rows 5 and 12, ČNB FX);
  - recognition of statements, municipal reports and his own filed returns;
  - cross-document reconciliation;
  - pass-through items (tourist fee);
  - business/personal triage;
  - deadline radar.
- **Accountant:** for the annual close.

## 5. Jobs to be done (ranked)

1. *"When a receipt or invoice arrives, take it off my hands and tell me only if something is wrong."*
2. *"Keep everything organized so my accountant gets a complete, clean package without chasing me."*
3. *"Warn me about limits, deadlines, unreliable payers and missing documents before it costs me."*
4. *"For simple VAT situations, prepare the filing so I just upload it."*
5. *"At year-end, give me (or my accountant) the numbers for the income-tax return."*
6. *(later)* *"Let me invoice clients quickly and see who hasn't paid."*

## 6. Non-goals for V3 (explicit)

- A full income-tax return (DPFDP7) XML, any income-tax XML for actual-expense users, the ČSSZ overview, the health-insurance overview. **Podklady only** (plus the partial XML for flat-rate users). Upgrade path in `06-maintenance-playbook.md §5`.
- Double-entry bookkeeping, payroll, stock, multi-currency accounting beyond FX conversion for VAT.
- KH or VAT returns for complex payers (pro-rata deduction, margin schemes, imports through customs, domestic reverse-charge commodities, bad-debt corrections). The app detects these and says "this needs your accountant".
- Automatic submission to any government system. Payment initiation.
- Subscriptions and billing, marketing site, referral programmes, mobile native apps (a mobile-friendly PWA is in scope).
- Our own ČNB AIS licence.

## 7. Success metrics for the MVP

| Metric | Target |
|---|---|
| Decoy documents wrongly booked as expenses (golden set) | 0 |
| Field accuracy on the golden set (totals, dates, IČO/DIČ) | ≥ 98 % |
| Touchless rate (no user edits before "ready") | ≥ 80 % |
| Upload → ready p50 / p95 | < 15 s / < 60 s |
| An accountant can process a monthly package without asking the client anything | ≥ 90 % of packages (pilot feedback) |
| Generated VAT XML passes the official XSD | 100 % |
