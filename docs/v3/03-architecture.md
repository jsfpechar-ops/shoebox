# 03: Architecture

## 1. System overview

```
                     ┌──────────── Cloudflare ────────────┐
 e-mail ────────────►│ Email Routing → Email Worker (MIME) │──presigned PUT──► Supabase Storage (EU)
                     └────────┬───────────────────────────┘                        ▲
                              │ signed webhook (HMAC)                              │ presigned PUT/GET
 browser / PWA ──────► apps/web (Next.js 15, App Router, RSC, Cloud Run) ──────────┤
                              │  tRPC-free: Server Actions + Route Handlers (REST /api/v1)
                              ▼
                     Postgres 17 (Supabase, eu-central-1)  ◄──── RLS on every tenant table
                              ▲     ▲
                              │     └── pg-boss job queue (same DB)
                              │
                     apps/worker (Node 22, Cloud Run europe-west1)
                       ├── pipeline: ingest → split → classify → extract → validate → categorize → post
                       ├── registries: ARES, CRPDPH (SOAP), VIES, ČNB rates (with caches)
                       ├── LLM gateway: Claude Haiku 5.5 → Sonnet 5.5 escalation (EU region endpoint)
                       ├── bank (Phase 2): e-mail notice parser, statement parsers, matcher (Fio API poller: Later)
                       ├── tax: EPO XML builders + XSD validation (xmllint), PDF renderers
                       └── outbound e-mail: Amazon SES (EU region) for auth e-mails, digests, share links
```

## 2. Architecture decision records (ADRs)

Each ADR uses the format: Context → Decision → Consequences → Alternatives considered. Status is "Accepted" unless marked otherwise.

### ADR-001: TypeScript end-to-end
- **Context:** The product's latency is dominated by LLM calls (2–10 s) and third-party registries (0.1–0.5 s). Our own compute is < 5 ms per document. Correctness of money and tax logic, a shared type system, and productivity of an AI coding agent (Fable) matter more than raw speed.
- **Decision:** TypeScript (strict) for web, worker, shared domain packages and edge workers. Node 22 LTS runtime.
- **Consequences:** One language, and domain types shared between UI and backend. Native-speed needs (XSD validation, image processing) use battle-tested native tools (`xmllint`, `sharp`/libvips, `pdfium` via `pdfjs-dist`).
- **Alternatives:**
  - **Python/FastAPI** (V2): two languages and duplicated types.
  - **Rust:** no measurable benefit for an I/O- and LLM-bound workload, slower iteration for an agent. Revisit only for a profiled hot path, as a separate service or WASM module.
  - **Assembly:** not viable.

### ADR-002: PostgreSQL (Supabase) as the system of record, with RLS
- **Decision:** Supabase Postgres 17 in EU (Frankfurt). Supabase Auth. Row-Level Security on every tenant-scoped table, keyed by `org_id` via `auth.jwt()` claims plus a `memberships` lookup. Drizzle ORM for schema and migrations. Money in `numeric(15,2)`. FX in `numeric(12,6)`. All timestamps `timestamptz`. Legal dates `date`.
- **Consequences:** No separate tenant isolation layer. The worker connects with a service role and **must** set `app.org_id` per job (enforced by a `withTenant()` helper and a lint rule).
- **Alternatives:** Neon/RDS + custom auth (more glue); MongoDB (wrong fit for accounting).

### ADR-003: Job queue in Postgres (pg-boss)
- **Decision:** pg-boss for pipeline jobs, scheduled jobs (rates, deadlines, bank polling) and retries with exponential backoff, plus dead-letter queues. Idempotency key on every job (`{org_id}:{stage}:{document_id}:{version}`).
- **Alternatives:** Cloud Tasks or PubSub (extra vendor coupling), Redis/BullMQ (extra infra). Revisit above ~50 jobs/s.

- **Deployment (2026-10-18):** the worker runs as a Cloud Run worker pool (GA 2026-04), 1 instance; add autoscaling only above ~5 jobs/s (pg-boss peak is ~0.6 jobs/s even at 100× MVP load).

### ADR-004: Object storage on Supabase Storage (EU), behind an S3-compatible interface
- **Decision:** For the MVP, use Supabase Storage in the same EU project as the database. This means one vendor and one auth model, and storage RLS reuses the org policies. Code talks to a `BlobStore` interface (S3 API), so moving to Cloudflare R2 later (if egress costs matter) is a config change.
  - Layout: `org/{org_id}/files/{sha256}` (content-addressed, dedup within tenant), `org/{org_id}/eml/{message_id}.eml`, `org/{org_id}/exports/…`, `org/{org_id}/filings/…`.
  - Lifecycle: raw `.eml` deleted after 90 days; finalized document files retained 10 years + 1 (VAT §35); trash hard-deleted after 30 days.
