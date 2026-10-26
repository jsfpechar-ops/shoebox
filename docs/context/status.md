# Status

Updated: 2026-10-26.

## Now

- 0514–0516: free pre-check skips clear non-invoices (0 tokens); bad answers fail at once. Epic CLS still to build.
- Lane B (0075–0077, 0201–0211, #3, #14, #16): ISDOC read without AI, QR/PDF text before AI, ID checks, math gate, supplier memory, registry warnings, ISDOC export, import core.
- Page sorting (0500–0513, PR #11): each upload drop goes to `doc.split`; Haiku maps pages, rules join/split, unsure = Yes/No question (pages card + review deck); Read again, separate pages, Add a missing page, late page within 7 days asks. Not yet run on real stacks.
- Lane D screens done (0400–0411, PRs #12–#19): Sysel name + app icon, register + Excel, trash, add by hand, review questions, accountant ZIP, settings, PDF click-to-fill, audit_log on fixes, nightly encrypted backup (owner adds 4 secrets). Not yet seen in a browser with real data.
- Lane A intake (2026-10-26): duplicates, photos, e-mail inbox (0100–0106, live after `deploy/inbound-email.md`). Bank import 0107–0114: GPC/CAMT.053/MT940 parsers, money tables 0020, `bank.import.statement`, statements dropped in the Inbox upload, Settings bank card. Matching briefs 0115+ next.
- Lane C done (0301–0367): ledgers, VAT returns, podklady, tax reserve. Needs XSDs + accountant review.

- Core loop done (0045–0053, #97–#112): upload → worker reads with Haiku 5.5 → checks → Inbox → document page → fix a value, checks re-run, `ready` when nothing blocks. English UI by default (0050). Not yet run end to end against a real Supabase project.
- Přehled screen done (0070–0074, #98–#106): totals, limit meters, deadlines (holidays + generators seeded in rules), loader, English UI; Czech copy dormant in `packages/i18n/later/`. Not yet seen with real data.
- Phase 0 run on `phase/0`: PRs #6–#52 merged; P0-PLAT-04, P0-UI-03, P0-DB-03, P0-CI-02, P0-EVAL-02 done. See [gate list](../tasks/phase-0-gate.md).

## Next

- Prototype v3 merged (0041a–c, 0042a). Owner: set SHOEBOX_PROTO_ORG_ICO/_DIC and ANTHROPIC_API_KEY on Render, send the Anthropic ZDR form.
- Design (07 rules 11–14) and tokens merged (#90, #91). Storage merged (#71). Auth = passkey + e-mail link only: 0044a (#93), 0044b offer (#94), 0044c passkey sign-in in review. `[verify]` Supabase passkeys GA before Phase 1 launch.
- Test env (0054): worker `start` script + `deploy/render-test.yaml`; owner follows the setup guide (Supabase + Render Frankfurt). First real-Supabase run; risks: storage policies, pooler login for `app_worker`.
- e2e in the cloud container: Chromium projects only, `PLAYWRIGHT_BROWSERS_PATH` shim (see 0044b brief).

## Blocked (owner)

- Founder decisions in 22 §A (each has a default) and legal items L-01 to L-05 in [open questions](../v3/22-open-questions.md). Phase 0 can start without them.

