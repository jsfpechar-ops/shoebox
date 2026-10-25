# M11: UX and screens

> Phase 1 (all four screens, onboarding, document detail, review flow, mobile capture, the "Vše" register with its search box). Phase 2 adds bank/package content to existing screens, bulk "Označit jako zaplacené" and the spreadsheet import wizard; Phase 3 adds filing cards inside Přehled; Phase 4 the "Kolik si odložit" tile. Later: ⌘K command palette and global key sequences, tips card. **No new top-level screen without an ADR** (06 §6).
> Data and numbers shown on Přehled: `M09`. Document pipeline states: `03 §3`, enums `04`/`05`. Stack: Next.js 15 App Router (RSC + Server Actions), Tailwind 4, shadcn/ui (ADR-010).
> **Visual decisions (colour, type, spacing, icons, motion, focus, targets, click budget) are owned by `docs/v3/07-design-system.md`.** This file decides which screens, states and strings exist; wherever it names a tone it means the 07 semantic token (`--warning`, `--destructive`, `--success`, `--info`).

---

## 1. Purpose and scope

Define every screen, state and string the user sees so that an implementer can build the UI without design guesswork, while keeping the product **calm, minimal, Czech-first and jargon-free**.

**In scope:** information architecture; Inbox, Přehled, Pro účetní, Nastavení; onboarding wizard; document detail (PDF viewer with source highlights, click-to-fill, summary, "Proč?"); review-question flow with keyboard shortcuts; mobile/PWA capture; empty and error states; accountant view; expert view; component inventory; accessibility (WCAG 2.2 AA per 07 §8); performance budgets; Czech UX-copy glossary; i18n conventions.
**Out of scope:** marketing site, billing UI, native apps, offline capture queue (Later), invoicing screens (M08), the in-app assistant chat (Later).

Structure map to the module template: user stories §1.1, inputs/outputs §1.2, behavior and UX §2–§12, data and interfaces §13, edge cases §14, acceptance §15, maintenance §16, open questions §17.

### 1.1 User stories

| # | Persona | Story |
|---|---|---|
| US-1 | P2 Tomáš | I snap a thermal receipt in the van; one tap and it is gone from my hands. |
| US-2 | P1–P4 | I forward invoices to one e-mail address and never open the app unless something is unclear. |
| US-3 | P4 Josef | When the app is unsure (Decathlon backpack), it asks me one question with chips; I answer with one key. |
| US-4 | P2, P3 | My old Excel list of invoices is replaced by the "Vše" table: sort, filter, see what is paid and where the file is, download it as Excel in one click. |
| US-5 | P2 | I lost a parking receipt; I add it by hand in three clicks and the app tells me plainly what that means for tax. |
| US-6 | P1 | Onboarding takes under a minute: IČO, four answers, done. |
| US-7 | P4 | I see why a value is what it is ("Proč?") and fix a wrong one by clicking it on the PDF. |
| US-8 | Accountant | I open a client, see the package and questions, comment, answer and export without being able to break anything. |
| US-9 | All | The app works with keyboard only, a screen reader, at 320 px and in Czech or English. |

### 1.2 Inputs / outputs

**Reads:** `documents`, `document_lines`, `document_fields`, `document_links`, `validation_results`, `review_questions`, `source_files` (signed URLs, thumbnails), `partners`, `categories`, `vendor_profiles`, `taxpayer_profiles`, `organizations`, `memberships`, `transactions`/`payment_links` (paid state), `notifications`, `audit_log` (history), M09 `DashboardData`, M10 package state.
**Writes (via server actions only):** `document_fields` (user values), `documents` (manual entry, classification flags, delete/restore, confirm), `document_lines` (classification), `review_questions.answer*`, `transactions` + `payment_links` (manual "zaplaceno"), `taxpayer_profiles` (profile change), `organizations.settings`, `memberships.prefs`, `comments`, `audit_log`.

## 2. Design principles

1. **Calm.** Neutral by default (Minimalism/Swiss + Accessible & Ethical, 07 §1). Colour means "act": `--warning` = check this, `--destructive` = deadline missed or blocked; status is always icon + word + colour (07 §6). No red for things the user cannot fix. No celebratory animations, no streaks, no badges that count up for engagement.
2. **One primary action per screen.** Inbox: "Nahrát doklady". Review: the suggested answer. Přehled: the top alert's action. Everything else is secondary (ghost buttons, links).
3. **Zero typing by default** (01 §3.2). Inputs are pre-filled; the user confirms. Free typing is the fallback, never the first step.
4. **Never silently wrong** (01 §3.3). Every value shows where it came from on demand; inferred values are marked as inferred (lesson from Competitor H inventing due dates, internal research (not published)).
5. **Czech-first copy, no jargon.** Plain words from the glossary (§11). Legal terms appear only in "Proč?" explanations and expert view.
6. **Progressive disclosure: expert view.** One per-user toggle (`memberships.prefs.ui.expert_view`) reveals legal field names (DUZP), sources and confidence numbers, VAT treatment codes, DPHDP3 rows/KH sections and raw line editing; from Phase 2 also the cash/document basis toggle and payables ageing (rolling-12-month info: Later). Default off for owners, **on for accountants**.
7. **Simpler than the competition.** Competitor E's forms expose ~15 header + 10 line fields (internal research (not published)); our document detail shows at most **7 fields** by default (Dodavatel, Číslo dokladu, Vystaveno, Datum plnění, Splatnost, Celkem, DPH) plus one classification sentence.
8. **Explain every number.** Every amount on Přehled and every check result is tappable → "Jak jsme to spočítali" / "Proč?".

## 3. Information architecture

```
/ (redirect: owner/member → /prehled if any document else /inbox; accountant → /ucetni)
├── /inbox                     Inbox                [tabs: Ke kontrole · Vše · Podklady · Ostatní · Koš]
│   ├── /inbox/kontrola        Review flow (one question at a time)
│   └── /doklad/[id]           Document detail (sheet over Inbox on desktop, full page on mobile)
├── /prehled                   Přehled (M09 widgets, filing cards, deadlines list /prehled/terminy)
├── /ucetni                    Pro účetní (package, exports, accountant access, comments)
├── /nastaveni                 Nastavení (≤ 15 settings, §5.4)  /nastaveni/profil · /nastaveni/soukromi
├── /foto                      Mobile capture (PWA start_url for the "Vyfotit" shortcut)
├── /vitejte                   Onboarding wizard (4 steps)
└── /admin                     Internal back-office (staff only, M12 §4.9; not linked in UI)
```
Navigation: desktop = left rail (64 px, icons + labels on hover; expanded 200 px ≥ 1280 px); mobile = bottom tab bar with 4 tabs and a centre camera button. Header: org name + switcher (only if the user has > 1 membership), search (⌘K / `/`), bell (in-app notifications, M09 §4.14), avatar menu.

**Global search / command palette (⌘K) — Later.** Phase 1 has only the search box of the "Vše" register, backed by the same server search (`searchDocuments`). Design for later, borrowed from Competitor E and Competitor C (internal research (not published), internal research (not published)): searches documents by supplier, number, VS, amount ("1198", "1 198,00"), IČO/DIČ; commands "Nahrát doklady", "Přejít na…", "Zapnout pohled pro pokročilé". Server-side Postgres search (`ILIKE` + trigram index `documents_search_trgm`, 05 §4), max 20 results.

## 4. Document status → user-facing status

| `documents.status` (+ condition) | Badge (`StatusBadge`, Lucide icon + word) | Token | Where |
|---|---|---|---|
| `received`, `splitting`, `classifying`, `extracting`, `validating`, `categorizing` | Zpracovává se | `--info`, spinner | Vše, Ke kontrole (top) |
| same, > 120 s | Trvá to déle než obvykle | neutral | Vše |
| `needs_review` | Ke kontrole | `--warning` | Ke kontrole |
| `ready` | Hotovo | `--success` | Vše |
| `finalized` | Uzavřeno | neutral + lock icon | Vše |
| `supporting` (class non-bookable: `settlement_statement`, `order_confirmation`, `government_filing`, `contract`, `delivery_note`, `other_supporting`, `bank_statement`) | Podklad | neutral | Podklady |
| `supporting` / class `non_document` | Není doklad | neutral | Ostatní |
| `duplicate` | Duplicita | neutral + link "původní" | Ostatní |
| `failed` | Nepodařilo se přečíst | `--destructive` | Ke kontrole |
| any + `deleted_at` | V koši (smaže se {date}) | neutral | Koš |
| secondary badge: `tax_doc_status = not_tax_document` or `substitute_reason` set | Nedaňový | `--info` | next to the main badge |
| secondary badge (Phase 2): transaction without document (M07 radar row) | Chybí doklad | `--warning` | Ke kontrole |

Words follow 07 §6 (`Zpracovává se · Ke kontrole · Hotovo · Chybí doklad · Nedaňový · Duplicita`); this table adds Uzavřeno, Podklad, Není doklad, Nepodařilo se přečíst and V koši.

Bookability is never stated as "rejected" to the user: supporting documents are **kept and linked**, which the Podklady tab explains ("Výpisy, objednávky a podaná přiznání si schováme a propojíme s doklady. Do výdajů je nepočítáme.").

## 5. Screens

### 5.1 Inbox