- **Alternatives:** R2 (cheaper egress, extra vendor); S3 (egress costs).

### ADR-004b: Vendor minimalism (maintenance rule)
- **Decision:** The MVP runs on exactly four platforms:
  1. **Supabase:** Postgres, Auth, Storage.
  2. **Google Cloud:** Cloud Run for the web app and the worker (Vertex AI `eu` only as the LLM fallback). Region `europe-west1` (Belgium): pricing tier matters more than country, so pick a Tier 1 EU region.
  2b. **Anthropic:** the Claude API for extraction (ADR-011, owner decision 2026-10-18; global/US processing).
  3. **Cloudflare:** inbound e-mail only.
  4. **Amazon SES (EU region, e.g. `eu-central-1`):** outbound e-mail only (Supabase Auth SMTP, M09 digests and urgent e-mails, M10 share links, M12 export links). Added 2026-10-18: the founder already runs SES for another product, so the account, DKIM/SPF setup and bounce handling are known; it adds about 0.25 day/year (sending-domain DNS, suppression list review). Decision D-07 (`22-open-questions.md`); the adapter interface `OutboundMailer` keeps a swap cheap.

  Sentry is the only SaaS add-on. Product analytics are **first-party aggregate counts** in Postgres (counts by event kind, no content; M12 §4.6), not a SaaS. Every new vendor needs an ADR that states its yearly maintenance cost.

