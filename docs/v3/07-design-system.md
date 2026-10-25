# 07: Design system

**Promise to the user:** easy, simple, extremely intuitive, the fewest clicks possible, accessible to everyone, and beautiful because it is calm.

This file decides the look and the interaction rules for every screen. M11 decides *which* screens and copy exist; this file decides *how they look and behave*. Components live in `packages/ui`; tokens live only there.

**Source.** The style was chosen with the [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) skill. The product match was "Invoice & Billing Tool", and the generated system was then adjusted for contrast (§3).

```
python3 search.py "invoice receipt organizer freelance accessible minimal" --design-system -p "Shoebox" --variance 3 --motion 3 --density 5
```

---

## 1. Style decision

| | Choice | Why |
|---|---|---|
| Primary style | **Minimalism & Swiss Style**: grid, generous white space, strong type hierarchy, almost no decoration | A finance tool must feel calm and trustworthy. Swiss style puts the numbers first and ages well (low maintenance). |
| Feel (owner, 2026-10-25) | **Notion-like**: white page, warm near-black text, light grey fills, thin borders, small radii, the device's own font | Familiar and quiet; the owner's reference. Other references: Airbnb (few, big choices), Competitor A (the competitor to beat). |
| Secondary style | **Accessible & Ethical**: high contrast, large targets, visible focus, no dark patterns | Users are all ages and abilities, often on a phone, often in a hurry. |
| Rejected | Glassmorphism, neumorphism, 3D, heavy gradients, dark-first "fintech" | Low contrast, trend-driven, and they look dated within two years. |
| Rejected | The skill's landing-page pattern | There is no marketing site in V3. |
| Dials | variance 3/10 (consistent), motion 3/10 (subtle), density 5/10 (balanced) | Predictable beats clever; speed beats animation. |

**Beauty comes from:** the device's own typeface used well, a strict 4 px spacing grid, aligned tabular numbers, one accent color, and real document thumbnails as the only imagery.

## 2. Interaction rules: fewer clicks

These rules come before visual polish. A PR that breaks one needs an owner decision.

1. **Zero clicks is the default.** Documents process automatically. The user sees only exceptions: the Inbox opens on "Ke kontrole" (to review) when that list is non-empty, otherwise on "Vše" (all).
2. **One tap to confirm.** A review shows the suggestion already filled in. A single primary button "Potvrdit" (Enter key) accepts it. "Potvrdit všechny jisté" bulk-confirms everything above the confidence threshold.
3. **Questions, not forms.** When something is unclear, ask one question with answer chips ("Je to soukromé, nebo firemní?" → [Firemní] [Soukromé] [Napůl]). Never show a form with 15 fields to fix one.
4. **Edit in place.** Click a value to edit it, and it saves on blur or Enter. No edit mode, no save button.
5. **Undo instead of confirm.** Reversible actions run immediately with a 10 s "Zpět" toast. A confirmation dialog only for irreversible ones: permanent delete, "Označit jako podané".
6. **Drop anywhere.**
   - The whole window is a drop target, and Ctrl/Cmd+V pastes an image or file.
   - The "+" button offers Nahrát / Vyfotit / Přidat ručně.
   - E-mail forwarding needs no click at all.
7. **Never ask twice.** Vendor memory (M04) prefills category and treatment. An answer to a question becomes the default for that vendor.
8. **Progressive disclosure.**
   - VAT treatment, KH section and other tax detail sit under "Podrobnosti", collapsed by default.
   - They expand automatically only for VAT payers and identified persons, and only when relevant to that document.
9. **Keyboard first on desktop.**
   - J/K next/previous, Enter confirm, E edit, / search, Esc close, ? shortcuts.
   - Every shortcut also has a visible button.
10. **Phone first for capture.**
    - The camera opens in one tap from the bottom bar.
    - Multi-photo receipts are one bundle.
    - Primary actions sit in the thumb zone (bottom bar).