Purpose: everything that arrived, the short list of what needs the user, and (tab **Vše**) a complete register that **replaces the Excel list** small OSVČ keep today ("which invoices do I have, are they paid, where is the file").

Opening tab: **Ke kontrole** when it is non-empty, otherwise **Vše** (07 §2.1). Primary action: the **"+"** button with the menu **Nahrát · Vyfotit · Přidat ručně** (07 §2.6); the whole window is a drop target and Ctrl/Cmd+V pastes a file or image.

Tab **Ke kontrole** (desktop):
```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Inbox   [ Ke kontrole 3 ] [ Vše 41 ] [ Podklady 6 ] [ Ostatní 3 ] [ Koš ]   [ + ▾ ]   │
│                                                                  [⌕ Hledat  ⌘K]      │
│ ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Přetáhněte sem doklady nebo je vložte (Ctrl+V) · E-mail pro doklady:            │ │
│ │ josef-k3f9x2qa@in.shoebox.cz  [Kopírovat]                                        │ │
│ └──────────────────────────────────────────────────────────────────────────────────┘ │
│ 3 věci ke kontrole               [ Potvrdit všechny jisté (1) ]  [ Projít postupně ] │
│ │ ▤ │ Decathlon · batoh · Soukromé, nebo firemní?   │    249,00 Kč │ 12. 9. │ Ke kontrole │
│ │ ▤ │ Apple · MacBook · Ověřte kupujícího           │ 26 990,00 Kč │ 14. 3. │ Ke kontrole │
│ │ ▤ │ Booking.com · provize za srpen                │ 11 549,94 Kč │  3. 9. │ Ke kontrole │
│ Právě přišlo                                                                         │
│ │ ◌ │ faktura-0923.pdf                              │            — │  dnes  │ Zpracovává se │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
Tab **Vše** (desktop) — the register:
```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Vše   Období [ 2026 ▾ ]  Stav [ vše ▾ ]  Zaplaceno [ vše ▾ ]  Kategorie [ vše ▾ ]  ⌕ [ alza   ]│
│                                                         [ Stáhnout jako Excel ]  [ + ▾ ]     │
│ ☐ │ Datum ▾ │ Partner        │ Číslo       │      Částka │     DPH │ Zaplaceno │ Kategorie   │ ⎙│
│ ☐ │ 30. 9.  │ Úklid Praha    │ 2026-0412   │  8 150,00 Kč│       — │ ✓ 2. 10.  │ Úklid       │ ⎙│
│ ☐ │ 30. 9.  │ Správa bytů K. │ FV-0926     │  9 749,44 Kč│ 1 692,…│ ✗ do 14.10│ Správa bytu │ ⎙│
│ ☐ │ 10. 9.  │ IKEA           │ 4471-22     │  1 198,00 Kč│  207,93 │ ✓ kartou  │ Vybavení    │ ⎙│
│ ☐ │  9. 9.  │ Pokladna       │ ručně       │    350,00 Kč│       — │ ✓ hotově  │ Parkovné    │ ✎│  ← manual, no file
│ ...                                                                                            │
│ 2 vybrané: [Označit jako zaplacené] [Změnit kategorii] [Soukromé] [Stáhnout ZIP] [Smazat]     │
│ Celkem za výběr: 9 349,44 Kč                                                                   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```
(Illustrative rows.) Mobile (< 768 px): rows become cards (07 §6); filters collapse into one "Filtr" sheet; bulk select by long-press.
```
┌──────────────────────────┐
│ Inbox            ⌕   🔔  │
│ [Ke kontrole 3] [Vše] [⋯]│
│ ┌──────────────────────┐ │
│ │ Decathlon     249 Kč │ │
│ │ Soukromé, nebo firem?│ │
│ │ [Firemní] [Soukromé] │ │   ← inline answer chips, 1 tap
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ IKEA        1 198 Kč │ │
│ │ Vybavení · Hotovo    │ │
│ └──────────────────────┘ │
├──────────────────────────┤
│ Inbox  Přehled  (+)  Účetní  Nastavení │   ← (+) = Vyfotit / Nahrát / Přidat ručně
└──────────────────────────┘
```

**Columns of "Vše"** (TanStack Table on shadcn `Table`, 07 §6; real `<table>` semantics; all sortable, default `Datum` desc):

| Column | Source | Filter |
|---|---|---|
| Datum | `doc_date` (M09 §4.1) | period (month / quarter / year / custom) |
| Partner | `partners.name` ?? `partner_snapshot.name` | text search (also IČO/DIČ) |
| Číslo | `document_number` ("ručně" for manual entries without number) | text search (also VS) |
| Částka | `total_gross` in document currency; foreign shows "≈ CZK" in a tooltip | min/max |
| DPH | `total_vat` (or "přiznáváte vy" for self-assessed treatments; "—" for none) | — |
| Zaplaceno | ✓ + `paid_at` / "kartou" / "hotově" (`is_paid_per_document`) · ✗ + due date · "—" for supporting docs | zaplaceno / nezaplaceno / po splatnosti |
| Kategorie | first line's category label (+ "a další" when lines differ) | category multi-select |
| Soubor | Lucide `file` icon if `source_file_id` is not null, `pencil` for manual entries without file | má soubor / bez souboru |
| Stav (expert) | §4 badge | status multi-select |
| Směr (expert) | `direction` (Výdaj / Příjem) | in / out |

- Row click opens the document detail; checkbox column for multi-select (Shift-click range, `X` key). **Bulk actions** (owner/member): Označit jako zaplacené (**Phase 2**, with M07; date picker, default today; creates one `transactions` row with `source = 'manual'` on the org's auto-created cash account `money_accounts.type = 'cash'` plus a `payment_links` row with `match_method = 'manual'`, so `paid_at` is derived as usual; audited), Změnit kategorii, Firemní/Soukromé, Stáhnout ZIP (originals), Smazat (→ Koš, with 10 s "Zpět" toast; finalized docs are hidden, not deleted). A footer shows the count and Σ CZK of the selection.
- **"Stáhnout jako Excel"** (1 click, 07 click budget): XLSX of exactly the current filtered and sorted view, one row per document, the visible columns plus `IČO`, `DIČ`, `Variabilní symbol`, `Splatnost`, `Datum plnění`, `Částka bez DPH`, `Měna`, `Kurz`, `Soubor` (relative file name as in the ZIP export, M10). Generated server-side by `packages/exports` (`exportRegisterXlsx(orgId, filter)`), streamed; ≤ 10 000 rows, else "Zužte filtr".
- Pagination: virtualized table, 200 rows per fetch, server-side sort/filter (cursor on sort key + id). Filters and sort are kept in the URL (shareable, back-button safe).
- Upload rules (owned by M01 §4.1): multi-select, folders not supported; allow-list and limits from M01 config (≤ 25 MiB per file, ≤ 100 files and ≤ 500 MiB per batch); files failing the client pre-check get an error row immediately and are not uploaded. Each file shows a progress row immediately (optimistic), then becomes the document row.
- Live updates: Supabase Realtime subscription on `documents` (RLS-filtered) for the org; fallback polling every 5 s while any row is processing; stop after 10 min idle.
- Row actions (hover / long-press): Otevřít, Smazat (→ Koš with "Zpět" toast; finalized docs: "Tento doklad musíme ze zákona uchovat 10 let. Skryjeme ho, ale nesmažeme." per 02 Guardrails), Stáhnout originál.
- **"Potvrdit všechny jisté"** (07 §2.2) confirms every `needs_review` document whose only open items are non-blocking and whose field confidences are all ≥ the review threshold; shows the count before acting and a 10 s "Zpět" toast after.
- **Spreadsheet import (Phase 2, logic in M01):** "+" → "Importovat z Excelu" opens a 3-step wizard: (1) upload XLSX/CSV, (2) map columns — each target field (Datum, Partner, IČO, Číslo, Částka, DPH, Zaplaceno, Kategorie, Poznámka) gets a select prefilled by header matching, with a **10-row preview** that re-renders on every change and flags unparseable cells, (3) summary ("Vytvoříme 48 záznamů, 3 řádky přeskočíme") → Importovat. Created documents have `entry_mode = 'imported'` and no file.

### 5.1a Manual entry ("Přidat ručně")

For lost or damaged receipts, cash expenses and documents that were never issued. Opens the **same form as document review** (document detail panel, §5.6) with empty fields and an optional photo slot.

```
┌───────────────────────────────────────────────┐
│ Přidat ručně                                  │
│ [ + Přidat fotku (nepovinné) ]                │
│ Dodavatel   [ IČO nebo název…   ] (ARES)      │
│ Datum       [ 9. 9. 2026 ]                    │
│ Částka      [ 350,00 ] Kč                     │
│ Zaplaceno   (●) hotově ( ) kartou ( ) převodem│
│ Za co       [ Parkovné ▾ ]   Firemní ▾        │
│ ▸ Podrobnosti (číslo dokladu, DPH, splatnost) │
│ ☐ Doklad chybí / je poškozený                 │
│    Důvod [ ztracený ▾ ]                       │
│    Výdaj se může započítat do daně z příjmů,  │
│    pokud doložíte platbu. DPH si bez daňového │
│    dokladu odečíst nelze. Rozhodne účetní.    │
│                              [ Uložit ]       │
└───────────────────────────────────────────────┘
```
- Creates `documents` with `entry_mode = 'manual'` and the class picked in "Typ" (M01 §4.12: `received_receipt` "Účtenka / hotovostní výdaj" by default, `received_invoice`, `issued_invoice`), `direction` from the class, `source_file_id` = the photo's `source_files` row or null (05 check: only `captured` requires a file). One `document_lines` row from Částka + Za co. Without a photo the M03/M04 pipeline runs from `validating`; with a photo M02 extracts with `fillGaps` and only fills empty fields (M01 §4.12). Typed fields have `field_source = 'user'`.
- "Doklad chybí / je poškozený" sets `documents.substitute_reason ∈ {lost, damaged, never_issued, other}` (select labels: ztracený, poškozený, nebyl vystaven, jiný důvod) and is offered only for `entry_mode = 'manual'`. The inline copy (key `manual.substitute.note`) is always visible when the toggle is on. Downstream, VAT deduction is never claimed for such a document (M04/M05) and M10 lists it for the accountant.
- Partner by IČO uses the ARES lookup; a plain name is allowed (no partner row is created without IČO/VAT ID).
- Click budget: "+" → "Přidat ručně" → "Uložit" = 3 clicks excluding typing (07 §2).
- Edit in place applies after saving (07 §2.4).

### 5.2 Přehled

Content and computations from M09 (§4.13 ordering). Layout:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Přehled                                                       Září 2026   [Expert ○] │
│ ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ⚠ Přiznání DPH za srpen: termín 25. 9. (za 7 dní)            [ Zobrazit ]        │ │ ← alerts strip (max 3)
│ └──────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────┐ ┌───────────────────────────────────────────────────────┐   │
│ │ 3 věci ke kontrole    │ │ Příjmy a výdaje            Podle dokladů · bez banky  │   │
│ │ nejstarší 4 dny      │ │           Tento měsíc        Od začátku roku          │   │
│ │ [ Projít postupně ]  │ │ Příjmy          0 Kč                    0 Kč          │   │
│ └──────────────────────┘ │ Výdaje     21 248 Kč               98 412 Kč          │   │
│                          │ 1 doklad za 249 Kč ještě čeká na kontrolu             │   │
│                          └───────────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────┐ ┌─────────────────────────────────────────┐ │
│ │ Jste identifikovaná osoba k DPH      │ │ Termíny                                 │ │
│ │ Srpen: k přiznání 2 877 Kč · 25. 9.  │ │ 15. 9.  Poplatek z pobytu (Praha 3) – srpen │
│ │ Září: zatím 2 4xx Kč · 26. 10.       │ │ 25. 9.  Přiznání k DPH – srpen          │ │
│ │ [ Proč? ]                            │ │ 15. 10. Poplatek z pobytu – září        │ │
│ └──────────────────────────────────────┘ │ [ Všechny termíny (5) ]                 │ │
│ ┌──────────────────────────────────────┐ └─────────────────────────────────────────┘ │
│ │ Limit pro plátce DPH                 │ ┌─────────────────────────────────────────┐ │
│ │ ▕██░░░░░░░░░░░░░░░░▏ 0 z 2 000 000 Kč│ │ Pro účetní: export za září              │ │
│ └──────────────────────────────────────┘ │ [ Stáhnout ZIP ]                        │ │
│                                          └─────────────────────────────────────────┘ │
│ Kolik si odložit (Phase 4): zhruba 12 300 Kč (kdyby rok skončil dnes)  [Jak jsme...]  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
(Illustrative values; real values come from M09.) Mobile: single column in the same order. Meters render as progress/bullet bars with zones (07 §6, M09 §4.4) and `role="meter"`; the number and the threshold are always printed as text beside the bar; level `warn`/`alert` adds an icon and the `--warning`/`--destructive` tone, which is supplementary only. Filing cards (Phase 3) render inside the Termíny column as cards. Tips card (**Later**; one at a time, dismissable, Competitor C "Objevte, co robot umí" idea, internal research (not published)): "Přeposílejte faktury rovnou z e-mailu", "Pozvěte účetní", "Nahrajte výpis z banky" (Phase 2).

### 5.3 Pro účetní

Owner view (accountant view in §5.7):
```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Pro účetní                                          Období: [ Září 2026 ▾ ]           │
│ ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Balíček za září · připraven z 92 %                                               │ │
│ │ ✓ 14 dokladů   ✓ 2 výpisy   ! 2 platby bez dokladu   ! 1 otevřená otázka         │ │
│ │ Poznámka pro účetní: [ Byt na Žižkově – srpen bez hostů 3.–9.        ]           │ │
│ │ [ Poslat účetní ]   [ Stáhnout ZIP ]   Formát: Pohoda XML ▾                       │ │
│ └──────────────────────────────────────────────────────────────────────────────────┘ │
│ Účetní:  Jana Nováková · jana@ucetni.cz · přístup: číst, komentovat, exportovat [⋯] │
│          nebo [ Pozvat účetní ]                                                       │
│ Komentáře a dotazy (2)                                                                │
│   Jana: „Booking za srpen – máte k tomu výpis?"  · Doklad Booking.com  [Odpovědět]   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
Phase 1 shows only the export block ("Stáhnout ZIP" = documents named consistently + XLSX register, 02 Phase 1 §9) and the invite button. Completeness, notes, formats and comments arrive with M10 (Phase 2).

