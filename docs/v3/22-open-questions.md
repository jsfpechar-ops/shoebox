# 22: Gaps, risks and open questions

Single list of every open question from 01–07 and the module specs M01–M12 (consolidated and deduplicated on 2026-10-18; modules now point here by id). Each item has an **owner** (founder · tax advisor · verify-at-implementation), the **phase it blocks** (the phase that cannot exit until it is resolved) and a **default** so implementation can proceed.

Rules for Fable:
- Never guess an answer. Implement the default and leave `TODO(decision-XX)` for `D-` items, `TODO(advisor-XX)` for `TA-` items, `TODO(verify-XX)` for `T-` items.
- A `T-` item is resolved in the PR that implements it: check the primary source and record the finding in the PR (AGENTS rule 9). Edit the spec and this file in the same PR.
- `D-05` and `D-06` keep their ids (code and specs reference `TODO(decision-05/06)`) although they are advisor questions.

## A. Decisions for the founder

| # | Question | Default until decided | Blocks |
|---|---|---|---|
| D-01 | Product name and domain (inbound e-mail domain `in.<domain>`) | `shoebox` placeholder, domain from env | Public launch |
| D-02 | Which accountant(s) pilot Phase 2 (Pohoda vs Money S3 first) | Pohoda first | Phase 2 exit |
| D-03 | Partner daňový poradce for the yearly rule review (06 §4) and the §B questions | none; rules are reviewed by the founder | Phase 3 exit |
| D-04 | Pricing and free tier, incl. the price of archive mode after account closure (M12 §4.6) | everything free in pilot; archive mode free | Public launch |
| D-07 | Outbound e-mail provider (Supabase Auth SMTP, M09 digests and urgent mails, M10 share links, M12 export links) | **Amazon SES in an EU region** (e.g. `eu-central-1`), which the founder already runs for another product. Added as the **4th platform** in ADR-004b (03) behind an `OutboundMailer` interface; ≈ 0.25 day/year. Staging may use Supabase's built-in SMTP. | Phase 1 public release |
| D-08 | Malware scanning (ClamAV sidecar ≈ 1–2 GiB memory, ≈ 0.5 day/year image upkeep) | **Accept, on the worker Cloud Run service only** (not web). If clamd is down, processing continues (our parsers only read) but the original is not downloadable and is excluded from packages until `scan_status='clean'` (M01 §4.3; M12 follows M01). | Phase 1 |
| D-09 | Supabase Branching for preview deploys of PRs that contain migrations | **No.** PRs with migrations skip the preview and rely on CI's ephemeral database (M12 §4.2). | Phase 0 |
| D-10 | Yearly maintenance budget (06 §1): law and formats 8–13 days (target 7–14 met); product tuning and platform hygiene add 12–15.5 days; total ≈ 20–28.5 days/year | **Accept**, track the three buckets separately in the yearly review; restore drills twice a year instead of quarterly; next cuts in the order listed in 06 §1.1 | none (yearly review) |
| D-11 | Rounding method for DPHDP3 rows (`vat.return_rounding`) | **`sum_entries_then_round`** (round the sum of per-document taxes; keeps KH and DPHDP3 consistent). Alternative: `round_base_then_multiply` (round the row base, then × rate). Both reproduce the filed August 2026 return (13 700 / 2 877); they differ for September 2026 (2 425 vs 2 426). Settle with the first filed return on which they differ, and confirm with the advisor (D-03). | Phase 3 exit |
| D-12 | XLSX reading library for the spreadsheet import (new dependency, AGENTS rule 7) | **`exceljs`** (already used for writing XLSX in M05, M06, M10; reads `.xlsx` only, `.xls` unsupported). Alternative: SheetJS CE (also `.xls`; published outside npm, licence and pin to verify). | Phase 2 |

## B. Tax-advisor and legal questions

Owner: **tax advisor** (D-03; until one is engaged, the founder) for TA- and D-; **founder** obtains a legal opinion for L-.