11. **Look it up before you ask** (owner, 2026-10-25). The backend fills every field that a registry (ARES, VIES, the unreliable-payer list, published bank accounts), the supplier's past documents, the tax profile or the calendar already knows. The user answers only what nothing else can know. Example: onboarding asks for the IČO, ARES fills name, address and VAT status, and one question remains.
12. **A "?" beside every term** (owner, 2026-10-25). Users know nothing about paperwork. Every tax or accounting word (IČO, DPH, plátce DPH, paušální daň, DUZP, limit meters, a check result) has a "?" button (44 px target, `aria-label` "Co je …?") that opens a two-sentence plain-Czech explanation in place. Copy lives in `packages/i18n` under `help.*`.
13. **No fine print.** Explanations, hints and help use body size (§4). Nothing that the user must read is grey caption text.
14. **Plain words, official term only when different** (owner, 2026-10-25). Lead with the everyday Czech word; add the official term in brackets only when it is a different word, so accountants recognise it too: "Od koho (dodavatel)", "Jen pro informaci (nedaňový doklad)", "Kdy byste museli platit DPH (povinná registrace)". When the two say the same thing, use one: "Nejste plátce DPH", never "Neplatíte DPH (neplátce DPH)".

**Click budget** (measured in E2E tests, `apps/web` e2e):

| Task | Max clicks/taps |
|---|---|
| Add a document (drop, paste, photo) | 1 |
| Confirm a well-read document | 1 |
| Fix one wrong field | 2 |
| Answer a review question | 1 |
| Add a document manually (excluding typing) | 3 |
| Find a document by partner or amount | 1 (type in search) |
| Download "Vše" as Excel | 1 |
| Send the month to the accountant | 2 |
| Generate an identified-person VAT return (Phase 3) | 3 |

## 3. Color tokens

Contrast was checked with the WCAG formula. Body text targets AAA (≥ 7:1), all other text AA (≥ 4.5:1), and UI borders and focus ≥ 3:1.

**One action color.** Blue is the only color that means "do this". Green, amber and red mean *status*, never "click me". This is a deliberate change from the skill's green CTA: two competing action colors add a decision to every screen, and white text on its #059669 is only 3.77:1, which fails AA.

| Token | Light | Dark | Use | Contrast (light / dark) |
|---|---|---|---|---|
| `--background` | #FFFFFF | #0B1220 | page | |
| `--foreground` | #37352F | #E2E8F0 | body text | 12.3 / 15.2 |
| `--card` | #FFFFFF | #111A2E | cards, table, panels | |
| `--muted` | #F7F7F5 | #172036 | subtle fills, table header, "?" buttons | |
| `--muted-foreground` | #5F5E5B | #94A3B8 | secondary text, meta | 6.5 / 7.3 |
| `--border` | #E9E9E7 | #1F2A40 | dividers (decorative) | |
| `--input` | #8F8E8A | #64748B | input and checkbox borders | 3.3 / 3.6 |
| `--primary` | #0B6BCB | #93C5FD | primary button, active nav, links | white on it 5.3; dark text on it 10.4 |
| `--primary-foreground` | #FFFFFF | #0B1220 | text on primary | |
| `--link` | #0B6BCB | #93C5FD | inline links (underlined) | 5.3 / 10.4 |
| `--ring` | #0B0C0C | #FFDD00 | focus ring (GOV.UK style, with `--focus`) | 19.6 / 13.9 |
| `--focus` | #FFDD00 | #FFDD00 | focus fill behind the ring | black text on it 14.5 |
| `--success` | #047857 | #34D399 | Hotovo, Zaplaceno | text 5.2 / 9.7 |
| `--warning` | #92400E | #FBBF24 | Ke kontrole, limit near | 7.1 / 11.2 |
| `--destructive` | #B91C1C | #F87171 | Chybí doklad, errors, delete | 6.5 / 6.8 |
| `--info` | #475569 | #94A3B8 | Nedaňový doklad, neutral notes | 7.2 / 7.3 |

Status fills use the token at 10 % opacity behind the token-colored text and icon. Status is **always color + icon + word**, never color alone.