### ADR-005: Inbound e-mail via Cloudflare Email Routing + Email Worker
- **Decision:** Catch-all on `in.<domain>`. Per-tenant address `{slug}-{random8}@in.<domain>` (rotatable), plus per-purpose aliases (`+banka` for bank notifications). The Worker (≈150 lines) parses MIME (`postal-mime`), uploads the raw `.eml` and attachments to storage through a presigned URL issued by the web app, and POSTs an HMAC-signed webhook to `apps/web /api/internal/inbound-email`. **Nothing is dropped at the edge** except hard size limits (25 MB, SMTP reject). Mail with a verified `spf=fail` **and** `dkim=fail` is **quarantined, not dropped** (revised 2026-10-18): it is stored, nothing is processed, and the owner sees it under Inbox › Ostatní › "Zadržené e-maily" with "Uvolnit" (release); quarantine is hard-deleted after 30 days (M01 §4.1.2). Reason: legitimately forwarded mail can fail both checks. `List-Unsubscribe` is a *signal*, not a drop rule (V2's rule would lose real invoices). We never send anything to the sender (no backscatter).
- **Alternatives:** Postmark/Mailgun inbound (paid, also fine; keep the adapter interface `InboundEmailProvider`).

### ADR-006: Deterministic-first extraction, LLM second, hard math gate
- **Decision:** Extraction order:
  1. Embedded **ISDOC** (PDF attachment or `.isdoc`/`.isdocx`).
  2. **QR Faktura / QR Platba+F** (SID/SPD) decoded from page images.
  3. **PDF text layer** + regex/heuristic parsers for a vendor-template registry (Alza, IKEA, Booking, …), *optional*.
  4. **LLM** (Claude Haiku 5.5, JSON schema output, effort `low`) with the page images and text.
  5. **Escalation** to Sonnet 5.5 when the math gate fails, required fields are missing, or confidence < threshold.

  Every field records `source` and `confidence`. The deterministic validator (`modules/M03`) runs after every stage. A document cannot be finalized while a **blocking** rule fails.
- **Consequences:** Costs fall with ISDOC/QR prevalence. The LLM is swappable behind `LlmExtractor` (provider and model in config, prompts versioned). The evaluation harness (`modules/M12`) gates prompt and model changes.

### ADR-007: Money, rounding and dates
- **Decision:**
  - A `Money` value object (`decimal.js` with 28 significant digits, ROUND_HALF_UP) and a `Currency` code. No floats anywhere in domain code (lint: ban `number` arithmetic on money-typed values via a branded type).
  - Rounding rules per context, implemented as named functions in `packages/domain/rounding.ts`:
    - VAT per rate on a document: `round2(base × rate)`.
    - Supplier's printed totals are authoritative. Any difference ≤ 1.00 CZK becomes a `rounding` line.
    - Cash payment rounding: to whole CZK.
    - Tax return fields: whole CZK, per the form instructions in `research/czech-tax-filings.md`.
    - Tax base for DPFO: rounded down to whole hundreds.
  - Legal dates use `date` (no TZ). "Today" is computed in `Europe/Prague`.

### ADR-008: Law as versioned data (rule tables); see `06-maintenance-playbook.md`
- **Decision:** `packages/domain/rules/` contains typed, effective-dated rule sets per jurisdiction: VAT rates, VAT registration thresholds, KH limit, flat-rate percentages and caps, paušální daň bands and amounts, minimum advances, tax credits, deadlines generators, EPO form versions and XSD URLs, the ČNB rate rule, and the cash payment limit (270 000 Kč; €10 000 from 10 Jul 2027). `rules.at(date)` resolves the applicable set. Changes ship as data PRs with tests. A `rules_overrides` DB table allows hotfixes without deploy (admin-only, audited).

### ADR-009: Bank connectivity, licence-free first
- **Decision:** Per `research/bank-connectivity.md`:
  - **Phase 2:** statement file import (GPC/ABO, CAMT.053, MT940, bank CSVs) and bank notification e-mails to the `+banka` alias (per-bank templates).
  - **Later:** Fio API token (then MONETA/Creditas tokens), behind the flag `features.bank_fio_api`, only after the legal opinion L-01 (does polling a user-generated token count as AIS?). This matches `02-scope-and-phases.md` ("Later: Fio/bank APIs").
  - **Later, after revenue:** PSD2 aggregator (Finbricks or Salt Edge) under their licence.

### ADR-010: Monorepo layout
```
apps/
  web/              Next.js 15 (App Router, RSC, Server Actions), Tailwind 4, shadcn/ui; REST /api/v1 (MCP endpoint /api/mcp: Later)
  worker/           pg-boss workers, schedulers
  email-worker/     Cloudflare Worker (inbound e-mail)
packages/
  domain/           pure TS: Money, dates, rules engine, taxonomy, VAT routing, KH routing, ledgers (NO I/O)
  db/               Drizzle schema, migrations, seeds, RLS policies, typed queries
  pipeline/         stage orchestration, idempotency, job payload schemas (zod)
  extraction/       ISDOC parser, QR (zxing-wasm) decoder, PDF text, vendor templates, LLM prompts + schemas
  validation/       rule catalog (M03), each rule = pure function + metadata
  registries/       ARES REST, CRPDPH SOAP, VIES REST, ČNB rates clients (+ caching, rate limits)
  bank/             parsers (GPC/ABO, CAMT.053, MT940, CSV), e-mail notice parsers, matcher (Fio client: Later)
  tax-xml/          EPO builders (DPHDP3, DPHKH1, DPHSHV; DPFDP7 partial for flat-rate users only), XSD files vendored + validator. No ČSSZ/ZP builders (01 §6).
  exports/          accountant package, Pohoda, ISDOC writer, CSV/XLSX, ZIP (Money S3 later)
  ui/               design system components, tokens (07-design-system)
  platform/         logger, telemetry, signed webhooks, file admission, LLM budget wiring, eval CLI (M12)
  i18n/             cs (source of truth) + en message catalogs (ICU)
  testkit/          factories, golden-set loader, fake registries
testdata/
  golden-v1/        anonymized real documents + labels (see README there)
```
Rule: `packages/domain` has **no** dependencies on I/O packages, so it is fully unit-testable. Account-based double-entry is not built, but `documents`/`document_lines` carry enough data that a future `journal_entries` table can be derived.

### ADR-011: LLM provider and data handling
- **Decision (changed 2026-10-18, owner):** Claude models via the **Anthropic Claude API directly** (not Vertex/Bedrock). The EU-only requirement is waived for the LLM: processing is global/US. Needs: Anthropic's DPA with Standard Contractual Clauses (or EU–US Data Privacy Framework) signed, Anthropic listed as a sub-processor in our DPA and privacy notice, zero-data-retention requested where available, and only the data extraction needs sent. Previous choice (Vertex `eu` multi-region) kept as the fallback if a customer contract requires EU processing. Provider-agnostic gateway interface (`LlmClient`) with: structured output (JSON schema / tool use), image input, per-call cost accounting, retries, prompt caching of the static system prompt and few-shot examples. A Batch API path for non-urgent re-processing is **Later** (M02 §4.10). No training on customer data (verify provider terms). Raw prompts and responses are stored for 30 days only (debugging), then reduced to the parsed result + token counts.
- **Cost guardrails:** per-tenant monthly LLM budget with alerting. Vendor memory (`vendor_profiles`) skips the LLM for categorization of repeat suppliers. ISDOC/QR skip the LLM for extraction.

### ADR-012: Auth and roles
- **Decision (owner, 2026-10-25, the reference app style):** Supabase Auth with **passkey and e-mail only**: no password, no Google or Apple. First sign-in by e-mail link; then one tap offers a passkey (Supabase passkeys, beta since 2026-05 **[verify GA before Phase 1 launch]**); the e-mail link stays the fallback and the recovery path. TOTP MFA (required for owners after the first filing is generated). One firm per user; the role model stays so an accountant can be invited to several OSVČ (Phase 2). Roles per organization: `owner`, `member`, `accountant` (read + export + comment; can be invited by e-mail), `viewer`. **Later** (with the public API, 02): OAuth2 (authorization code + PKCE) for third-party apps and personal access tokens scoped by role.

## 3. Pipeline (state machine per document)

```
received ─► split ─► classified ─► extracted ─► validated ─► categorized ─► ready ─► finalized
   │          │          │             │             │             │            │
   └──────────┴──────────┴─────────────┴─────────────┴─────────────┴──► needs_review (any stage)
                                                                         supporting (non-bookable class: kept, linked, never booked; 04 §2.4)
                                                                         duplicate (linked to original)
                                                                         failed (dead-lettered; "Zkusit znovu")
```
- Each transition is a pg-boss job. Payloads are zod-validated. Each stage is **idempotent** and versioned (`stage_version`), so re-processing after a prompt or rule upgrade is safe.
- `ready` means all blocking validations pass and confidence ≥ threshold, so finalization is automatic unless the tenant setting `auto_finalize = false`.
- `finalized` documents are immutable. Corrections create a new revision (`document_revisions`, 05 §4) with an audit trail. After a filing that includes the document has been generated, edits trigger an "amendment needed" alert.
- Manual entries without a photo and spreadsheet rows skip `split → classify → extract` and start at `validating` (04 §2.2a, M01 §4.11).

### 3.1 Job and event names (canonical)

pg-boss job names are `<domain>.<action>`; events (published as pg-boss topics) are `<entity>.<past_participle>`. Payloads are zod-validated and carry ids only.

| Kind | Canonical names (owner) |
|---|---|
| Pipeline stage jobs | `doc.split`, `doc.classify`, `doc.link_supporting` (M01) · `doc.extract`, `extract.llm`, `extract.llm_escalated`, `extract.learn_hints` (M02) · `doc.validate`, `validate.registry_retry`, `validate.scope`, `validate.catalog_upgrade` (M03) · `doc.categorize` (M04) |
| Ingestion jobs | `ingest.item.process`, `ingest.expand`, `ingest.bundle.assemble`, `ingest.rescan`, `ingest.cleanup`, `email.received`, `email.render_body`, `expected.sweep`, `import.spreadsheet.parse`, `import.spreadsheet.run` (M01) |
| Ledger jobs | `ledger.rebuild_document`, `ledger.rebuild_transaction`, `ledger.rebuild_org`, `ledger.verify` (M04; VAT rules from M05) |
| Other module jobs | `vat.period.evaluate`, `vat.filing.generate`, `vat.workbook.generate`, `vat.amendment.detect` (M05) · `podklady.generate` (M06) · `bank.*` (M07) · `obligations.generate`, `obligations.nightly`, `notifications.evaluate`, `notifications.digest`, `notifications.urgent` (M09) · `package.*` (M10) · `retention.*`, `privacy.*`, `ops.*` (M12) |
| Events | `document.received`, `document.classified`, `document.extracted`, `document.validated`, `document.categorized`, `document.status_changed`, `document.revised`, `document.duplicate_detected`, `document.paid_at_changed`, `ledger.document_rebuilt`, `profile.changed`, `fx.rates_imported`, `registry.recovered`, `transactions.imported`, `bank.link_created`, `bank.link_removed`, `filing.state_changed`, `filing.amendment_needed`, `package.state_changed`, `obligation.created`, `obligation.state_changed`, `rules.overrides_changed`, `government_filing.ingested` |

Idempotency key per ADR-003: `{org_id}:{stage}:{entity_id}:{version}`.

## 4. Non-functional requirements

| Area | Requirement |
|---|---|
| Availability | 99.5 % monthly for the web app. The pipeline degrades gracefully: if the LLM is down, deterministic extraction continues and LLM jobs queue. |
| Latency | Upload→ready p50 < 15 s, p95 < 60 s. Dashboard TTFB < 500 ms. |
| Scale target | 10 000 tenants, 200 000 documents/month, 1 M bank transactions/month without re-architecture. |
| Data residency | All storage and processing in the EU. Sub-processors are listed in the privacy policy. |
| Security | OWASP ASVS L2. Secrets in the platform secret manager. Dependency scanning. Signed webhooks. CSP. Rate limits. See M12. |
| Accessibility | WCAG 2.2 AA (07 §8). |
| Localization | Czech is the source language. English second. Every user-facing string goes through i18n (no hard-coded strings; lint). |
| Observability | OpenTelemetry traces across web→queue→worker→LLM. Sentry for errors. Product analytics = first-party aggregate counts in Postgres (no document content, no third-party analytics SaaS; ADR-004b, M12 §4.6). |
| Backups | Supabase PITR (7 days) + daily logical dump to a separate EU bucket (35 days). Quarterly restore drill. |