### 5.4 Nastavení (simplicity budget: 15 user-facing settings)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Nastavení                                                            │
│ Firma        Josef K. · IČO 12345678 · z ARES 1. 10. [Obnovit]       │  (1)
│ Daňový profil Identifikovaná osoba · daňová evidence  [Změnit od…]   │  (2)
│ Účetní       Mám účetní ● [Pozvat]                                   │  (3)
│ E-mail pro doklady  josef-k3f9x2qa@in.… [Kopírovat] [Vyměnit]        │  (4)
│ Hotové doklady uzavírat automaticky  ●                               │  (5)
│ Upozornění e-mailem  Denní souhrn ● · Naléhavé ● · Víkendy ○         │  (6)
│ Tichý režim  20:00 – 7:30                                            │  (7)
│ Pohled pro pokročilé  ○                                              │  (8)
│ Jazyk  Čeština ▾                                                     │  (9)
│ Poplatek z pobytu  Praha 3 ▾        (jen pokud se vás týká)          │ (10)
│ Zálohy na pojištění  sociální [ 5 005 ] zdravotní [ 3 306 ] Kč       │ (11)
│ Přiznání k dani z příjmů podává poradce  ○                           │ (12)
│ Bankovní účty  (od fáze 2)                                           │ (13)
│ Uživatelé a přístupy                                                 │ (14)
│ Soukromí a data  Export všeho · Zrušit účet (Přístup podpory: Later) │ (15)
└──────────────────────────────────────────────────────────────────────┘
```
Storage: (1)(2) `taxpayer_profiles`; (3) `has_accountant` + memberships; (4) `organizations.inbound_email_slug/secret`; (5) `organizations.settings.auto_finalize`; (6)(7)(8) `memberships.prefs` (M09 §5.3); (9) `memberships.prefs.ui.locale`; (10)(11)(12) `organizations.settings` (M09 §5.3); (13) `money_accounts`; (14) `memberships`; (15) M12 §4.6. The expert-only items inside (2) (`foreign_service_dppd_policy`; for paušální daň the declared activity class stored in `pausal_rate`, 04 §1) do not count as separate settings. Account security (password, MFA, sessions) lives in the avatar menu "Můj účet" (per user, not org).

**Profile change flow (2)** — profiles are effective-dated, so every change asks "Od kdy?": date picker (default today; earliest = 1 Jan of the previous year) → summary "Od 3. 8. 2026 budete vedeni jako identifikovaná osoba. Přepočítáme 4 doklady." → confirm. Server action inserts a new `taxpayer_profiles` segment (closing the previous one at `date − 1`), emits `profile.changed`, triggers M04 rebuild and M09 regeneration. Retroactive changes that touch a period with a generated filing show the amendment warning (M09 §4.9).

**Inbound address rotation (4):** "Vyměnit" generates a new `inbound_email_secret`; the old address keeps working for 7 days (`config.ingest.email_rotation_grace_days`), then mail to it is rejected (M01 §4.10).

### 5.5 Onboarding wizard (`/vitejte`, target < 60 s, 02 Phase 1 §1)

```
Krok 1/4                                   Krok 2/4
┌──────────────────────────────┐           ┌──────────────────────────────────────┐
│ Vaše IČO                     │           │ Jste plátce DPH?                     │
│ [ 12345678        ] [Najít]  │           │ (●) Ne                               │
│ ✓ Josef K., Praha 3          │           │ ( ) Jsem identifikovaná osoba        │
│   Koněvova 1, 130 00         │           │ ( ) Ano, měsíčně  ( ) Ano, čtvrtletně│
│   [To nejsem já]             │           │ Zjistili jsme z registru: IO ✓       │
│        [ Pokračovat ]        │           │                     [ Pokračovat ]   │
└──────────────────────────────┘           └──────────────────────────────────────┘
Krok 3/4                                   Krok 4/4
┌──────────────────────────────────────┐   ┌──────────────────────────────────────┐
│ Jak uplatňujete výdaje?              │   │ Máte účetní?                         │
│ ( ) Skutečné výdaje (daňová evidence)│   │ ( ) Ne   (●) Ano → e-mail (nepovinný)│
│ ( ) Paušální výdaje  [60 % ▾]        │   │ [ jana@ucetni.cz        ]            │
│ ( ) Paušální daň     [1. pásmo ▾]    │   │                                      │
│     Převažující činnost [80 % ▾]     │   │ Hotovo. Doklady posílejte na:        │
│ (●) Nevím → zeptáme se účetní        │   │ josef-k3f9x2qa@in.shoebox.cz [Kop.]  │
│                     [ Pokračovat ]   │   │ [ Nahrát první doklad ]  [ Přehled ] │
└──────────────────────────────────────┘   └──────────────────────────────────────┘
```
Rules:
- Step 1: IČO validated (8 digits, mod-11 checksum) client-side; ARES lookup (M03 registries client) fills legal name, address, DIČ, `czNace` → `main_activity_nace`, `fu_code` from address when derivable. ARES down → manual fields + "Ověříme později" (never block). Org name defaults to the ARES name.
- Step 2 prefill: if DIČ known, CRPDPH `getStatusNespolehlivySubjektRozsirenyV2.typSubjektu` (`PLATCE_DPH` → `platce`, `IDENTIFIKOVANA_OSOBA` → `identifikovana_osoba`, `NENALEZEN` → `neplatce`; `research/registries-and-formats.md §2`). Payer → VAT period radio required; IO → `vat_period = monthly`.
- Step 3: "Nevím" sets `danova_evidence` and creates a `review_questions` row `kind='confirm_profile'` for the accountant/owner later. Paušální daň shows band + dominant activity (M09 §4.4.2).
- Step 4: accountant e-mail sends an invite (role `accountant`) only after the user clicks "Pozvat" on the final screen (no surprise e-mails).
- Insurer and other profile fields are asked later, in context (podklady, reminders), never in onboarding.
- Creates: `organizations` (slug from name + 8 random chars), `memberships(owner)`, first `taxpayer_profiles` segment (`valid_from` = 1 Jan of the current year, or the business start date from ARES if later), seeded defaults. Telemetry: time-to-complete (no field values).

### 5.6 Document detail (`/doklad/[id]`)

```
┌─────────────────────────────────────────────┬────────────────────────────────────────┐
│ ◀ Inbox     faktura_booking_08.pdf   1/2 ▸ ⤓│ Booking.com B.V. · provize za srpen    │
│ ┌─────────────────────────────────────────┐ │ „Booking vám vyúčtoval provizi a       │
│ │  BOOKING.COM                            │ │  poplatek za platby. DPH z toho        │
│ │  Invoice no. ┏━━━━━━━━━━━┓              │ │  přiznáváte vy."            [Proč?]    │
│ │              ┃1734-0923  ┃◄─────────────┼─┤ Číslo dokladu   1734-0923     ◉ PDF    │
│ │  Date ┏━━━━━━━━━━┓                      │ │ Vystaveno       3. 9. 2026    ◉ PDF    │
│ │       ┃03-09-2026┃                      │ │ Datum plnění    31. 8. 2026   ◐ odhad  │
│ │  Period 01-08 – 31-08                   │ │ Splatnost       —                      │
│ │  Commission ............  10 124,01     │ │ Celkem          11 549,94 Kč  ◉ PDF    │
│ │  Payments fee ..........   1 425,93     │ │ DPH             přiznáváte vy [Proč?]  │
│ │  Total CZK ........ ┏━━━━━━━━━┓         │ │ ─────────────────────────────────────  │
│ │                     ┃11 549,94┃         │ │ Provize platforem · uznatelné · DPH    │
│ │                     ┗━━━━━━━━━┛         │ │ přiznáváte vy (služba z EU)   [Změnit] │
│ └─────────────────────────────────────────┘ │ Kontroly                               │
│  [−] [+] [⟲]  Kliknutím do dokladu vyplníte │ ✓ Součty sedí  ✓ Dodavatel ve VIES     │
│              označené pole                  │ ! Chybí vaše DIČ na dokladu  [Proč?]   │
│                                             │ Souvisí: Vyúčtování správce – srpen    │
│                                             │ [ Potvrdit ]          Historie ▾       │
└─────────────────────────────────────────────┴────────────────────────────────────────┘
```
(Illustrative content: the line split shown is not taken from the golden labels.)

**Layout:** desktop = 60/40 split (viewer left); tablet/mobile = fields first, "Zobrazit doklad" toggles a full-screen viewer with the same highlights.

**PDF viewer** (`PdfViewer`): `pdfjs-dist`, lazy-loaded, with `isEvalSupported: false`, `enableScripting: false` (M12 §4.5). Images (JPEG/PNG/converted HEIC) render as `<img>` on the same canvas abstraction. Pages render on demand; zoom 50–400 %; rotate. **Highlights:** for each current `document_fields` row with `page` and `bbox` (normalized 0..1), draw a rectangle over the page; hover/focus on a field row highlights its rectangle and scrolls it into view (and vice versa). Colour = source class: read (isdoc, qr, pdf_text, template) solid outline; inferred (`llm`, `llm_escalated`, `derived`, `rule`, `vendor_memory`) dashed outline; `registry`/`user` no box.

**Source badge** next to each field (default view shows a dot + short word; expert view shows source + confidence number):

| `field_source` | Badge | "Proč?" text |
|---|---|---|
| `isdoc` | ◉ ISDOC | Přečteno ze strojových dat faktury (ISDOC). |
| `qr` | ◉ QR | Přečteno z QR kódu na dokladu. |
| `pdf_text`, `template` | ◉ PDF | Přečteno z textu dokladu, strana {page}. |
| `llm`, `llm_escalated` | ◐ odhad (if confidence < review threshold: "ověřte") | Přečetla to umělá inteligence z obrázku dokladu. Zkontrolujte prosím. |
| `registry` | ◉ ARES/VIES | Doplněno z veřejného registru {registry} dne {date}. |
| `vendor_memory` | ◉ jako minule | Stejně jako u předchozích dokladů od {partner}. |
| `rule`, `derived` | ◐ dopočítáno | Dopočítáno: {formula}. |
| `user` | ✎ vy | Upravili jste ručně {date}. |

**Click-to-fill:** activate a field (click its row, or `e`) → the viewer enters "pick" mode (cursor crosshair, banner "Klikněte nebo táhněte přes hodnotu v dokladu"). Click selects the word under the cursor; drag selects a rectangle. Text comes from the page text layer (PDF) or from M02's stored page-word layer (`PageText`: words with bboxes, produced during extraction for images). The value is parsed with the field's parser (Czech money "11 549,94", dates "03-09-2026", "3. 9. 2026", IČO/DIČ normalizers); on parse failure the raw text goes into the input for editing. Saving writes a new `document_fields` row (`source='user'`, `set_by`, `page`, `bbox`, previous row `is_current=false`), re-runs M03 validation and M04 categorization for the document (server action `updateDocumentField`). Smart recalc (Competitor A idea, internal research (not published)): if 2 of (base, rate, VAT) or (qty, unit price, total) are known, the third is suggested, marked "dopočítáno". No page-word layer (rare) → manual typing only.

**One-sentence summary:** `documents.summary_cs`; if null, template `summary.fallback` "{partner} · {category} · {amount} · {date}". Never longer than 160 characters.

**"Proč?" explanations** are deterministic, never generated at view time: category → `categories.explanation_cs`; VAT treatment → i18n `vat_treatment.{value}.why` with params (supplier country, rate, row in expert view); validation → `validation.{rule_id}.why` with `validation_results.params`; tax-doc status → `tax_doc_status.{value}.why`; deadline shift → M09 `deadlines.shift_why`. Popover (desktop) / bottom sheet (mobile), max 3 sentences + optional "Více" link to the glossary entry.

**Classification sentence** ("Provize platforem · uznatelné · DPH přiznáváte vy"): tap "Změnit" → sheet with (a) category picker (searchable, grouped as 04 §3.1, top 5 suggestions first), (b) chips Firemní / Soukromé / Napůl (Napůl opens a slider 0–100 %, `business_share_pct`), (c) VAT treatment select under "Podrobnosti" (collapsed; auto-expanded only for `platce`/`identifikovana_osoba` when the document is VAT-relevant, 07 §2.8). Changes apply to all lines by default; expert view allows per-line edits. After saving, if the partner has a `vendor_profiles` row with a different default: "Chcete to tak dělat u {partner} vždy?" [Ano] [Jen teď] (Competitor A relearn dialog idea).

**Checks list:** `validation_results` with `state='open'` first (blocking → "Musí se vyřešit", warning → "Zkontrolujte"), then passed checks collapsed ("✓ 6 kontrol v pořádku"). Each has "Proč?" and, where M03 defines one, a fix action ("Označit jako vyřešené", "Otevřít původní doklad").

**Links:** `document_links` rendered as "Souvisí:" chips (e.g. settlement statement ↔ manager invoice `same_period_reconciles`; `duplicate_of` → "Duplicita dokladu …").

**Editing:** every value is edited in place — click it, type, save on blur or Enter; no edit mode, no save button (07 §2.4).

**Primary action:** "Potvrdit" (Enter) (→ `ready`/`finalized` per `auto_finalize`) is enabled only when no blocking validation is open; disabled state explains why ("Nejdřív vyřešte: Součty nesedí"). Finalized documents are read-only; "Upravit" creates a new revision with a confirmation (03 §3).

**History:** collapsed list from `audit_log` (who, what, when; no raw diffs in default view). Revisions of finalized documents (`document_revisions`, 05 §4) are listed with their reason.

### 5.7 Review questions flow (`/inbox/kontrola`)

One question at a time, keyboard-first, like a flashcard deck.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Otázka 1 ze 3                                         [ Ukončit  Esc ]   │
│ ┌───────────────┐  Decathlon · 249,00 Kč · 12. 9. 2026                   │
│ │  [náhled]     │  „Batoh Quechua 20 l"                                  │
│ │               │                                                        │
│ └───────────────┘  Je to soukromé, nebo firemní?                    │
│                                                                          │
│   [1] Firemní         [2] Soukromé        [3] Napůl…                         │
│   Navrhujeme: Soukromé (podobné nákupy jste tak označili)            │
│                                                                          │
│   S přeskočit · O otevřít doklad · Z vrátit · ? zkratky                  │
└──────────────────────────────────────────────────────────────────────────┘
```
- Queue = M09 §4.6 set, ordered: blocking first, then by `created_at` asc; questions on the same document are consecutive.
- `review_questions.kind` → card template: `business_or_personal` (3 options), `which_category` (top 3 suggestions + "Jiná…"), `confirm_field` (shows the field crop from `bbox` + value, options "Ano, sedí" / "Opravit" opens inline click-to-fill), `missing_document` (Phase 2: "Nahrát doklad" / "Doklad není potřeba" / "Požádat dodavatele"), `car_regime` (04 §3.1), `confirm_profile` (onboarding "Nevím"). Unknown kinds fall back to "Otevřít doklad".
- Answer = server action `answerReviewQuestion(id, answer)` (writes `answer`, `answered_by`, `answered_at`; applies the effect; re-runs M03/M04). Optimistic UI: the next card slides in immediately (≤ 100 ms); on server error the card returns with a toast.
- Undo (`Z` or ⌘Z) reverts the last answer within the session (server action `undoReviewAnswer`, allowed until the document is finalized).
- End state: "Hotovo. Vše je vyřízeno." + summary ("2 doklady potvrzeny, 1 označen jako soukromý") + [Zpět na přehled].

