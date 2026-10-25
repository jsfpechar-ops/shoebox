# 06: Maintenance playbook (keep it sustainable)

**Goal:** the app keeps working year after year with **about 1–2 weeks (7–14 working days) of planned maintenance per year for law and format changes**. Everything below exists to make that true. Product tuning and platform hygiene are budgeted separately in §1.1 so they cannot hide inside the law budget.

## 1. Where change comes from, and how we contain it

Recomputed on 2026-10-18 from the Maintenance sections of M01–M12. Overlaps between modules (the same rate change counted in M03, M04, M05, M06 and M09; one model switch counted in M01, M02 and M04; Renovate counted in M01, M11 and M12) are counted once.

| Source of change | Frequency | Containment | Modules (their estimate) | Yearly effort |
|---|---|---|---|---|
| Tax numbers: rates, thresholds, paušální daň amounts and ceilings, minimum advances, credits, deadlines, public holidays, authority accounts | yearly, sometimes mid-year (paušál band I was cut retroactively in 2026) | **Rule tables** (§2). Data PR + tests. Hotfix via `rules_overrides` without deploy. | M03 0.5, M04 0.5, M05 0.5, M06 0.5, M07 0.5, M09 1.1 | **2–3 days** (was 1–2) |
| EPO XML structures (DPHDP3, DPHKH1, DPHSHV) | ~1–2 versions/year, usually small | Vendored XSDs + golden XML tests + **drift monitor** (§3). Builders are table-driven: row → attribute map lives in data. | M05 2–3, M04 0.5–1 (row map, shared) | **2–3 days** |
| Income-tax podklady (Phase 4) | yearly form changes | **We don't generate the full DPFDP7.** PDF/XLSX do not depend on the form; the *optional* partial XML exists only for flat-rate users (≤ 12 attributes) and is hidden when its XSD is missing. | M06 1–2 | **1–1.5 days** |
| Registries: ARES REST, CRPDPH SOAP, VIES REST, ČNB rates | rare (ARES moved to v1.4; CRPDPH changed endpoint host) | One small client per registry with contract tests against recorded responses, daily health check, graceful degradation (a validation becomes "neověřeno" and never blocks). | M03 0.5–1 | **0.5–1 day** |
| Bank formats (statement files, notification e-mails, authority accounts) | occasional per bank | Each parser is a small isolated module with fixtures, enabled only with real fixtures. Unknown formats fall back to the CSV column-mapping wizard. Parse failures alert. | M07 1.5–3.5 | **1.5–3 days** |
| Accountant export formats (Pohoda XSD, ISDOC) | rare | Vendored XSDs, table-driven builders, monthly XSD drift job. | M10 1–2 | **1–1.5 days** |
| **Subtotal: law and formats (the 7–14-day target)** | | | | **8–13 days** ✅ within target, at the top end in a heavy year |

### 1.1 Outside the law budget (tracked separately; decision D-10)

| Source of change | Containment | Modules (their estimate) | Yearly effort |
|---|---|---|---|
| AI models and prompts (deprecations, new versions, API changes) | Provider-agnostic `LlmClient`, prompts versioned, **eval harness gates every switch** (golden + synthetic set). One switch = one eval run over 3 prompts (`classify`, `extract`, `categorize`). | M01 0.5, M02 1.5–2.5, M04 0.5–1 | **1.5–2.5 days** |
| Product tuning data: classification cues, keyword/platform/NACE lists, vendor layouts, validation tolerances, personal-purchase list | data files + unit tests + eval; monitors on reclassification, dismissal and fallback rates | M01 1, M02 0.5, M03 1, M04 1.5 | **3–4 days** ⚠️ |
| UI copy, glossary, yearly accessibility pass | i18n catalog; manual keyboard + screen-reader pass | M09 0.25, M11 1.5 | **1.5–2 days** |
| Platform hygiene: Renovate majors, security re-check, restore drills, secret rotation, eval baseline, container images (ClamAV, Chromium), SES sending domain | M12 runbooks; drills **twice a year** (simplified from quarterly) | M12 7–8 → 6–7, M01 0.5 (images, shared), M11 1 (deps, shared) | **6–7 days** ⚠️ |
| **Subtotal outside the law budget** | | | **12–15.5 days** |

