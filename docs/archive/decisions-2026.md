# Decisions archive 2026

Full lines compacted out of [decisions](../context/decisions.md) on 2026-10-18. Still in force; the summary line there lists them.

- 2026-10-18 [deps] pnpm 10 (exact version pinned) via Corepack. Reason: M12 §4.1 workspace layout, strict peers. (owner, P0-OWN-01)
- 2026-10-18 [deps] Turborepo for task orchestration and caching. Reason: 03 ADR-010. (owner, P0-OWN-01)
- 2026-10-18 [deps] Biome 2 as linter and formatter, with GritQL plugins for the custom rules. Reason: one tool for lint and format, M12 §4.1. (owner, P0-OWN-01)
- 2026-10-18 [deps] Vitest for unit, db and ui test projects. Reason: M12 §4.1. (owner, P0-OWN-01)
- 2026-10-18 [deps] fast-check for property tests (money, VAT, rules). Reason: hard rule 1. (owner, P0-OWN-01)
- 2026-10-18 [deps] Playwright + @axe-core/playwright for e2e with axe on every page. Reason: M12 §4.1, 07 accessibility. (owner, P0-OWN-01)
- 2026-10-18 [deps] dependency-cruiser for the import boundary rules in CI. Reason: M12 §4.1 (domain-is-pure, no-cross-internals). (owner, P0-OWN-01)
- 2026-10-18 [deps] Renovate with the M12 §4.1 config (14-day minimum release age, majors via dashboard). Reason: low-maintenance updates. (owner, P0-OWN-01)
- 2026-10-18 [deps] gitleaks in CI and pre-commit for secret scanning. Reason: M12 §4.13 Secrets. (owner, P0-OWN-01)
- 2026-10-18 [deps] decimal.js as the only number type behind `Money`. Reason: ADR-007, hard rule 1. (owner, P0-OWN-01)
- 2026-10-18 [deps] zod for runtime validation at every boundary. Reason: one schema library; allowed in packages/domain. (owner, P0-OWN-01)
- 2026-10-18 [deps] @supabase/ssr + Supabase CLI (local stack, migrations, RLS tests). Reason: 03 stack decision. (owner, P0-OWN-01)
- 2026-10-18 [deps] Tailwind 4 mapped to the 07 design tokens. Reason: 07-design-system. (owner, P0-OWN-01)
- 2026-10-18 [deps] Inter self-hosted via next/font (no Google Fonts request at runtime). Reason: 07 typography, privacy. (owner, P0-OWN-01)
- 2026-10-18 [deps] pino for structured logs, no document content. Reason: hard rule 4, M12 §4.7. (owner, P0-OWN-01)
- 2026-10-18 [deps] Sentry SDK with an EU-region project, PII scrubbing on. Reason: M12 §4.7, hard rule 4. (owner, P0-OWN-01)
- 2026-10-18 [deps] OpenTelemetry SDK for traces. Reason: M12 §4.7 Observability. (owner, P0-OWN-01)
- 2026-10-18 [deps] ts-morph only as the fallback for custom lint rules if Biome GritQL plugins fall short (T-17). Reason: M12 §4.1. (owner, P0-OWN-01)
- 2026-10-18 [workflow] Phase run: one Fable session per phase works on `phase/N`, runs up to 4 executors in parallel, merges approved PRs into `phase/N` itself and stops at the GATE ticket; the owner merges `phase/N` into `main` after reading the HIGH-risk diffs on the gate list. Reason: one-by-one owner merges were the bottleneck. (owner)  (superseded by the Opus-led phase run line)
- 2026-10-18 [stack] PostHog removed from 03; product analytics are first-party aggregate counts. Reason: ADR-004b vendor minimalism. (orchestrator)
- 2026-10-18 [stack] Default for D-07: Amazon SES in an EU region as the 4th platform (outbound e-mail only), noted in ADR-004b; the owner already runs SES. Pending owner confirmation. (orchestrator, proposed to owner)
- 2026-10-18 [design] UI style Minimalism/Swiss + Accessible & Ethical, Inter, tokens in 07-design-system. Source: ui-ux-pro-max skill. (owner asked, orchestrator chose) Superseded 2026-10-25 [design].