**Keyboard shortcuts** (single-key shortcuts are active only while the review card, the Inbox list or the document panel has focus — WCAG 2.1.4; `?` opens the cheat sheet):

| Scope | Keys |
|---|---|
| Global | `⌘K`/`Ctrl K` command palette · `/` search · `g i` Inbox · `g p` Přehled · `g u` Pro účetní · `g n` Nastavení · `u` nahrát · `?` zkratky |
| Review | `1`–`4` answer · `Enter` accept suggestion · `S` skip · `O` open document · `Z` undo · `J`/`K` next/previous · `Esc` exit |
| Inbox list | `J`/`K` move · `Enter` open · `X` select (expert) · `#` delete |
| Document | `E` edit focused field · `F` next field needing attention · `[` `]` page · `+`/`−` zoom · `Enter` (in field) save · `Esc` cancel pick mode |

### 5.8 Mobile / PWA capture (`/foto`)

PWA manifest: `name "Shoebox"`, `start_url "/inbox"`, `display "standalone"`, `shortcuts: [{name: "Vyfotit doklad", url: "/foto"}]`, icons 192/512 + maskable. Service worker: precache app shell only (no API caching, no offline queue in V3).

Flow (camera bundle per M01 §4.1 step 4):
```
[(+) → Vyfotit] → native camera (<input type="file" accept="image/*" capture="environment">)
   → sheet: [img1 ✓]   [ Přidat další stránku ]   [ Hotovo ]
   → (more pages share one bundle_id, bundle_index 1..n)
   → [ Hotovo ] → upload with per-photo progress → "Odesláno. Přečteme to za pár vteřin." → Inbox
```
- Client-side: downscale JPEG/PNG to max 2 400 px long edge, quality 0.85, apply EXIF orientation and **strip EXIF** (GPS) before upload; HEIC uploaded as-is (server converts and re-encodes, M01/M12). Max 10 pages per bundle.
- All photos of one bundle carry the same `bundle_id`; M01 assembles them into one PDF document (`origin='camera_bundle'`), so a long receipt shot in two photos is one document.
- Network loss during upload: automatic retry 3× with backoff while the page stays open; then "Nepodařilo se odeslat. Zkusit znovu" (files kept in memory until the page closes). True offline queue is Later (02).
- Also on mobile: share-target is Later; e-mail forwarding is the recommended path and is promoted on the empty state.