| # | Question | Default until answered | Blocks |
|---|---|---|---|
| D-05 | Default `foreign_service_dppd_policy` (service period end vs issue date) for self-assessed foreign services (04 §3.3, M04, M05) | `service_period_end` when a period is printed, else `issue_date`; per-org override; the P4 golden fixture pins `issue_date` | Phase 3 exit |
| D-06 | Is short-term rental income §7 or §9 for P4-like users? The app only labels; the accountant decides. | `income_accommodation`, one category, flagged "ask your accountant" | Phase 4 |
| TA-01 | Received date for a payer's deduction timing: for forwarded e-mails the original or the forward date; does a printed "Datum převzetí/doručení" matter? (M01 Q4, M02 Q-9) | innermost plausible e-mail date (≤ outer date, ≥ outer − 365 days); printed receipt date ignored | Phase 3 |
| TA-02 | Substitute documents (náhradní doklad): ZDPH §73(5) proving the deduction by other means, ZDP §24 payment evidence, wording of the manual-entry note and of the generated "Interní / náhradní doklad" PDF (M03 Q7, M04 §4.11.4a, M10 Q8, M11 Q9) | no input VAT until the accountant or owner dismisses `SUBST_NOT_TAX_DOCUMENT`; counts for income tax with a warning until a payment is linked; copy as written in M01 §7 / M11 §5.1a | Public launch (copy); Phase 2 (PDF) |
| TA-03 | Is a consumer invoice (buyer without IČO) acceptable evidence of a business expense in daňová evidence? (M03 Q1) | warning `ID_BUYER_CONSUMER_NO_ICO`, never blocking | Phase 1 public release (wording) |
| TA-04 | An EU supplier wrongly charges its own VAT to a CZ taxable person: is self-assessment still due? (M03 Q2) | `rcv_foreign_vat_charged` + warning "zeptejte se účetní"; the VAT period becomes not simple | Phase 3 |
| TA-05 | VAT-registration turnover ("obrat"): gross vs net of platform commission, short-term accommodation, `iss_exempt` supplies, EU goods sold by a non-payer; when the 10-working-day registration clock starts in the 2 000 000 Kč case (M03 Q4, M09 Q1/Q7) | `vat.registration_turnover_policy` as in 06 §2.1 (platform gross and accommodation counted, exempt and foreign B2B excluded); clock starts on the crossing date; meter copy says "orientačně" | Phase 1 (meter copy) |
| TA-06 | Is VAT an identified person self-assesses (rows 5/12) a deductible income-tax expense when paid? (M04 Q2, M06 Q5) | category `tax_vat_payment`; listed in podklady, not deducted; checklist note for the accountant | Phase 4 |
| TA-07 | Tourist fee: outside the VAT base for payers providing accommodation? Ever reportable as income? (M04 Q3) | pass-through (`pt_tourist_fee`, `rcv_out_of_scope` / `iss_no_vat`) | Phase 3 |
| TA-08 | Identified person supplying §9(1) services to EU businesses: SH only, no DPHDP3 row 21? Is monthly SH always acceptable? (M04 Q4, M05 Q7, M05 §4.1) | SH only, monthly; no DPHDP3 row | Phase 3 |
| TA-09 | Car regime `flat_rate_km`: are fuel receipts then non-deductible in daňová evidence? (M04 Q5) | non-deductible with the note "paušál na dopravu řeší účetní"; the answer is recorded from Phase 1 | Phase 4 |
| TA-10 | VAT amendments: KH následné full vs delta; SH následné storno mechanics and deadline; DPHDP3 dodatečné deadline and ř. 66 sign; late-filing penalty text (M05 Q6, §4.11–4.12) | full content for KH; storno row + new row for SH; amendments generated only when the new state is simple, else workbook + accountant | Phase 3 (amendment flow) |
| TA-11 | Negative ř. 62 for an identified person (credit note on a foreign service in the same month): file or escalate? (M05 Q8) | `needs_accountant` | Phase 3 |
| TA-12 | Paušální daň: consequences of exceeding the band ceiling or the regime limit mid-year; no return when conditions held all year; which year a December advance paid in January belongs to; ceilings on current- vs prior-year income (M06 Q2, M09 Q2) | neutral warning "poraďte se s účetní"; advances counted by `booked_on` year; current-year income | Phase 1 (meter copy), Phase 4 |
| TA-13 | Rounding of flat-rate expenses (floor vs half-up) and of ř. 101/102 (M06 Q3) | expenses `floor0`, income `round0` | Phase 4 |
| TA-14 | §35ca warning text for flat-rate users (spouse credit, child benefit) (M06 Q8) | the fixed caveat text in M06 §4.3 | Phase 4 |
| TA-15 | Do social/health advance and paušální daň payment deadlines move to the next working day? (M09 Q3) | insurance `previous_working_day` (never later than the legal date); paušální daň `next_working_day` | Phase 1 |
| TA-16 | §109 ZDPH threshold semantics for paying to an unpublished account (M07 Q3) | `vat.ruceni_cash_threshold` (270 000 Kč) compared with the document total incl. VAT | Phase 2 |
| TA-17 | Pilot accountant (D-02): default Pohoda členění DPH per `vat_treatment` and the identified-person handling; card receipts as `int:intDoc` vs `vch:voucher`; are platform/gateway statements sufficient evidence for their fees; is a generated ISDOC transcription of a received document acceptable? (M10 Q2/Q3/Q5, M07 Q5) | codes only from the accountant's `export_mappings`; receipts as `int:intDoc`; statement fees accepted and flagged "bez faktury"; ISDOC generated with `IssuingSystem` "Shoebox (přepis dokladu)" | Phase 2 exit |
| L-01 | Does pulling bank data with a **user-generated token** (Fio/MONETA) or parsing bank notification e-mails count as an AIS (account information service) requiring a licence? (`research/bank-connectivity.md`, M07 Q2) | E-mail notices and file import are believed licence-free [verify]; token sync stays Later and off | Bank API sync (Later) |
| L-02 | Liability wording: the app prepares data and drafts, and the user or accountant files. Terms of service + in-app disclaimers on every filing card. | disclaimer keys `vat.disclaimer`, `filing.card.disclaimer`, `podklady.disclaimer` | Phase 3 public release |
| L-03 | GDPR: DPA with sub-processors (Supabase, Google Cloud, Anthropic (Claude API, US/global: SCCs or DPF), Cloudflare incl. its EU processing options, Amazon SES, Sentry), records of processing, DPIA for AI processing of invoices (M12 Q7) | sub-processor list in M12 §4.6 | Public launch |
| L-04 | Use of the LLM provider in an EU region with no training on customer data. Confirm contractually. | ADR-011 | Phase 1 public release |
| L-05 | Retention vs deletion (10-year VAT retention vs GDPR erasure): legal basis text for the privacy policy, and for closure option A (we archive on the customer's behalf as processor) (M12 Q8) | texts in the M12 §7 copy table | Public launch |

## C. Verify at implementation (Fable checks the primary source and records the result in the PR)

| # | Item | Default until verified | Blocks |
|---|---|---|---|
| T-01 | Claude Haiku 5.5 / Sonnet 5.5 on the Anthropic Claude API (owner decision 2026-10-18; Vertex `eu` fallback): model ids, price uplift, structured output (`output_config.format`), `effort`, `thinking: disabled` at Sonnet `medium`, 1 h prompt caching, vision tier (1568 vs 2576 px) (ADR-011, M02 Q-1–Q-3) | as specified in M02 §4.5–4.6; if `thinking: disabled` is not allowed at `medium`, use `low` | Phase 1 |
| T-02 | EPO DPHDP3 / DPHKH1 / DPHSHV (03.01.04 / 03.01.15 / 02.01.05): attribute names, `verzePis`, `nazevSW/verzeSW`, Veta4/Veta6/VetaP attributes, zero attributes omitted or written, `c_okec` for IO, KH `c_radku`, SH `por_c_stran`, `trans` A/N semantics, payer nil return, Věta C, `c_ufo`/`c_pracufo` vs `fu_code`/`ufo_code`, the `side` of every row in `epo.dphdp3_row_map` (M05 Q3/Q4/Q5/Q9, M09 Q6) | as in M05 §4.4–4.7; the CI attribute-existence test against the vendored XSD is the authority | Phase 3 |
| T-03 | DPFDP7 příloha 1 attribute names; whether EPO accepts VetaT without VetaO; flat-rate attributes required with `vyd7proc`; the tax-year-2026 structure version (M06 Q4) | feature flag off for any year without a verified XSD | Phase 4 (flag) |
| T-04 | CRPDPH SOAP endpoint (moved to `mojedane.gov.cz/dpr/axis2/services/…`) and its nightly 0:00–0:10 outage (M03) | retry after 15 min, never surfaced | Phase 1 |
| T-05 | VIES REST paths and error semantics (errors arrive as HTTP 200 + code) (M03) | treat `MS_UNAVAILABLE` etc. as unavailable → "neověřeno" | Phase 1 |
| T-06 | Pohoda dataPack element names for received invoices, vouchers and bank against the Stormware XSDs: numbering, `symPar`, `paymentAccount`, foreign VAT ID, `roundingDocument`, `dateKHDPH`, country (M10 Q1) | as in M10 §4.7; CI XSD validation | Phase 2 |
| T-07 | Cloudflare Email Routing / Email Workers: max message size (assumed 25 MiB), SPF/DKIM verdict headers, `setReject` SMTP semantics, retry on temporary failure, data-processing location (M01 Q2, M12 Q7) | 25 MiB; `spoof = spf=fail && dkim=fail` → quarantine | Phase 1 |
| T-08 | HEIC decoding in the Cloud Run Node image (libvips with libheif + libde265 vs `heic-decode` WASM) and the HEVC decoder licence (M01 Q3) | `heic-decode` WASM if the libvips build is not available | Phase 1 |
| T-09 | Golden set: exact wording of the Praha 3 tourist-fee report and the property-manager "Vyúčtování" (cues `P_MUNICIPAL`, `P_OWNER_MANAGER`); the anonymizer rewrites embedded ISDOC and QR payloads consistently with the text (M01 Q6, M02 Q-6) | generic cues; documents with inconsistent ISDOC/QR are marked in `labels.json` | Phase 1 exit |
| T-10 | Czech Windows ZIP filename encoding (CP852 assumption) and iOS Safari's automatic HEIC→JPEG conversion on `<input type=file>` (M01 Q7) | UTF-8 if valid, else CP852 | Phase 1 |
| T-11 | Supabase signed upload URLs do not bind content-length (M01 Q9) | re-check the size server-side after upload; oversize → `too_large`, blob deleted | Phase 1 |
| T-12 | IČO mod-11 and natural-person DIČ allocation patterns (RČ-based vs `CZ699…`) (M02 Q-7, M03 Q5) | a DIČ checksum failure only lowers confidence; ARES/ADIS are authoritative | Phase 1 |
| T-13 | EPC (SEPA) QR layout (EPC069-12 v002) before enabling `BCD` parsing (M02 Q-8) | disabled | Later |
| T-14 | Official authority accounts for `bank.authority_accounts`: FÚ income-tax prefix, ČSSZ/OSSZ, health insurers, Praha 3 tourist fee (M07 Q4, M04 §4.15) | only FÚ VAT (705, VS = DIČ) and paušální daň (2866) entries enabled | Phase 2 |
| T-15 | Real header names of every bank CSV/JSON profile and notice templates: ≥ 1 anonymised export per CSV profile, ≥ 3 notices per bank and direction (M07 Q6) | a profile or notice parser without fixtures stays disabled; files go to the mapping wizard | Phase 2 (per parser) |
| T-16 | ABO/KPC payment-order record layout against the bank import specs (Fio, ČSOB, KB) (M07 Q7) | table-driven layout; feature flag off until one real import succeeds | Phase 2 (flag) |
| T-17 | Biome 2 GritQL plugin API for the custom lint rules (M12 Q5) | ts-morph scripts in `scripts/lint/` | Phase 0 |
| T-18 | 2026 income-tax threshold 1 762 812 Kč (36 × average wage, computed in research [I]) (M06 Q7) | 1 762 812 | Phase 4 |
| T-19 | From 10 Jul 2027: does the Czech 270 000 Kč cash limit remain in parallel with the AMLR €10 000? (M03 Q3) | both limits as rule data from 2027-07-10 | before 2027-07-10 |
| T-20 | MOJE daně UI labels used in the submission guides (M05 §4.13, M06 §7) | guide carries `verified_at`; yearly check in January | Phase 3 |
| T-21 | Praha 3 tourist-fee report deadline and whether it shifts on weekends/holidays (M09 Q4, 06 §2.1 `municipal.tourist_fee`) | 15 days after month end, `next_working_day` | Phase 1 |

## D. Known gaps deliberately left for later

| Gap | Why later | Where it would go |
|---|---|---|
| Issued invoicing (module M08) | The founder wants focus on the scanner and organizer. Users can upload their own issued invoices. | Later phase; internal research (not published) has the model |
| Full DPFDP7 + ČSSZ + ZP overviews; any XML for actual-expense users | Highest maintenance (06 §5) | Option A upgrade with an advisor partner |
| Subscriptions/billing, marketing site, referral | Not needed to prove the product | After pilot |
| Import from Competitors C, D and E | Growth lever, not core | After pilot |
| Native mobile apps, PWA offline queue, share target | PWA camera capture is enough for the MVP | After pilot |
| Bank APIs (Fio token) and PSD2 aggregator | Licensing (L-01), cost | After the legal opinion / after revenue |
| EET 2.0 (from 1 Jan 2027) | Only affects users with in-person cash or card sales. Not our core persona. | Evaluate Q4 2026 |
| Accountant multi-client portal | Phase 2 has a per-org accountant seat. A portal is for scale. | After pilot |
| Double-entry (s.r.o.) | Positioning: export to accountants instead | Not planned |
| Money S3 export | Pohoda first (D-02) | Later, M10 §4.9 |
| Batch API re-processing, cross-tenant vendor priors, support-access grants, ⌘K palette, QR separator sheets | Not needed to prove Phase 1; moved in the 2026-10-18 review (02 Phase 1) | M02 §4.10, M04 §4.7, M12 §4.9, M11 §3, M01 §4.7 |
| Factur-X/ZUGFeRD and Pay by Square parsing | No evidence of volume yet (log `unsupported_embedded_format`) (M02 Q-10) | M02 |
| A `secondary_pausal_rate` for multiple activities | One rate + checklist item is enough for V3 (M06 Q6) | 04 §1 |

## E. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Extraction accuracy on thermal or crumpled receipts below target | medium | high | Deterministic-first; escalation; review queue; golden-set growth from user corrections (with consent) |
| A wrong VAT filing causes a user penalty | low (simple-period gate) | high | Simple-period gate, XSD validation, preview, disclaimers, never auto-submit, advisor review of rules |
| A registry outage (CRPDPH nightly window, ARES) | high (routine) | low | Never block; "neověřeno" status; retry later (06 §3) |
| LLM price or model changes | medium | medium | Provider-agnostic gateway, eval harness, deterministic sources reduce LLM share |
| The founder's maintenance capacity: total planned upkeep ≈ 20–28.5 days/year, about twice the law-only headline (06 §1, D-10) | medium | high | Scope boundaries (06 §5), drift monitors, runbooks, yearly window, the cut list in 06 §1.1 |
| Many advisor questions (§B) are still open when Phase 3 starts | medium | medium | Engage the advisor (D-03) before Phase 3; every TA- item has a conservative default that routes to the accountant |
| Competitors copy the identified-person and accountant-package features | medium | medium | Speed, accountant relationships, quality of the scanner |

## F. Resolved in the 2026-10-18 consistency review (no longer open)

- Spoofed inbound mail (M01 Q1): **quarantine**, not drop; ADR-005 updated.
- Status for kept-but-never-booked documents (M01 Q5): enum value renamed **`rejected` → `supporting`** (04 §2.4, 05).
- `field_source` for typed and imported values (M01 Q11): `user`, no new enum value.
- Credit-note sign (M02 Q-4): stored **negative**; M02 normalizes; nobody flips signs downstream (04 §3).
- One combined classify+extract LLM call (M02 Q-5): no; separate calls keep evals simple.
- `PERIOD_LOCKED` before the user joined (M03 Q6): only for periods with an uploaded own return.
- Personal-purchase merchant list (M03 Q8): the maintainer curates it by data PR; no automatic exclusion of IKEA.
- Global priors questions (M04 Q6): moot; priors are Later. Weak confirmations (M04 Q7): no.
- Cross-module contracts (M05 Q10, M09 Q8, M07 Q8): job/event names in 03 §3.1, filing field keys in 04 §9.4, `lineTaxAmountCzk` exported by M04 §6.1, statement payout fields in M02 §3.
- Ledger contract (M06 Q1): confirmed in 05 §7 (`amount_czk` signed, net of deducted VAT for payers, before business share).
- Fio token phase (M07 Q1): Later; ADR-009 aligned with 02.
- Pending card authorisations (M07 Q9): shown, marked "čeká na zaúčtování". Supplier requests (M07 Q10): `mailto:` + copy text only; the app never e-mails third parties.
- VAT registration test (M09 Q1): calendar year since 2025 (`research/czech-tax-filings.md §3.1` [O]); 04 §7 fixed. Outbound mail (M09 Q5, M10 Q6, M12 Q1): D-07.
- Bank export to Pohoda (M10 Q4): off by default. Period key for non-payers (M10 Q7): document date; the register shows `paid_at`. Share-link retention (M10 Q9): 90 days after expiry.
- Page word layer (M11 Q2): `org/{org_id}/derived/{sha256}/text.json` (M01 already writes it; M02 adds words for images). `summary_cs` (M11 Q3): M04's deterministic template. Answer chips (M11 Q4/Q7): Firemní / Soukromé / Napůl everywhere. Accountants' expert view (M11 Q5): on by default. `document_revisions` (M11 Q6): in 05. Bulk "mark paid" (M11 Q8): Phase 2, reuses the "Pokladna" cash account.
- Product analytics (M12 Q2): first-party aggregate counts; PostHog removed from 03. DPFDP7 XML with RČ (M12 Q3): never stored. ClamAV (M12 Q6): D-08. Platform effort (M12 Q9): D-10.
- Income-tax XML scope: partial DPFDP7 only for flat-rate users; daňová evidence gets PDF/XLSX podklady (01, 02, 06, M06).
