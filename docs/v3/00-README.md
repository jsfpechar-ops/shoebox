# Shoebox V3: build specification

This folder is the **complete specification** for building the MVP and its next phases. It is executed through the agent workflow in `../../AGENTS.md`: an orchestrator (Fable 5.1 or Opus 5.5) turns backlog tickets into briefs, Haiku 5.5 implements them, the founder reviews and merges.

## Reading order

| # | File | What it decides |
|---|---|---|
| 01 | `01-product.md` | Positioning (organizer + accountant hand-off, not accounting software), principles, personas, non-goals, metrics |
| 02 | `02-scope-and-phases.md` | Phases 0–4, what is in each, exit criteria |
| 03 | `03-architecture.md` | System design and ADRs (TypeScript, Supabase, pg-boss, Cloud Run, Vertex AI, deterministic-first extraction, law as data) |
| 04 | `04-domain-model.md` | **Canonical names and enums.** Document classes, tax-document status, dates, categories, VAT treatments, ledgers, "simple period" |
| 05 | `05-data-model.md` | **Canonical PostgreSQL schema** + RLS + retention |
| 06 | `06-maintenance-playbook.md` | How the app stays correct with ~1–2 weeks/year of upkeep: rule tables, drift monitors, yearly update window, scope limits |
| 07 | `07-design-system.md` | Visual style, tokens, typography, motion, accessibility, fewer-clicks rules |
| 22 | `22-open-questions.md` | Decisions, legal items, verifications, deliberate gaps, risks |
| — | `modules/M01…M12` | Detailed module specs (behavior, algorithms, interfaces, UX, acceptance criteria, maintenance) |
| — | `backlog.md` | Ordered epics and tickets with acceptance criteria and dependencies |
| — | `../../AGENTS.md` | How coding agents work on this repo (roles, models, token limits, briefs) |

## Module map

| Module | Phase | Summary |
|---|---|---|
| M01 Ingestion and classification | 1 | upload, e-mail, camera; normalize, dedupe, split; *what is this document?* |
| M02 Extraction | 1 | ISDOC → QR → PDF text → LLM (Haiku → Sonnet); provenance per field |
| M03 Validation | 1 | rule catalog: math gate, registries, legality, identity, duplicates, limits |
| M04 Categorization and ledgers | 1 | category + VAT treatment per line; vendor memory; tax and VAT ledgers |
| M05 Simple VAT | 3 | IO DPHDP3; simple-payer DPHDP3 + KH + SH; else VAT workbook for the accountant |
| M06 Income-tax podklady | 4 | annual summary (PDF/XLSX) for everyone; partial DPFDP7 XML only for flat-rate expenses |
| M07 Bank and payments | 2 | statement import, notification e-mails, matcher, missing-documents radar, QR/ABO |
| M08 Invoicing | later | *not specified in V3*; see internal research (not published) |
| M09 Dashboard, alerts, deadlines | 1 | Přehled widgets, limit meters, obligations generator, notifications |
| M10 Accountant hand-off and exports | 1–2 | monthly package, completeness, accountant seat, Pohoda/ISDOC/XLSX exports |
| M11 UX and screens | 1 | four screens, onboarding, document detail, review flow, Czech copy glossary |
| M12 Platform, ops, security | 0+ | tooling, CI/CD, RLS tests, GDPR, observability, admin, evaluation harness |

## Evidence base

All facts about competitors, formats and Czech tax law come from `../../research/`. Each claim there is labelled [O] observed, [I] inferred or [?] unknown. Specs cite those files. Where a spec says **[verify]**, Fable must check the primary source (XSD, API docs) at implementation time and record the result in the PR.

## Test data

`../../testdata/golden-v1/` holds anonymized real documents (12 bookable, 6 decoys, 2 duplicates) with labels. It is the acceptance gate for Phase 1 and part of Phase 3.