**Total planned upkeep: 20–28.5 working days per year (≈ 4–6 weeks).** ⚠️ This **exceeds** the "1–2 weeks/year" headline, which only ever covered law and formats. The law-and-format part (8–13 days) meets its target; the overrun comes from product tuning (3–4 days) and platform hygiene (6–7 days). Founder decision D-10 (`22 §A`), default: accept and track the three buckets separately in the yearly review; the next cuts, in order, are (1) automerge minor runtime dependencies, (2) disable bank parsers nobody uses, (3) freeze the classification keyword lists after the pilot and rely on vendor memory.

Modules over the 3-day/year bar of §5.6 (each with its explicit decision): **M04** 3–4 days (core product: categorization, accepted in M04 §10), **M05** 3–4 days (EPO formats, within the EPO line above), **M07** up to 4.5 days in a year when several banks change formats (accepted: the wizard keeps users working), **M12** 6–7 days (platform, D-10).

## 2. Rule tables: how law lives in data

- Location: `packages/domain/rules/cz/<year>.ts`, typed with a zod schema `RuleSet`.
- Each value has `valid_from` / `valid_to` and a `source` URL (the law or official page) plus a `verified_at` date.
- Resolution: `rules.at(date)` merges base year data + mid-year amendments + `rules_overrides` from the DB (admin hotfix, audited, requires `reason` and `source`).
- **Every rule has at least one test** asserting its value on a known date, and a test asserting the *previous* value the day before a change.
- This is the **only** list of rule keys (merged from M01–M12 on 2026-10-18). A module that needs a new key adds it here in the same PR.

### 2.1 Law keys

Cadence: **Y** = yearly in the Annual Update Window (§4) · **L** = when the law changes (any time, `rules_overrides` hotfix) · **F** = when an EPO form version changes · **R** = rare, reviewed yearly.

