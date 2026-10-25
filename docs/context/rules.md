# Rules (full text of the AGENTS.md hard rules)

## Money and tax

- Amounts are `Money` (decimal.js; `numeric(15,2)` in the database, as in 05), never `number`. Rounding follows ADR-007 in `docs/v3/03-architecture.md`.
- Every rate, limit, threshold, deadline, form version and row map comes from `packages/domain/rules` via `rules.at(date)`. A tax number anywhere else is a review failure.
- Every rule value has a source link and an effective date (`docs/v3/06-maintenance-playbook.md`).
- Property tests (fast-check) for money and VAT math; golden fixtures for every XML builder, validated against the vendored XSD.

## Extraction and AI

- Deterministic sources first: ISDOC, then QR (SPAYD/SID), then PDF text, then the LLM (ADR-006).
- LLM output is parsed against a zod schema; it never writes to a ledger directly. M03 checks decide `ready`.
- Every extracted field keeps its provenance (source, confidence).
- Prompts and model ids live in `packages/extraction`; a model change is a decisions line plus an eval run.

## Database

- Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only, Postgres 17 (local sandbox tests still run on a plain Postgres 16, see K-P03). Names exactly as in `docs/v3/05-data-model.md`.
- Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR. Global tables (listed in 05) have no `org_id` and are read-only to app roles.
- No raw SQL outside `packages/db`. No `select *` in app code.

## Privacy and security

- Never commit real documents, `.env`, keys or personal data. `testdata/` holds only anonymized material with a README saying so. The PII guard in CI (gitleaks + Czech rules: account numbers, rodná čísla, IBANs, DIČ from a birth number) blocks the PR; public company IDs are allowlisted in `.gitleaks.toml`.
- Logs and Sentry get ids and error codes, never document content, names, IBANs or amounts tied to a person.
- All processing and storage in EU regions (Supabase EU, Cloud Run europe-west1). Exception: LLM calls go to the Anthropic Claude API directly (global/US processing; owner decision 2026-10-18, ADR-011); send only what extraction needs, never store prompts longer than ADR-011 allows.
- New outbound request or processor: give the reason in the PR and add a decisions line.

## Screens and copy

- Four screens only: Inbox, Přehled, Pro účetní, Nastavení (`docs/v3/01-product.md`). A new top-level screen needs an owner decision.
- English is the source language for now (owner 2026-10-25); the Czech catalog is kept dormant for later. Use the M11 glossary; no accounting jargon in the default view.
- Components come from `packages/ui` (shadcn/ui based) using the tokens in `docs/v3/07-design-system.md`. No raw hex, no emoji icons, Lucide only.
- WCAG 2.2 AA minimum: visible focus, 44×44 px targets, labels on every input, works with keyboard only, respects reduced motion.
- Fewer clicks: the common path for a document is zero clicks (auto) or one (confirm).

## Git

- Branches `task/NNNN-<short-name>`. One brief, one PR. Never push to `main`; the owner merges.
- Commit messages `NNNN step k`. PR body: the report, plus `[verify]` findings.

## Outside world

- Never e-mail real third parties, submit to EPO / ČSSZ / insurers, call a bank to move money, or create accounts. Generate the file; the user uploads it.
- Test against fakes in `packages/testkit`; live APIs only with `--live` and the owner's keys.