```css
/* packages/ui/src/tokens.css: the only place raw colors may appear */
:root {
  --background:#FFFFFF; --foreground:#37352F; --card:#FFFFFF; --muted:#F7F7F5; --muted-foreground:#5F5E5B;
  --border:#E9E9E7; --input:#8F8E8A; --primary:#0B6BCB; --primary-foreground:#FFFFFF; --link:#0B6BCB;
  --ring:#0B0C0C; --focus:#FFDD00; --success:#047857; --warning:#92400E; --destructive:#B91C1C; --info:#5F5E5B;
  --radius-control:6px; --radius-card:8px;
}
:root[data-theme="dark"] {
  --background:#0B1220; --foreground:#E2E8F0; --card:#111A2E; --muted:#172036; --muted-foreground:#94A3B8;
  --border:#1F2A40; --input:#64748B; --primary:#93C5FD; --primary-foreground:#0B1220; --link:#93C5FD;
  --ring:#FFDD00; --focus:#FFDD00; --success:#34D399; --warning:#FBBF24; --destructive:#F87171; --info:#94A3B8;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* same values as [data-theme="dark"] */ } }
```

Theme: follow the system by default, with a switch in Nastavení (Světlý / Tmavý / Podle systému).

## 4. Typography

- **The device's own font**, as Notion does (owner, 2026-10-25; checked in notion.so's CSS): `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`. San Francisco on Apple, Segoe UI on Windows, Roboto on Android; all cover Czech diacritics (ě š č ř ž ý á í é ů ú ň ť ď). Nothing is downloaded, so there is no font request at all. Inter (`next/font`) is removed.
- **Numbers:** `font-variant-numeric: tabular-nums` on every amount, date and table column, right-aligned.
  - Format with `Intl.NumberFormat('cs-CZ')`: `1 234,56 Kč`, with a non-breaking space before Kč.
  - Dates use `d. M. yyyy` (`18. 10. 2026`).
- **Scale (rem, base 16 px):**

| Role | Size / line height | Weight |
|---|---|---|
| Page title (h1, one per screen) | 30 / 36 | 600 |
| Section (h2) | 20 / 28 | 600 |
| Card title, document partner name | 18 / 26 | 500 |
| Body, table cells, inputs, help text | 16 / 24 on < 768 px, 19 / 28 on ≥ 768 px (GOV.UK) | 400 |
| Meta, captions, table header | 14 / 20 | 500 |
| Big number (dashboard KPI) | 36 / 40 | 600, tabular |

  Nothing goes below 14 px, and 14 px is only for a status line or table header; anything the user must read is body size (§2 rule 13). Line length is capped at 70 characters for prose. Weights are limited to 400, 500 and 600.

## 5. Space, layout, shape

- **4 px grid:** 4, 8, 12, 16, 24, 32, 48, 64. Gaps between cards are 16 on mobile and 24 on desktop.
- **Breakpoints:** 375 / 768 / 1024 / 1440. Content max-width 1200 px; the document detail is a split view (preview | data) at ≥ 1024.
- **App shell:**
  - **Desktop:** a left rail with the four screens: Inbox, Přehled, Pro účetní, Nastavení.
  - **Mobile:** a bottom bar with the same four, plus a central "+" button.
  - No hamburger menus.
- **Radius:** 6 px for controls and 8 px for cards (Notion-like). Borders over shadows; a single soft shadow is used only for overlays (dialogs, popovers, toasts).
- **Density:** table rows are 48 px (≥ 44 px target) with a comfortable cell padding of 12/16. No "compact mode" setting in V3.
- **Imagery:** real document thumbnails only. No illustrations or stock art. Empty states use a Lucide icon, one sentence and one button.

## 6. Components (`packages/ui`)

| Need | Use | Note |
|---|---|---|
| Base primitives | **shadcn/ui** on Radix | Accessible focus management out of the box; do not hand-roll focus logic |
| Icons | **Lucide** (`lucide-react`), 20 px, 1.5 stroke | No emoji as icons, ever |
| Toasts | **Sonner** via shadcn | Semantic variants: success, warning, error; undo action |
| Tables ("Vše" view, review queue) | shadcn `Table` + TanStack Table | Real `<table>` semantics; on < 768 px rows become cards |
| Upload | drop zone + `<input type="file" multiple>` button | A drag always has a button alternative (WCAG 2.5.7) |
| Limit meters (M09) | progress bar with zones (e.g. warn at 80 %, alert at 95 %, from rules) | Number and threshold as text beside the bar; no chart library in V3 |
| Forms | shadcn `Form` with zod | Label on every input, validate on blur, an error summary at the top on submit failure |
| Status | `StatusBadge` (icon + word + tone) | Zpracovává se · Ke kontrole · Hotovo · Chybí doklad · Nedaňový · Duplicita |