```
key                                value (2026)                                                          owner  cadence
vat.rates                          {standard: 21, reduced: 12}                                           M05    L
vat.registration_thresholds        {calendar_year: 2_000_000, immediate: 2_536_500}                      M09    Y
vat.registration_turnover_policy   {exclude_treatments: [iss_eu_service, iss_eu_goods, iss_non_eu_service,
                                    iss_export_goods, iss_exempt], always_include_categories: [income_accommodation]}
                                                                                                         M09    R [verify]
vat.kh_document_limit              10_000                                                                M05    R
vat.simplified_document_limit      10_000                                                                M03    R
vat.io_eu_goods_threshold          326_000                                                               M09    R
vat.deduction_deferral_years       2                                                                     M03    R
vat.ruceni_cash_threshold          270_000                                     (§109 relevant amounts)   M07    R [verify]
vat.cnb_rate_rule                  'rate_valid_on_date_else_last_published'                              M04    R
vat.deadline_day                   25                                                                    M05    R
vat.simple_period_policy           {version, allowed_treatments:{…}, forbid_document_classes, forbid_line_types,
                                    max_docs: 150, max_rates_per_eu_goods_document: 1, …}  (M05 §4.3)    M05    per release
vat.return_rounding                'sum_entries_then_round'  (alt. 'round_base_then_multiply'; D-11)      M05    R
vat.shv_rounding                   'ceil'                                                                M05    R [verify]
vat.amendment_windows              {dp3_dodatecne_due: 'end_of_month_after_discovery', kh_nasledne_working_days: 5}
                                                                                                         M05    R [verify]
vat.eu_member_states               EU-27 incl. CZ (consumers exclude CZ); 'XI' only for goods            M05    R
vat.out_of_scope_categories        [pt_tourist_fee, pt_deposit, pt_customs_vat]                          M04    R [verify bank fees]
vat.reduced_rate_categories        []                                                                    M04    R
pausalni_vydaje.rates_caps         {80: 1_600_000, 60: 1_200_000, 40: 800_000, 30: 600_000}              M06    Y
pausalni_dan.bands                 [{band:1, monthly: 9_162, ceilings:[{max_income:1_000_000},
                                      {max_income:1_500_000, requires_dominant_rate_in:[80,60]},
                                      {max_income:2_000_000, requires_dominant_rate_in:[80]}]},
                                    {band:2, monthly: 16_745, ceilings:[{1_500_000},{2_000_000,[80,60]}]},
                                    {band:3, monthly: 27_139, ceilings:[{2_000_000}]}]                   M06    Y + L
pausalni_dan.eligibility           {max_income: 2_000_000, max_other_income: 50_000}                     M06    Y
pausalni_dan.deadlines             {entry: '01-10', exit: '01-10', advance_day: 20}                      M09    R
income_tax.rates                   {r1: 15, r2: 23, threshold_annual: 1_762_812}                         M06    Y [verify threshold]
income_tax.credits                 {taxpayer: 30_840}                                                    M06    Y
insurance.min_advances             {social: 5_005, health: 3_306}                                        M09    Y
insurance.rates                    {social_pct: 29.2, social_base_pct: 55, health_pct: 13.5, health_base_pct: 50}
                                                                                                         M06    Y
asset.capitalization_threshold     80_000                                                                M04    R
cash.payment_limit                 [{valid_to:'2027-07-09', czk:270_000}, {valid_from:'2027-07-10', eur:10_000}]
                                                                                                         M03    L [verify parallel limits]
calendar.cz_public_holidays        {fixed:[…], movable:{2026:['04-03','04-06'], … 2030}}  (5 years prefilled)
                                                                                                         M09    Y check
deadlines.generators               [{kind:'vat_return', appliesIf:{…}, period, due, shift, amount, source, verifiedAt}, …]
                                   (VAT entries defined in M05 §4.12, income-tax and paušál entries in M06 §4.12,
                                    the rest and the runner in M09 §4.7; `dap` carries the paper/advisor dates as notes)
                                                                                                         M09    Y
municipal.tourist_fee              {praha3: {report_deadline_days_after_month: 15, rate_per_bed_night: 50,
                                    account: '…' [verify]}}                     (extensible per municipality)
                                                                                                         M09    per municipality
bank.authority_accounts            {fu_vat: {prefix:'705', vs:'dic_digits'}, fu_pausal: {prefix:'2866'},
                                    fu_income_tax: [verify], cssz: [verify], insurers: [verify]}         M07    Y [verify]
                                   (also used by M04 hard rule H4 and classifyTransaction)
epo.forms                          {DPHDP3:{version:'03.01.04', verze_pis, xsd, valid_for_periods_from}, DPHKH1:{…},
                                    DPHSHV:{…}, DPFDP7:{tax_years:[…], verze_pis, xsd}}                  M05/M06 F
epo.dphdp3_row_map                 [{row:'5', attrs:['p_sl23_e','dan_psl23_e'], treatment:'rcv_eu_service_reverse_charge',
                                     rate:'standard', side:'output', kind:'source'}, …]                  M05    F
epo.kh_routing                     data version of research/czech-tax-filings.md §1.3.1 (M05 §4.2 step 8)  M05    F
epo.fu_payment_accounts            {c_ufo: {prefix:'705', number:'…', bank_code:'0710'}}  optional; absent → no QR
                                                                                                         M05    R [verify]
privacy.retention_years_after_year 10                                          (VAT §35)                 M12    R
```

### 2.2 Product keys (hotfixable through `rules_overrides`, not law)

Cadence: on need, with an eval run when they affect outputs (M12 §4.10).

