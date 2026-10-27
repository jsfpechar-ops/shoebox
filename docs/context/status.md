# Status

Updated: 2026-10-27.

## Now

- 0623: mobile "+" opens the add menu (Upload · Snap · Add by hand), shared upload-send hook; 07 §5 TODO done.
- 0620–0622: lines from the VAT recap at read time, `doc.categorize` after every read, backfill 0065, catch-up job every 15 min. Before this no upload reached the ledgers.
- 0610–0614 (real-data test): rounding ≤1 Kč = info note; IČO fix from ARES; one-tap review + confirm; ZIP never empty, Status column, README; paid without chores.
- 0600, 0604–0606: Overview waiting / auto-read % / bills to pay; trust marks; one-tap total; PDF highlight.
- Accountant review (0601–0603): podklady whole Kč + FX, §75 share, §92a in DPHDP3/KH; [verify] list in known-issues K-C07/K-C08.
- 0520–0522 failure analytics: `pipeline_events` log, `analytics` views + CSV export, AI cost per call.
- 0514–0516: free pre-check before AI; bad answers fail at once. Epic CLS not built.
- Lane B (0075–0077, 0201–0211, #3, #14, #16): ISDOC read without AI, QR/PDF text before AI, ID checks, math gate, supplier memory, registry warnings, ISDOC export, import core.
- Page sorting (0500–0513, #11): Haiku maps pages, rules join/split, unsure = Yes/No question; not yet run on real stacks.
- Lane D screens done (0400–0411, #12–#19): register, trash, add by hand, review deck, accountant ZIP, settings, PDF click-to-fill, audit, nightly backup.
- Lane A intake (2026-10-26): duplicates, photos, e-mail inbox (0100–0106, live after `deploy/inbound-email.md`). Bank import 0107–0114: GPC/CAMT.053/MT940 parsers, money tables 0020, `bank.import.statement`, statements dropped in the Inbox upload, Settings bank card. Matching briefs 0115+ next.
- Lane C done (0301–0367): ledgers, VAT returns, podklady, tax reserve; XSDs vendored (#37).

- Core loop (0045–0053) and Přehled screen (0070–0074) done; English UI (0050), Czech copy dormant in `packages/i18n/later/`.
- Phase 0 on `phase/0`: P0-PLAT-04, P0-UI-03, P0-DB-03, P0-CI-02, P0-EVAL-02 done. See [gate list](../tasks/phase-0-gate.md).

## Next

- Design (07 rules 11–14) and tokens merged (#90, #91). Storage merged (#71). Auth = passkey + e-mail link only: 0044a (#93), 0044b offer (#94), 0044c passkey sign-in in review. `[verify]` Supabase passkeys GA before Phase 1 launch.
- Test env live on Cloud Run europe-west1 (Render dropped, see decisions 2026-10-26).
- e2e in the cloud container: Chromium projects only, `PLAYWRIGHT_BROWSERS_PATH` shim (see 0044b brief).

## Blocked (owner)

- Founder decisions in 22 §A (each has a default) and legal items L-01 to L-05 in [open questions](../v3/22-open-questions.md). Phase 0 can start without them.