New dependencies beyond this list need a decisions line (`AGENTS.md` rule 7). shadcn, Radix, Lucide, Sonner, TanStack Table and zod are approved by this file.

## 7. Motion

- 150–250 ms, ease-out, for hover, press, expand and toast. Animate only `opacity` and `transform`.
- No motion on numbers, no parallax, no page transitions.
- `prefers-reduced-motion: reduce` turns all transitions into instant changes (fades ≤ 100 ms allowed).
- **Loading:**
  - Skeletons appear after 300 ms; per-file progress during upload.
  - A document that is processing shows "Zpracovává se" with a spinner, announced through `aria-live="polite"` once and not on every tick.

## 8. Accessibility (UK rules: WCAG 2.2 AA required; AAA contrast for body text)

The owner chose the UK rules (2026-10-25). For public bodies they are the Public Sector Bodies Accessibility Regulations 2018, which require WCAG 2.2 AA; for a private service the Equality Act 2010 applies, and WCAG 2.2 AA is the accepted benchmark. We follow WCAG 2.2 AA plus these GOV.UK Design System habits: labels above fields, hint text under the label (never a placeholder), an error summary at the top, the yellow-and-black focus style, plain language, and a public accessibility statement page.


- **Keyboard:**
  - Everything is reachable and operable by keyboard, in visual order.
  - A skip link "Přeskočit na obsah".
  - Landmarks: `header`, `nav`, `main`.
- **Focus:** GOV.UK style: a 3 px `--focus` (yellow) outline plus a `--ring` (black) bar, never removed; the black part carries the contrast on white. Focus is not obscured by sticky bars (2.4.11).
- **Targets:** ≥ 44 × 44 px (above the 24 px AA minimum, 2.5.8), with ≥ 8 px between targets.
- **Content:**
  - `lang="cs"`, and `lang="en"` on English names.
  - Amounts are read correctly: no visual-only "Kč" icons.
  - Images of documents have alt text "Doklad od {partner}, {datum}".
- **Reflow:** works at 320 px width and 200 % zoom with no horizontal page scroll (tables scroll inside their own container).
- **Forms:** visible labels (never placeholder-only), errors in text next to the field and in the summary, nothing time-limited.
- **No dark patterns:** no pre-ticked consent, no confirm-shaming, export is as easy as import.
- **Testing:** axe in every Playwright E2E (0 violations), keyboard-only E2E for the review flow, and one manual VoiceOver and NVDA pass per phase.

## 9. Pre-delivery checklist (every UI brief, copied into §7 Acceptance)

- [ ] Only tokens from §3; no raw hex outside `tokens.css`.
- [ ] Lucide icons only, no emoji; status = icon + word + color.
- [ ] Hover and press states with a 150–250 ms transition; reduced motion respected.
- [ ] Visible focus on every interactive element; keyboard path works end to end.
- [ ] Targets ≥ 44 px; works at 375 px with no horizontal page scroll.
- [ ] Light and dark both checked; text contrast ≥ 4.5:1 (body ≥ 7:1).
- [ ] Amounts tabular, right-aligned, Czech format.
- [ ] Click budget (§2) met for the flow touched.
- [ ] Every tax or accounting term has a "?" help (§2 rule 12); no grey fine print (rule 13); official term in brackets only when it is a different word (rule 14).
- [ ] Every field the backend can look up is prefilled, not asked (rule 11).
- [ ] Czech labels fit at 375 px (Czech runs ~20 % longer than English).
- [ ] axe 0 violations; 375 px screenshot in the report.

## 10. Maintenance

The system is static: no theming engine, no user-customizable colors, no compact mode. Expected upkeep is about 0.5 day/year (dependency bumps of shadcn/Radix/Lucide). Any change to tokens or interaction rules is a decisions line plus an edit to this file.
