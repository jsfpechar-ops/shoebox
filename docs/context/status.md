# Status

Updated: 2026-10-25.

## Now

- Lane B reading and checks (0201–0211, #14, #16): QR + PDF text before AI, IČO/DIČ/IBAN checks, blocking math gate, supplier memory with IČO repair, CRPDPH/VIES warnings, ISDOC export (XSD-valid), spreadsheet import core. Next: Pohoda XML after lane C categories; import preview job.
- ISDOC read without AI (0075–0077, shoebox #3): ISDOC in a PDF, `.isdoc` or `.isdocx` skips Haiku; same checks; page says "No AI was used".
- Core loop done (0045–0053, #97–#112): upload → worker reads with Haiku 5.5 → checks → Inbox → document page → fix a value, checks re-run, `ready` when nothing blocks. English UI by default (0050). Not yet run end to end against a real Supabase project.
- Přehled screen done (0070–0074, #98–#106): totals, limit meters, deadlines (holidays + generators seeded in rules), loader, English UI; Czech copy dormant in `packages/i18n/later/`. Not yet seen with real data (e2e covers the empty state only).
- Phase 0 run on `phase/0`: PRs #6–#52 merged; P0-PLAT-04, P0-UI-03, P0-DB-03, P0-CI-02, P0-EVAL-02 done. See [gate list](../tasks/phase-0-gate.md).

## Next

- Prototype v3 merged (0041a–c, 0042a). Owner: set SHOEBOX_PROTO_ORG_ICO/_DIC and ANTHROPIC_API_KEY on Render, send the Anthropic ZDR form.
- Design (07 rules 11–14) and tokens merged (#90, #91). Storage merged (#71). Auth = passkey + e-mail link only: 0044a (#93), 0044b offer (#94), 0044c passkey sign-in in review. `[verify]` Supabase passkeys GA before Phase 1 launch.
- Test env (0054): worker `start` script + `deploy/render-test.yaml`; owner follows the setup guide (Supabase + Render Frankfurt). First real-Supabase run; risks: storage policies, pooler login for `app_worker`.
- e2e in the cloud container: Chromium projects only, `PLAYWRIGHT_BROWSERS_PATH` shim (see 0044b brief).

## Blocked (owner)

- Founder decisions in 22 §A (each has a default) and legal items L-01 to L-05 in [open questions](../v3/22-open-questions.md). Phase 0 can start without them.

## Owner reminders

- The September identified-person VAT return for your own company is due 25.10.2026.