```
validation.tol.line_qty_price        {abs: 0.02, rel: 0.0005}                                            M03
validation.tol.line_vat              {abs: 0.02}                                                         M03
validation.tol.vat_row_per_line      0.005 (cap 1.00)                                                    M03
validation.tol.sum                   {abs: 0.01}                                                         M03
validation.rounding.max_czk          1.00   (ADR-007)                                                    M03
validation.rounding.max_foreign      0.05   (currency units)                                             M03
validation.discount_patterns         ['sleva','discount','kupón','kupon','voucher','bonus']              M03
validation.confidence_review_threshold 0.80                                                              M03
validation.name_match_min            0.85                                                                M03
validation.future_date_grace_days    1                                                                   M03
validation.max_document_age_years    11                                                                  M03
validation.duzp_issue_gap_days       15                                                                  M03
validation.dup_fuzzy_days            3                                                                   M03
validation.dup_fuzzy_amount_tol      0.00                                                                M03
validation.personal_purchase         {threshold: 0.5, max_amount_czk: 5000, merchants: […], keywords_ref}  M03
validation.vat_id_patterns           {AT:'^U\\d{8}$', …, XI:…}                                           M03
registry.timeout_ms                  3000                                                                M03
registry.cache_ttl_hours             {ares: 168, crpdph: 24, vies: 72}                                   M03
registry.stale_ok_hours              72                                                                  M03
registry.retry_schedule_minutes      [15, 60, 360, 1440]                                                 M03
fx.max_lookback_days                 7      (one value for M03, M04, M05)                                M04
classification.vendor_memory_min_confirmations 2                                                         M04
classification.auto_accept_confidence          0.80                                                      M04
classification.low_value_skip_czk              100                                                       M04
classification.max_questions_per_document      2                                                         M04
classification.max_service_period_days_for_end 62                                                        M04
classification.recurring_categories            [exp_cleaning, exp_property_management, …]                M04
classification.hard_rules / soft_rules / keyword_rules / platforms / nace_category_map   (seed data, versioned)  M04
classification.global_prior_min_support / global_prior_min_agreement / natural_person_legal_forms
                                               5 / 0.8 / […]   — Later, with global_vendor_priors        M04
```

**Merged or removed during the 2026-10-18 review** (do not reintroduce): `validation.dup_phash_max_distance` → M01 `config.dedupe.phash_candidate_distance`; `validation.expected_invoice_days` → M01 `expected_documents` (`config.link.*`); `validation.vat_threshold_warn_pcts` → M09 `meters.warn_ratio/alert_ratio`; `io_triggers.registration_days` → `deadlines.generators` (`io_registration`); `classification.authority_registry` → `bank.authority_accounts`; `classification.llm` → `llm.models` config (M02); `eu_member_states` → `vat.eu_member_states`; `epo.dphdp3_row_sides` → `side` in `epo.dphdp3_row_map`; `income_tax.dap_deadlines` → `deadlines.generators`; M09's `income_tax.credits.basic`, `insurance.social`, `insurance.health` → `income_tax.credits`, `insurance.rates`.

**Not rule tables** (code config, changed with tests or an eval run): M01 `config.ingest.*`, `config.classify.*`, `config.split.*`, `config.dedupe.*`, `config.link.*`; M02 `extraction.*`, `llm.models`, `llm.pricing`; M12 LLM budgets; M07 `MATCHER_CONFIG`; M09 `meters.*`, `obligations.horizon_days`, `obligations.lookback_days`, `dashboard.deadlines_window_days`, `notify.review_age_days`, `radar.grace_days`; M10 `package.completeness_weights`, `package.share_ttl_days`; feature flags, one prefix `feature.*` stored as product keys in `packages/domain/rules` (no flag service): `feature.dpfdp7_partial`, `feature.bank_fio_api`, `feature.vat_filings`, `feature.bank`.

## 3. Drift monitors (automated early warning)

Nightly scheduled jobs (`ops.drift_monitors`, M12) that **alert the maintainer**, never the users:

| Monitor | How | Alert when |
|---|---|---|
| EPO structure versions | Fetch `adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_seznam.faces`; parse the versions of DPHDP3, DPHKH1, DPHSHV, DPFDP7 | The version differs from `epo.forms` |
| XSD content hash | Download the XSD URLs (EPO, Stormware Pohoda, ISDOC) and compare sha256 with the vendored copies | The hash changed |
| Registry health | Synthetic lookups: ARES (a known IČO), CRPDPH (a known DIČ), VIES, ČNB today's rate | Failure for > 2 consecutive runs, or the response schema differs from the recorded contract |
| Rule freshness | Every rule with `verified_at` older than 13 months; `calendar.cz_public_holidays` missing a year within 12 months | Listed in a weekly digest |
| Bank parser failures | The share of statement imports or notice e-mails that failed to parse, per format | > 2 % over 7 days, or > 5 unparsed notices/day per bank |
| Extraction quality | Daily sample re-scored against user corrections; golden set nightly | Field accuracy drops > 1 pp week over week |
| Classification quality | `needs_review` share from classification, user reclassification rate | > 10 % / > 3 % over 7 days |
| LLM cost | Spend per document, per tenant | > 2× the 30-day baseline |