### 5.9 Accountant view

Role `accountant` (ADR-012; RLS 05 §10: read all, write only comments, `review_questions.answer`, `accountant_packages`).
- Landing: **Pro účetní** in accountant mode: list of periods with package state and completeness, "Stáhnout" (ZIP/Pohoda/ISDOC), open questions to the client, comment threads.
- Inbox read-only: no upload, no delete, no classification edits; each document has "Přidat komentář" and, for review questions, the same answer cards (the accountant may answer; `answered_by` shows who).
- Přehled read-only; expert view on by default; deadlines visible, "Hotovo" hidden.
- Org switcher in the header lists every org where the user is an accountant (multi-client portal is Later; this is the minimal version).
- Every write by an accountant is labeled in the UI ("Odpověděla účetní Jana N.").

## 6. Empty states

| Where | Condition | Copy (title / body / action) |
|---|---|---|
| Inbox – Vše | no documents | "Sem přijdou vaše doklady" / "Přeposílejte faktury na {address}, nahrajte PDF nebo vyfoťte účtenku." / [Nahrát doklady] [Kopírovat adresu] |
| Inbox – Ke kontrole | 0 items | "Vše vyřízeno" / "Nové otázky se objeví jen tehdy, když si nebudeme jistí." / — |
| Inbox – Podklady | none | "Žádné podklady" / "Výpisy, objednávky a podaná přiznání sem zařadíme automaticky." |
| Přehled | no counted documents | Checklist card "Začněte ve 3 krocích": ① Pošlete první doklad ② Pozvěte účetní (if has_accountant) ③ Nahrajte výpis z banky (Phase 2) — each step ticks itself. Meters hidden until ≥ 1 counted document. |
| Přehled – income 0, expenses > 0 | P4 golden | "Zatím tu nemáme žádné příjmy. Nahrajte vydané faktury nebo výpis z Airbnb/Booking." |
| Termíny | none in 60 days | "V nejbližších 60 dnech nic nehoří." |
| Pro účetní | no accountant | "Máte účetní? Pozvěte ji — uvidí doklady a stáhne si je ve svém formátu." / [Pozvat] · "Nebo stáhněte balíček sami" [Stáhnout ZIP] |
| Search | no results | "Nic jsme nenašli pro „{q}". Zkuste částku, číslo dokladu nebo IČO." |

## 7. Error states

| Situation | UI | Copy |
|---|---|---|
| Upload: unsupported type | row `--destructive`, no retry | "Tento formát neumíme ({ext}). Pošlete PDF, fotku nebo ISDOC." |
| Upload: too large / too many | row `--destructive` | "Soubor je větší než 25 MB." / "Najednou můžete nahrát nejvýš 100 souborů." (values from M01 config, interpolated) |
| Upload: network | row `--warning` + retry | "Nahrávání se přerušilo." [Zkusit znovu] |
| Processing failed (`failed`) | badge `--destructive`, Ke kontrole | "Doklad se nepodařilo přečíst." [Zkusit znovu] [Vyplnit ručně] |
| Processing slow (> 120 s) | chip neutral | "Trvá to déle než obvykle. Nemusíte čekat — dáme vědět." |
| Registry outage (M03 banner) | thin banner on Inbox + detail | "Registr DPH je teď nedostupný. Ověříme dodavatele později, nic nemusíte dělat." |
| E-mail rejected (M01: too large) | in-app notification | "E-mail od {from} byl příliš velký (nad 25 MB). Pošlete přílohy po částech." |
| Permission (accountant/viewer edits) | disabled controls + tooltip | "Upravovat může jen majitel nebo člen firmy." |
| Session expired | modal | "Z bezpečnostních důvodů jsme vás odhlásili." [Přihlásit znovu] (draft inputs preserved) |
| Document in trash / not found | full page | "Doklad je v koši (smaže se {date})." [Obnovit] / "Doklad neexistuje nebo k němu nemáte přístup." |
| Server error | toast or page | "Něco se pokazilo na naší straně. Zkuste to prosím znovu. (Kód: {requestId})" |
| Offline (PWA) | top banner | "Jste offline. Zobrazujeme poslední načtená data." |

Errors never show stack traces, SQL or provider names. Every error toast includes the `requestId` (M12 §4.7) in expert view.

## 8. Component inventory (shadcn/ui + app components in `packages/ui`)

**shadcn/ui primitives** (copied into `packages/ui/src/primitives`, Radix-based): Button, Input, Textarea, Label, Select, RadioGroup, Checkbox, Switch, Slider, Tabs, Card, Badge, Alert, Dialog, Sheet, Drawer (mobile bottom sheets), Popover, Tooltip, DropdownMenu, Command (⌘K), Toast (Sonner), Skeleton, Progress, Separator, ScrollArea, Accordion, Table, Form (react-hook-form + zod resolver), Calendar/DatePicker (only in profile-change flow and expert deadlines grid), Avatar.