## 4. Annual Update Window (calendar)

| When | Task | Owner |
|---|---|---|
| **Oct–Nov** | Read the year's tax-law changes (finanční správa news, Zákony pro lidi, Competitor C/Competitor D changelogs as a cross-check). Draft next year's `rules/cz/<year+1>.ts`. | Maintainer |
| **Nov–Dec** | Partner daňový poradce reviews the rule diff (½ day, paid; D-03). Update tests. | Advisor + maintainer |
| **Dec** | Ship next-year rules (effective-dated, so they activate automatically on 1 Jan). Update in-app explanations (Czech copy). Check `bank.authority_accounts` and `calendar.cz_public_holidays`. | Maintainer |
| **Jan** | Paušální daň entry/exit reminders. VAT period choice reminders. Verify new EPO versions (monitors). Submission-guide UI labels on MOJE daně. | Automated + maintainer |
| **Feb–Mar** | Podklady (Phase 4) for the previous year: re-run against the golden scenarios. Support peak. | Maintainer |
| **Any time** | Monitor alert → fix within 5 working days. Mid-year law change → `rules_overrides` hotfix the same day, proper rule PR within a week. | Maintainer |

## 5. Scope boundaries that keep maintenance low

1. **No full DPFDP7, ČSSZ or ZP overviews in V3.** Those are the highest-churn forms. The partial DPFDP7 XML is offered **only to flat-rate users** (výdajový paušál, and paušální daň users only in a year where a return is required); actual-expense users (daňová evidence) get PDF/XLSX podklady for the accountant and no XML. If a full return is added later (option A), the bar is: a tax-advisor partner signs off the rules each year and the feature pays for its maintenance.
2. **"Simple period" gate for VAT outputs (04 §8).** Complex VAT situations get a workbook for the accountant, not a filing. This shrinks the rule surface.
3. **No accounting standards logic** (depreciation schedules, accruals, double entry). The accountant does it, using our exports.
4. **No direct government submission** in V3. That avoids certificate handling, ISDS integration upkeep and liability.
5. **Bank: licence-free channels only** (statement files, notification e-mails) until revenue justifies an aggregator. Token APIs (Fio) are Later and need the legal opinion L-01.
6. **Every new module spec must include a "Maintenance" section:** sources of change, monitors, and yearly effort. If the effort is over 3 days/year, it needs an explicit decision (§1 lists the current ones).

## 6. Simplicity budget (UX and code)

- **Screens:** Inbox · Přehled · Pro účetní · Nastavení. Filings live inside Přehled as cards ("Přiznání DPH za září je připraveno" (September VAT return is ready)). Adding a new top-level screen requires an ADR.
- **Settings:** at most 15 user-facing settings. Smart defaults from the taxpayer profile.
- **Vendors:** four platforms (Supabase, Google Cloud, Cloudflare inbound, Amazon SES outbound) plus Sentry (ADR-004b). No analytics SaaS.
- **Code:** `packages/domain` stays pure and I/O-free. No module may import another module's internals. Shared code goes through package public APIs (enforced by `dependency-cruiser`).
- **Dependencies:** each new runtime dependency is justified in the PR description and has an owner line in `docs/context/decisions.md`. Prefer platform features.
- **One implementation per concept:** one turnover function (M09, also used by M03), one tax-reserve estimate (M06, Phase 4), one obligations writer (M09), one VAT-routing implementation (M05, called by M04's ledger jobs).

## 7. Runbooks (to be written by Fable alongside the code, in `docs/runbooks/`)

- `annual-update.md`: the step-by-step version of §4, with commands.
- `epo-version-bump.md`: vendor the new XSD, diff the attributes, update `epo.dphdp3_row_map`, regenerate golden XML, run property tests.
- `registry-outage.md`: degrade, announce in-app banner, backfill checks when restored.
- `llm-model-switch.md`: run the eval harness, compare, roll out behind a flag, monitor.
- `bank-parser-new-format.md`: add fixtures, write the parser, register it in format detection.
- `restore-from-backup.md`.
- M12 adds: `incident-response.md`, `data-breach.md`, `secret-rotation.md`, `llm-budget-exceeded.md`, `inbound-email-abuse.md`, `privacy-request.md`, `deploy-rollback.md`.