**App components** (props typed, Storybook not required; each has a Vitest + axe test):

| Component | Purpose / key props |
|---|---|
| `MoneyText` | `{ value: string; currency: string; signed?: boolean }` → `Intl.NumberFormat('cs-CZ')`, tabular numerals, NBSP before "Kč" |
| `LegalDateText` | `{ date: LegalDate; relative?: boolean }` → "25. 9. 2026" / "za 3 dny" |
| `StatusBadge` | `{ status: DocumentStatus; cls: DocumentClass; processingSince?: string }` (§4) |
| `SourceBadge` | `{ source: FieldSource; confidence?: number; page?: number }` |
| `ExplainPopover` | `{ i18nKey: string; params?: Record<string,string>; moreHref?: string }` |
| `DocumentRow` | list row (§5.1) |
| `PdfViewer` + `HighlightLayer` + `PickLayer` | §5.6; `{ fileUrl; pages; highlights: Highlight[]; onPick(sel) }` |
| `FieldRow` | label, value, SourceBadge, edit, pick trigger |
| `ClassificationSentence` | renders and edits category/business/VAT (§5.6) |
| `QuestionCard` | §5.7; `{ question: ReviewQuestion; onAnswer; shortcuts }` |
| `UploadDropzone` | full-window drop + paste + visible button alternative (WCAG 2.5.7), per-file progress |
| `AddMenu` | the "+" menu: Nahrát · Vyfotit · Přidat ručně (· Importovat z Excelu, Phase 2) |
| `RegisterTable` | the "Vše" table (§5.1): columns, filters, sort, multi-select, bulk bar, "Stáhnout jako Excel" |
| `ManualEntryForm` | §5.1a, reuses `FieldRow`s; substitute toggle |
| `ImportWizard` | Phase 2: 3 steps, column mapping, 10-row preview |
| `CaptureFlow` | §5.8 |
| `InboxAddressCard` | address + copy + rotate |
| `LimitMeter` | progress/bullet bar with zones (07 §6); `role="meter"`, aria-valuenow/min/max; number and threshold always as text beside the bar; level icon; colour supplementary only |
| `DeadlineList`, `FilingCard`, `PackageCard`, `IoStatusCard`, `ReserveCard` (Phase 4), `AlertStrip` | M09 widgets |
| `EmptyState`, `ErrorState` | icon, title, body, action |
| `ExpertOnly` | renders children only when `prefs.ui.expert_view` |
| `CommandPalette` | ⌘K (Later) |
| `OnboardingStep` | wizard frame with progress "Krok n/4" |

**Tokens, typography, spacing, icons, motion:** only from `07-design-system.md` §3–§7 (`packages/ui/tokens.css`; Inter; Lucide icons 20 px; one action colour `--primary`; `--success` is status only, 07 §3). M11 defines no palette or type of its own. Tables use TanStack Table on shadcn `Table` (07 §6). Dark mode toggle lives in the avatar menu (not a counted setting).

**Search index:** merged into 05 on 2026-10-18; see 05 §4 `documents_search_trgm` (pg_trgm; register search by number/VS/partner without a search service).

## 9. Accessibility (WCAG 2.2 AA; baseline rules in 07 §8)

- `lang="cs"` (or `en`); landmarks (`header`, `nav`, `main`); skip link "Přeskočit na obsah"; one `h1` per screen.
- Colour contrast ≥ 4.5:1 text, ≥ 3:1 UI components and focus rings; status never by colour alone (icon + text) — chips, meters, checks.
- Full keyboard operation; visible focus (07: 3 px `--ring`, 2 px offset, never obscured by sticky bars, 2.4.11); logical tab order; dialogs/sheets trap focus and restore it; `Esc` closes.
- Single-key shortcuts only when the relevant region has focus (2.1.4); all shortcuts have clickable equivalents.
- Live regions: processing status changes announced politely ("Doklad IKEA je hotový"); toasts `role="status"`; errors `role="alert"`.
- PDF viewer: every highlighted value is also in the field list (text alternative); viewer controls labelled; images have alt = summary sentence.
- Forms: labels bound, errors linked via `aria-describedby`, error summary on submit; input purpose (`autocomplete`) for e-mail/name.
- Touch targets ≥ 44 × 44 px with ≥ 8 px spacing (07 §8); no hover-only actions (long-press menu alternative). Click-to-fill dragging always has a single-click alternative (click a word), WCAG 2.5.7.
- `prefers-reduced-motion`: the review-flow card change becomes instant (07 §7).
- Text resizes to 200 % without loss; layout works at 320 px width (1.4.10 reflow).
- Automated: `@axe-core/playwright` on every screen and state in E2E → 0 violations (07 §8, CI gate); the 07 §9 pre-delivery checklist is part of every UI acceptance. Manual: yearly keyboard + NVDA/VoiceOver pass on the 4 screens + review flow (checklist in `docs/runbooks/annual-update.md`).

## 10. Performance budgets

| Metric | Budget | How measured |
|---|---|---|
| Dashboard / Inbox TTFB | < 500 ms p95 (03 §4) | OTel server spans (M12) |
| LCP (Moto G-class, 4G) | < 2.5 s on Inbox and Přehled | Playwright + `web-vitals` in staging, weekly |
| INP | < 200 ms; review answer → next card < 100 ms (optimistic) | web-vitals RUM sample (no content) |
| CLS | < 0.1 | web-vitals |
| JS (gzip) first load | ≤ 170 KB for /inbox, /prehled; document detail ≤ 170 KB + lazy PDF viewer chunk ≤ 450 KB | `scripts/check-bundle-budget.ts` reads Next build manifest; CI fails on breach |
| Thumbnails | WebP 160/320 px, ≤ 25 KB each, generated at ingestion | M01 |
| Inbox list | virtualized beyond 100 rows; 50-row pages | — |
| Realtime | one channel per org; no per-row subscriptions | — |

Rules: RSC by default; client components only for interactive islands (upload, viewer, review, meters' tooltips). No chart library in V3 (sparkline is an inline SVG component). No date library beyond `Intl` + our `LegalDate` helpers.

## 11. Czech UX-copy glossary (term → user-facing wording)

Use the right column in default view; the left term may appear in expert view and "Proč?" texts.

| Legal / technical term | User-facing wording | Explanation ("Proč?" / glossary) |
|---|---|---|
| DUZP (datum uskutečnění zdanitelného plnění) | **Datum plnění** | Den, kdy jste zboží nebo službu dostali. Podle něj se doklad počítá do měsíce. |
| Datum vystavení | Vystaveno | Kdy dodavatel doklad vytvořil. |
| Datum splatnosti | Splatnost | Do kdy je potřeba zaplatit. |
| Datum přijetí | Přišlo | Kdy doklad dorazil k nám. |
| Variabilní symbol | Variabilní symbol | Číslo, podle kterého spárujeme platbu. |
| Přenesená daňová povinnost / reverse charge (§92a, §108) | **DPH přiznáváte vy** | Dodavatel vám DPH neúčtoval, protože to zákon u této služby nebo zboží přesouvá na vás. Přiznáte ji v přiznání k DPH. Jako identifikovaná osoba ji zaplatíte, ale odečíst si ji nemůžete; plátce si ji zároveň odečte. |
| Samovyměření u služby ze zahraničí | DPH přiznáváte vy (služba ze zahraničí) | Booking.com, Anthropic nebo Cloudflare jsou zahraniční firmy, proto DPH z jejich faktur přiznáváte v Česku vy. |
| Identifikovaná osoba (§6g–6l) | Identifikovaná osoba k DPH | Nejste plátce DPH, ale protože nakupujete služby ze zahraničí, musíte z nich DPH přiznat a zaplatit. Přiznání podáváte jen za měsíce, kdy takový nákup máte. |
| Plátce DPH | Plátce DPH | — |
| Neplátce | Nejste plátce DPH | — |
| Obrat (pro registraci) | **Příjmy pro limit DPH** | Součet vašich tuzemských prodejů za kalendářní rok. |
| Daňový doklad (§29) | Daňový doklad | Doklad, který splňuje zákon o DPH. |
| Zjednodušený daňový doklad (§30) | Účtenka (zjednodušený doklad) | Doklad do 10 000 Kč, nemusí obsahovat vaše údaje. |
| „Toto není daňový doklad" | **Není daňový doklad** | Pro daň z příjmů ho použít můžete, pro DPH ne. |
| Objednávka / potvrzení objednávky | Objednávka (zatím ne doklad) | Fakturu od e-shopu teprve čekáme; objednávku si schováme. |
| Zálohová faktura | Zálohová faktura (zatím ne doklad) | Výzva k platbě; daňový doklad přijde po zaplacení. |
| Náhradní doklad (ztracený/poškozený doklad) | **Doklad chybí / je poškozený** | Výdaj můžete zapsat ručně. Pro daň z příjmů ho doložíte platbou, DPH si bez daňového dokladu odečíst nelze. Rozhodne účetní. |
| Opravný daňový doklad / dobropis | Dobropis | Opravuje dřívější fakturu, obvykle snižuje částku. |
| Daňově uznatelný výdaj | **uznatelné (snižuje daň)** | Výdaj, o který si můžete snížit základ daně. |
| Daňově neuznatelný | neuznatelné (nesnižuje daň) | Např. reprezentace nebo pokuty. |
| Dlouhodobý majetek (> 80 000 Kč) | Majetek k odpisům | Dražší věci se nedávají do výdajů najednou; vyřeší účetní. |
| Soukromá spotřeba | Soukromé (vs. Firemní, Napůl) | Nákup pro vás, ne pro podnikání; do výdajů ho nepočítáme. |
| Průběžná položka (pass-through) | **Průchozí platba** | Peníze, které jen vybíráte za někoho jiného, např. poplatek z pobytu pro obec. Není to váš příjem. |
| Poplatek z pobytu | Poplatek z pobytu | Vybíráte ho od hostů a odvádíte obci (např. Praha 3). |
| Vyúčtování správce | Vyúčtování od správce | Přehled pobytů a odměn od správce bytu; samo o sobě není doklad o výdaji. |
| Základ daně (DPH) | Částka bez DPH | — |
| Sazba DPH základní / snížená | DPH 21 % / DPH 12 % | Sazby se načítají z pravidel, nikdy je nepíšeme natvrdo. |
| Daňová evidence | Skutečné výdaje (daňová evidence) | — |
| Výdajový paušál | Paušální výdaje (procento z příjmů) | — |
| Paušální daň / paušální režim | Paušální daň (jedna platba měsíčně) | Jedna měsíční platba za daň, sociální a zdravotní pojištění. |
| Pásmo paušální daně | {n}. pásmo | — |
| Přiznání k DPH (DPHDP3) | Přiznání k DPH | — |
| Kontrolní hlášení (DPHKH1) | Kontrolní hlášení | Seznam faktur nad 10 000 Kč pro finanční úřad; podávají plátci. |
| Souhrnné hlášení (DPHSHV) | Souhrnné hlášení (služby do EU) | — |
| Řádek 5 / 12 / 43 | (expert only) řádek {n} | — |
| Nespolehlivý plátce | Nespolehlivý plátce — pozor při placení | Finanční úřad varuje, že tento dodavatel neplní povinnosti. |
| Zveřejněný bankovní účet | Účet ověřený u finančního úřadu | — |
| Kurz ČNB (§38) | Kurz ČNB ze dne {date} | Cizí měnu přepočítáváme kurzem České národní banky. |
| Párování plateb | Zaplaceno (máme platbu) | — |
| Chybějící doklad | **Chybí doklad** | Platba z účtu, ke které nemáme fakturu ani účtenku. |
| Confidence | Jisté / Ověřte prosím | (expert: číslo 0–1) |
| Vendor memory | jako minule | — |
| Finalizace | Uzavřít / Uzavřeno | Uzavřený doklad už se nemění; opravy vytvoří novou verzi. |
| Revize | Verze | — |
| Podklady (k DPFO) | Podklady pro daň z příjmů | Čísla, která doplníte na MOJE daně nebo předáte účetní. |
| Filing card states | Připraveno · Potřebuje účetní · Podáno · Bude potřeba opravit | — |

Copy rules: second person plural formal ("vy"), short sentences, numbers formatted per `cs-CZ` (thousands NBSP, decimal comma), dates "25. 9. 2026", no exclamation marks, no emoji, gender-neutral where possible ("Už jsem registrovaný/á").

## 12. i18n conventions

- Catalogs in `packages/i18n/messages/{cs,en}.json`, ICU MessageFormat; Czech is the source of truth; English must have every key (CI check).
- Key pattern `<area>.<screen|object>.<element>` (e.g. `inbox.tabs.review`, `doc.field.duzp.label`, `vat_treatment.rcv_eu_service_reverse_charge.why`).
- Czech plurals use ICU `one / few / many / other` (`1 doklad`, `2 doklady`, `5 dokladů`; `many` for decimals).
- Lint: no string literals in JSX text or `aria-*`/`title`/`placeholder` attributes in `apps/web` (Biome plugin, M12 §4.1).
- Enum display names come from i18n (`enum.document_class.received_invoice`), never from enum values.

| Key | cs |
|---|---|
| `inbox.title` | Inbox |
| `inbox.tabs.review` / `.all` / `.supporting` / `.other` / `.trash` | Ke kontrole / Vše / Podklady / Ostatní / Koš |
| `inbox.upload.cta` | Nahrát doklady |
| `inbox.upload.drop` | Pusťte soubory sem |
| `inbox.address.label` | E-mail pro doklady |
| `review.progress` | Otázka {n} ze {total} |
| `review.q.business_or_personal` | Je to soukromé, nebo firemní? |
| `review.q.which_category` | Za co byl tento výdaj? |
| `review.q.confirm_field` | Sedí {field}? |
| `review.done` | Hotovo. Vše je vyřízeno. |
| `doc.confirm` | Potvrdit |
| `doc.confirm.disabled` | Nejdřív vyřešte: {reason} |
| `doc.pick.banner` | Klikněte nebo táhněte přes hodnotu v dokladu |
| `manual.add` | Přidat ručně |
| `manual.substitute.toggle` | Doklad chybí / je poškozený |
| `manual.substitute.note` | Výdaj se může započítat do daně z příjmů, pokud doložíte platbu. DPH si bez daňového dokladu odečíst nelze. Rozhodne účetní. |
| `manual.substitute.reason.lost` / `.damaged` / `.never_issued` / `.other` | ztracený / poškozený / nebyl vystaven / jiný důvod |
| `register.export_xlsx` | Stáhnout jako Excel |
| `register.bulk.mark_paid` | Označit jako zaplacené |
| `import.wizard.step2` | Přiřaďte sloupce. Náhled ukazuje prvních 10 řádků. |
| `review.answer.business` / `.private` / `.mixed` | Firemní / Soukromé / Napůl |
| `doc.delete.retained` | Tento doklad musíme ze zákona uchovat 10 let. Skryjeme ho, ale nesmažeme. |
| `onboarding.ico.label` | Vaše IČO |
| `onboarding.vat.question` | Jste plátce DPH? |
| `onboarding.regime.question` | Jak uplatňujete výdaje? |
| `onboarding.accountant.question` | Máte účetní? |
| `settings.expert_view` | Pohled pro pokročilé |
| `vat_treatment.rcv_eu_service_reverse_charge.why` | {supplier} je firma z {country}. U služeb ze zemí EU přiznáváte DPH vy, sazba {rate} %. |
| `tax_doc_status.not_tax_document.why` | Na dokladu stojí „{phrase}". Pro daň z příjmů platí, pro DPH ne. |

## 13. Data and interfaces

### 13.1 Server actions and routes (`apps/web`, all validate input with zod, run under the user session so RLS applies, write `audit_log`)

```ts
// uploads (presigned; M01 owns ingestion after completeUpload)
// M01 owns these routes; the UI calls: POST /api/v1/uploads (batch → signed URLs per ingest item, optional bundleId/bundleIndex),
// PUT to the signed URL (XHR for progress, ≤ 4 parallel, 3 retries), POST /api/v1/uploads/{id}/complete, GET /api/v1/uploads/batches/{id}.

// document detail
updateDocumentField(input: { documentId: string; fieldKey: string; value: string | null;
                             pick?: { page: number; bbox: [number, number, number, number] } }): Promise<FieldView>;
setClassification(input: { documentId: string; lineIds?: string[]; categoryCode?: string;
                           businessFlag?: 'business' | 'personal' | 'mixed'; businessSharePct?: number;
                           vatTreatment?: VatTreatment; rememberForVendor?: boolean }): Promise<void>;
confirmDocument(input: { documentId: string }): Promise<{ status: 'ready' | 'finalized' }>;   // 409 if blocking validation open
confirmAllCertain(input: { dryRun: boolean }): Promise<{ count: number; documentIds: string[] }>;
deleteDocuments(input: { ids: string[] }): Promise<{ trashed: string[]; retained: string[] }>;   // retained = finalized, hidden only
restoreDocuments(input: { ids: string[] }): Promise<void>;

// review flow
answerReviewQuestion(input: { questionId: string; answer: ReviewAnswer }): Promise<{ next?: ReviewQuestionView }>;
undoReviewAnswer(input: { questionId: string }): Promise<void>;
type ReviewAnswer = { kind: 'business_or_personal'; value: 'business' | 'personal' | 'mixed'; sharePct?: number }
  | { kind: 'which_category'; categoryCode: string } | { kind: 'confirm_field'; ok: true } | { kind: 'confirm_field'; ok: false; value: string }
  | { kind: 'missing_document'; action: 'upload' | 'not_needed' | 'request' } | { kind: 'car_regime'; value: string }
  | { kind: 'confirm_profile'; profile: ProfileInput };

// manual entry: one implementation, owned by M01 (§4.12, §6.1). The form calls M01's
// startManualDocument(ctx, photoIngestItemId, class) when a photo is attached, and
// saveManualDocument(ctx, documentId | null, input: ManualEntryInput) to save.
// Form → ManualEntryInput: Typ → class · Dodavatel → partnerName / partnerIco · Datum → issueDate · Částka → totalGross + currency
// · Zaplaceno → paymentMethod · Za co → categoryCode · Firemní ▾ → businessFlag · Podrobnosti → documentNumber, vat, dueDate, duzp
// · "Doklad chybí / je poškozený" → substituteReason ∈ {lost, damaged, never_issued, other}

// register ("Vše")
const RegisterFilter = z.object({ from: z.string().date().optional(), to: z.string().date().optional(),
  status: z.array(DocumentStatusEnum).optional(), paid: z.enum(['all', 'paid', 'unpaid', 'overdue']).default('all'),
  categories: z.array(z.string()).optional(), hasFile: z.boolean().optional(), direction: z.enum(['in', 'out']).optional(),
  q: z.string().max(100).optional(), sort: z.enum(['date', 'partner', 'number', 'amount', 'vat', 'paid', 'category']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'), cursor: z.string().optional() });
listRegister(filter: z.infer<typeof RegisterFilter>): Promise<{ rows: RegisterRow[]; nextCursor?: string; totalCount: number }>;
bulkDocumentAction(input: { ids: string[]; action: 'mark_paid' /* Phase 2 */ | 'set_category' | 'set_business' | 'set_personal' | 'zip' | 'delete';
                            paidOn?: string; categoryCode?: string }): Promise<{ affected: number; jobId?: string }>;
// GET /api/v1/register.xlsx?<RegisterFilter as query>  → streamed XLSX (packages/exports exportRegisterXlsx)

// settings & onboarding
completeOnboarding(input: OnboardingInput): Promise<{ orgId: string; inboundAddress: string }>;
changeProfile(input: ProfileInput & { validFrom: string }): Promise<{ affectedDocuments: number }>;
rotateInboundAddress(): Promise<{ address: string; oldValidUntil: string }>;
updatePrefs(input: Partial<MembershipPrefs>): Promise<void>;                 // M09 §5.3
searchDocuments(input: { q: string }): Promise<SearchHit[]>;                 // ≤ 20 hits, trigram index; Vše search box (⌘K Later)
```
Errors: actions return typed `{ ok: false, code }` with codes `forbidden`, `not_found`, `blocking_validation`, `conflict_revision`, `rate_limited`, `invalid_input`; the UI maps each to §7 copy.

### 13.2 Events consumed by the UI
Supabase Realtime on `documents`, `review_questions`, `notifications` (org channel). Server-side cache tags: `org:{id}:inbox`, `org:{id}:dashboard`, invalidated by the actions above and by `document.status_changed` / `ledger.document_rebuilt`.

### 13.3 Schema
Merged into 05 on 2026-10-18; see 05 §4 `documents_search_trgm` and `documents_register`, 05 §2 `memberships.prefs` (adds `ui.locale`). `review_questions.kind` gains `confirm_profile` (04 §9.1). Camera bundles use M01's `ingest_items.bundle_id`/`bundle_index`.

### 13.4 UX touchpoints owned by other modules
M01 upload limits, capture grouping and the spreadsheet-import parser; M02 `PageText` word layer and `summary_cs`; M03 validation messages (`validation.{rule_id}.*`) and registry banner; M04 category explanations, vendor-memory prompt and the treatment of `substitute_reason`; M05 filing card actions; M07 missing-document cards and real payment matching (Phase 2); M09 all Přehled numbers; M10 package actions and file naming; M12 privacy screens and admin.

## 14. Edge cases and failure modes

1. Multi-page photo receipt split across captures → "Přidat další stránku" (§5.8); if the user forgets, M01 split/merge suggestion appears as a review question.
2. Document with 40+ lines (Alza) → lines collapsed by default ("12 položek"), virtualized in expert view.
3. Foreign currency → amount shown in original currency + "≈ {czk} Kč (kurz ČNB {date})".
4. Negative lines and rounding (Alza 0,05) → shown as "Sleva −16,53 Kč", "Zaokrouhlení 0,05 Kč"; never hidden.
5. Very long partner names → truncate with tooltip; full name in detail.
6. NFC/NFD filenames (golden IKEA duplicate) → display `filename_nfc`.
7. Concurrent edits (owner + accountant) → last write wins per field, with a toast "Jana právě upravila tento doklad" (Realtime) and reload of the field list.
8. Accountant answers a question the owner is viewing → card disappears with "Odpověděla účetní".
9. Expert view toggled mid-flow → no navigation change; only extra fields appear.
10. Small screens (320 px) → document detail fields stack; viewer opens full screen.

## 15. Acceptance criteria and test plan

1. AC-1 (02 Phase 1 E2E) Playwright: sign up with a seeded IČO (fake ARES) → wizard completes in ≤ 4 screens → signed inbound-email webhook with 3 attachments (golden IKEA receipt, Decathlon PNG, Alza order confirmation) → Inbox shows IKEA "Hotovo", Decathlon in Ke kontrole with "Je to soukromé, nebo firemní?", Alza order under Podklady with chip "Podklad" → answer with key `2` (Soukromé) → Přehled expenses this month include 1 198 Kč and exclude 249 Kč and 2 105 Kč → "Stáhnout ZIP" downloads a non-empty ZIP.
2. AC-2 Golden duplicates: IKEA NFD copy and the second Decathlon PNG appear under Ostatní with chip "Duplicita" and a link to the original; they are not in Ke kontrole.
3. AC-3 Golden Alza 117 Kč: detail shows chip "Není daňový doklad" with the "Proč?" text quoting „Toto není daňový doklad"; discount lines render negative; rounding 0,05 Kč is visible.
4. AC-4 Golden Booking (Aug): VAT field shows "přiznáváte vy" with the `rcv_eu_service_reverse_charge` explanation; the missing-buyer-DIČ check appears as a warning (not blocking) per M03; settlement statement link chip is present when M04 links it.
5. AC-5 Click-to-fill: on a golden PDF with a text layer, clearing "Celkem", picking the printed total on the viewer fills `11 549,94`, writes `document_fields.source='user'` with `bbox`, and re-runs validation (math gate passes).
6. AC-6 Every field badge matches its `document_fields.source`; `llm` values below the review threshold show "ověřte".
7. AC-7 Review flow: answering 3 questions with keys only (`1`, `2`, `Enter`) works without a mouse; `Z` undoes the last answer; focus is never lost.
8. AC-8 Onboarding median completion < 60 s in a scripted run (fake registries, no typing beyond IČO); ARES-down path completes with manual fields.
9. AC-9 Settings screen exposes exactly 15 settings (snapshot test over a settings registry `settings.registry.ts`).
10. AC-10 Accountant role: cannot upload, delete, edit fields or mark deadlines done (buttons absent, server actions return 403); can comment and answer questions; lands on Pro účetní.
11. AC-11 axe: zero serious/critical violations on Inbox (all tabs), Přehled, Pro účetní, Nastavení, onboarding steps, document detail, review flow, capture, empty and error states (light + dark).
12. AC-12 Bundle budget script passes; LCP < 2.5 s and INP < 200 ms on staging for Inbox and Přehled (Moto G emulation).
13. AC-13 i18n: no hard-coded strings (lint passes); `en` has 100 % of `cs` keys; ICU plural forms render correctly for 1, 2, 5.
14. AC-14 Mobile capture: two photos taken with "Přidat další stránku" yield one document with 2 pages (M01 bundle); uploaded images have no EXIF GPS.
15. AC-15 Manual entry: "+" → "Přidat ručně" → fill Partner/Datum/Částka/Za co → "Uložit" (3 clicks) creates a document with `entry_mode='manual'`, `source_file_id` null, badge "Hotovo" after validation; with the substitute toggle on, `substitute_reason='lost'`, badge "Nedaňový", and the inline note is visible.
16. AC-16 Register ("Vše"): sorting by each column, filter Zaplaceno = nezaplaceno, multi-select 2 rows → footer Σ equals their sum; "Stáhnout jako Excel" (1 click) downloads an XLSX whose rows equal the filtered view (row count and Σ Částka asserted) and whose `Soubor` column is empty for manual entries.
17. AC-17 Click budget table of 07 §2 is measured in E2E for: add document, confirm, fix one field, answer question, add manually, search, Excel download.
18. AC-18 (Phase 2) Import wizard: a 50-row CSV maps by header names automatically, the preview shows exactly 10 rows, an unparseable date is flagged, and import creates documents with `entry_mode='imported'`.

**Test plan:** component tests (Vitest + Testing Library + axe) for every app component; Playwright projects `desktop-chromium`, `mobile-webkit` (iPhone 14), `mobile-chromium` (Pixel 7); visual snapshots only for the 4 screens' empty states (low churn); E2E fixtures from `packages/testkit` (personas P1–P4, golden set); fake registries and replayed LLM cassettes (M12 §4.10).

## 16. Maintenance

| Source of change | Effort/year |
|---|---|
| Copy for new rules/explanations (Annual Update Window) | 0.5 day |
| shadcn/ui primitives are vendored code — update only on need; Radix/Tailwind/Next majors via Renovate | 1 day |
| Yearly manual a11y pass + fixes | 1 day |
| Glossary additions when M03/M04 add rules or treatments | included above |

**Total ≈ 2–2.5 days/year** (mostly non-law). No monitors beyond M12 web-vitals and error tracking.

## 17. Open questions
Consolidated in `22-open-questions.md`: D-01 (name and logo; nothing in M11 waits on it), TA-02 (manual-entry and substitute-document wording). Resolved (22 §F): page word layer in `derived/{sha256}/text.json`; `summary_cs` from M04's template; chips Firemní / Soukromé / Napůl everywhere (02 and M04 aligned); accountants get expert view on by default; `document_revisions` exists in 05; bulk "mark paid" is Phase 2 and reuses the "Pokladna" cash account.
