# 0063: Onboarding screen `/vitejte`

Status: review
Ticket: P1-ONB-01 (onboarding from IČO) | Depends on: 0062 | Base commit: branch head | Branch: claude/project-thread-e840r7 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The one-page onboarding: the user types an IČO, ARES fills in name and address, then at most three chip questions (VAT, how expenses are counted, the % or band), then "Hotovo" shows the address for sending documents. Owner goal: under a minute, fewest buttons, a "?" beside every term.

## 2. Context

- 0062 gives (in `apps/web/src/onboarding/`): `lookupIco(ico): Promise<LookupResult>` (`found` with `prefill`, `invalid`, `not_found`, `unavailable`), `completeOnboarding(prev, formData): Promise<OnboardingState>` (`idle` | `error` with `code` | `done` with `inboundAddress`), `OnboardingPrefill` (`ico, name, dic, address{street, house_number, orientation_number, city, zip}, addressText, fuCode, vatGuess, validFrom, slugBase`), the form field names = `OnboardingInput` keys (`ico, name, dic, street, houseNumber, orientationNumber, city, zip, fuCode, validFrom, slugBase, vat, regime, pausalRate, pausalDanBand`), `VAT_ANSWERS = ['neplatce','platce_monthly','platce_quarterly','identifikovana_osoba']`, `TAX_REGIME_ANSWERS = ['danova_evidence','pausalni_vydaje','pausalni_dan','nevim']`, gate `needsOnboarding(supabaseMembershipCounter(supabase))`. `@shoebox/registries` exports `isValidIco`.
- Pattern to copy: `apps/web/src/auth/login-form.tsx` (client form, `useActionState`, `role="status" aria-live="polite"` result line, `text-body` only) and `apps/web/app/(auth)/layout.tsx` (header + main landmarks, `id="obsah"`). Primitives from `@shoebox/ui`: `Button`, `Input`, `Card`, `cn`, `focusRing`.
- Design rules (07 §2): 11 look it up before you ask; 12 a "?" beside every term (44 px target, `aria-label` "Co je …?", opens a two-sentence plain-Czech explanation in place; copy under `help.*`); 13 no fine print (body size, never grey caption); 14 plain words first, official term in brackets only when it is a different word. Tokens only, no raw colors. WCAG 2.2 AA: labels above inputs, `fieldset` + `legend` for each chip question, chips are real radio inputs (keyboard works), focus ring from `focusRing`.
- Paušální daň is not allowed for a VAT payer: hide the "Paušální daň" chip while a `platce_*` chip is selected (and clear it if it was selected).
- e2e: Chromium projects only. Run with `PLAYWRIGHT_BROWSERS_PATH` pointing at a shim to the preinstalled Chromium: `mkdir -p /tmp/pw && ln -sfn /opt/pw-browsers/* /tmp/pw/ 2>/dev/null; ls /opt/pw-browsers`. If the folder name the installed `@playwright/test` expects differs (the error names it), symlink that name to the existing chromium folder. **Never run `playwright install`.** In e2e the memberships query fails (fake server, no PostgREST), so `/vitejte` renders; do not rely on ARES in e2e.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/app/vitejte/layout.tsx` | new | header + main (copy `(auth)/layout.tsx`) |
| `apps/web/app/vitejte/page.tsx` | new | server page |
| `apps/web/src/onboarding/help-tip.tsx` | new | "?" disclosure |
| `apps/web/src/onboarding/chips.tsx` | new | `ChipQuestion` |
| `apps/web/src/onboarding/wizard.tsx` | new | client wizard |
| `packages/i18n/messages/cs.json` | edit | keys below |
| `packages/i18n/messages/en.json` | edit | same keys in English |
| `apps/web/e2e/onboarding.spec.ts` | new | e2e |
| `apps/web/test/onboarding-wizard.test.ts` | new | pure helper test |

No other file may change.

## 4. Steps

1. i18n keys (cs exactly as written; en: your plain English translation). Keep the JSON key order style of the file (append at the end).

| key | cs |
|---|---|
| `onboarding.title` | Nastavíme vaši firmu |
| `onboarding.intro` | Napište své IČO. Jméno a adresu doplníme z registru firem sami. |
| `onboarding.ico.label` | Vaše IČO |
| `onboarding.ico.find` | Najít |
| `onboarding.ico.searching` | Hledáme v registru… |
| `onboarding.ico.invalid` | Tohle IČO nemá správný tvar. Má 8 číslic – zkontrolujte, jestli v něm není překlep. |
| `onboarding.ico.not_found` | Toto IČO v registru firem (ARES) není. Zkontrolujte ho prosím. |
| `onboarding.ico.unavailable` | Registr firem teď neodpovídá. Vyplňte prosím údaje sami, ověříme je později. |
| `onboarding.found.title` | Našli jsme vás |
| `onboarding.found.not_me` | To nejsem já |
| `onboarding.manual.name` | Jméno nebo název firmy |
| `onboarding.manual.street` | Ulice a číslo domu |
| `onboarding.manual.city` | Obec |
| `onboarding.manual.zip` | PSČ |
| `onboarding.vat.question` | Jste plátce DPH? |
| `onboarding.vat.from_registry_payer` | Podle registru jste plátce DPH. Vyberte, jak často podáváte přiznání. |
| `onboarding.vat.neplatce` | Ne |
| `onboarding.vat.platce_monthly` | Ano, měsíčně |
| `onboarding.vat.platce_quarterly` | Ano, čtvrtletně |
| `onboarding.vat.identifikovana_osoba` | Jen identifikovaná osoba |
| `onboarding.regime.question` | Jak si odečítáte výdaje? |
| `onboarding.regime.danova_evidence` | Podle skutečných dokladů (daňová evidence) |
| `onboarding.regime.pausalni_vydaje` | Procentem z příjmů (paušální výdaje) |
| `onboarding.regime.pausalni_dan` | Jedna platba měsíčně (paušální daň) |
| `onboarding.regime.nevim` | Nevím |
| `onboarding.rate.question` | Kolik procent? |
| `onboarding.rate.option` | {rate} % |
| `onboarding.band.question` | Které pásmo? |
| `onboarding.band.option` | {band}. pásmo |
| `onboarding.submit` | Hotovo |
| `onboarding.saving` | Ukládáme… |
| `onboarding.done.title` | Hotovo, firma je nastavená |
| `onboarding.done.address` | Doklady nám posílejte e-mailem na tuto adresu: |
| `onboarding.done.copy` | Zkopírovat adresu |
| `onboarding.done.copied` | Zkopírováno |
| `onboarding.done.continue` | Pokračovat do aplikace |
| `onboarding.error.invalid` | Něco ve formuláři chybí. Zkontrolujte prosím odpovědi. |
| `onboarding.error.pausal_rate_required` | Vyberte, kolik procent výdajů uplatňujete. |
| `onboarding.error.band_required` | Vyberte pásmo paušální daně. |
| `onboarding.error.pausal_dan_payer` | Paušální daň nejde spojit s plátcovstvím DPH. Vyberte jinou možnost. |
| `onboarding.error.unknown` | Uložení se nepovedlo. Zkuste to prosím znovu. |
| `help.ask` | Co je {term}? |
| `help.ico` | IČO je osmimístné číslo, které dostal každý podnikatel při založení živnosti. Najdete ho na živnostenském listu nebo na svých fakturách. |
| `help.vat` | Plátce DPH připočítává k cenám daň a odvádí ji státu. Pokud jste se k DPH nikdy neregistrovali, nejste plátce – vyberte „Ne“. |
| `help.identifikovana_osoba` | Identifikovaná osoba není plátce DPH, ale odvádí DPH z některých služeb ze zahraničí, třeba z reklamy na Facebooku nebo Googlu. Vyberte ji, jen když vám to finanční úřad potvrdil. |
| `help.expenses` | Výdaje si můžete odečíst buď podle skutečných dokladů, nebo procentem z příjmů. Když si nejste jistí, vyberte „Nevím“ – zeptáme se později. |
| `help.pausal_rate` | Procento závisí na druhu živnosti: 80 % řemesla a zemědělství, 60 % ostatní živnosti, 40 % svobodná povolání, 30 % pronájem. Najdete ho v loňském daňovém přiznání. |
| `help.pausal_dan` | Paušální daň je jedna měsíční platba, která zahrnuje daň z příjmů i sociální a zdravotní pojištění. Pásmo závisí na výši příjmů a druhu činnosti. |

Term names for `help.ask` (`{term}`): "IČO", "plátce DPH", "identifikovaná osoba", "odečítání výdajů", "procento výdajů", "paušální daň" — pass them as literal params is not allowed (Czech first): add keys `help.term.ico`, `help.term.vat`, `help.term.identifikovana_osoba`, `help.term.expenses`, `help.term.pausal_rate`, `help.term.pausal_dan` with exactly those six cs strings.
   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -15` → pass.

2. `help-tip.tsx` (`'use client'`): `export function HelpTip({ term, text }: { term: MessageKey; text: MessageKey })` renders a `<button type="button">` showing "?" (min 44×44 px, `rounded-full`, `focusRing`, `aria-expanded`, `aria-controls`, `aria-label={t('help.ask', { term: t(term) })}`) and, when open, a `<p id=… className="text-body">` with `t(text)` right after it. Export also `HelpText` wrapper if useful; keep it under 50 lines.

3. `chips.tsx` (`'use client'`): `ChipQuestion<V extends string>({ name, legend, help, options, value, onChange })` where `options: readonly { value: V; label: string }[]`. Renders `<fieldset>` + `<legend className="text-body font-medium">` (+ the `help` node beside it) and for each option a `<label>` containing a visually hidden radio `<input type="radio" name={name} value=… checked=… onChange=…>` (class `peer sr-only`) and a pill `<span>` styled with tokens: border `border-border`, selected `peer-checked:bg-primary peer-checked:text-primary-foreground`, focus `peer-focus-visible:` ring like `focusRing`, min height 44 px, `text-body`. Chips wrap (`flex flex-wrap gap-2`).

4. `wizard.tsx` (`'use client'`), one page, sections appear as the user goes (no step pages):
   - Export a pure helper `export function regimeOptions(vat: string | null): readonly string[]` → all four `TAX_REGIME_ANSWERS` unless `vat` starts with `platce_`, then without `'pausalni_dan'`. Export `export function normalizeIcoInput(raw: string): string` → digits only (removes spaces), max 8.
   - Section 1: label + `HelpTip(help.term.ico, help.ico)`, `Input` (`inputMode="numeric"`, `autoComplete="off"`, `maxLength={10}`), `Button` "Najít". On click: `normalizeIcoInput`; if `!isValidIco` show `onboarding.ico.invalid` in the status line and do NOT call the server; else call `lookupIco` inside `useTransition` (button shows `onboarding.ico.searching`, `aria-busy`).
   - `found`: a `Card` with `onboarding.found.title`, the name (`text-card-title`) and `addressText`, and a text button `onboarding.found.not_me` that resets everything to section 1. `not_found`: status line message, stay on section 1. `unavailable`: status message and four `Input`s (`onboarding.manual.*`, label above each, `required`); the questions show too.
   - Section 2 (after found or unavailable): `ChipQuestion` vat (`VAT_ANSWERS`, labels `onboarding.vat.*`, help `help.term.vat`/`help.vat`). Preselect `neplatce` when `vatGuess === 'neplatce'`; when `vatGuess === 'platce'` preselect nothing and show `onboarding.vat.from_registry_payer` above the chips. Under the chips a `HelpTip(help.term.identifikovana_osoba, help.identifikovana_osoba)`.
   - Section 3: `ChipQuestion` regime (`regimeOptions(vat)`, labels `onboarding.regime.*`, help expenses). Changing vat to a payer while `pausalni_dan` is selected clears regime.
   - Section 4 (only for `pausalni_vydaje`): chips 80/60/40/30 (`onboarding.rate.option`, help pausal_rate). Only for `pausalni_dan`: chips 1/2/3 (`onboarding.band.option`, help pausal_dan).
   - The `<form action={formAction}>` (from `useActionState(completeOnboarding, { status: 'idle' })`) wraps sections 2–4 and holds hidden inputs for every prefill field (`ico, name, dic, street, houseNumber, orientationNumber, city, zip, fuCode, validFrom, slugBase`); in the manual path the visible inputs carry `name`, `street`, `city`, `zip`, and hidden `ico`, `validFrom` = 1 Jan of this year, `slugBase` empty. For a found subject `street` = `address.street` + (house number and `/orientation` if present) joined with a space, `houseNumber`/`orientationNumber` also sent. Submit `Button` "Hotovo" is disabled until the needed chips are chosen; while pending it shows `onboarding.saving`.
   - `error`: status line with `onboarding.error.<code>`. `done`: replace the whole wizard with `onboarding.done.title`, `onboarding.done.address`, the address in a `Card` (`text-card-title`, `break-all`), a `Button` `onboarding.done.copy` (`navigator.clipboard.writeText`, then label `onboarding.done.copied` for 2 s) and a link styled as primary button `onboarding.done.continue` → `/inbox`.
   - One `role="status" aria-live="polite"` line for all messages (copy `Status` from login-form). Only `text-body`/`text-title`/`text-card-title` sizes; no grey text.

5. `page.tsx` (server): `export const metadata = { title: t('onboarding.title') }`. If `await supabaseMembershipCounter(await createSupabaseServerClient()).countMemberships()` returns a number > 0 → `redirect('/inbox')` (one firm per user). Render `<h1 className="text-title">`, the intro `<p className="text-body">`, then `<OnboardingWizard />`. `layout.tsx` = copy of `(auth)/layout.tsx` with `data-slot="onboarding-header"` and `max-w-xl`.

6. `test/onboarding-wizard.test.ts`: `regimeOptions(null)` has 4 items; `regimeOptions('platce_monthly')` lacks `pausalni_dan`; `regimeOptions('identifikovana_osoba')` has 4; `normalizeIcoInput(' 270 824 40 ')` → `'27082440'`; `normalizeIcoInput('1234567890')` → `'12345678'`. (Import from `../src/onboarding/wizard`; if importing a `'use client'` file with React fails in Vitest, move the two helpers to `apps/web/src/onboarding/wizard-logic.ts`, import them in the wizard, and note it as a deviation.)

7. `e2e/onboarding.spec.ts` (import `{ expect, test }` from `./fixtures`; autoAxe checks every page):
   - `/vitejte` shows the h1 "Nastavíme vaši firmu" and the label "Vaše IČO".
   - typing `12345678` and clicking "Najít" shows the invalid message (role status) and no "Jste plátce DPH?" legend.
   - clicking the button named "Co je IČO?" shows the IČO help text and sets `aria-expanded="true"`; its bounding box is ≥ 44×44.
   Run: `PLAYWRIGHT_BROWSERS_PATH=/tmp/pw pnpm --filter @shoebox/web e2e -- onboarding --project=desktop-chromium --project=mobile-chromium 2>&1 | tail -30` (the setup project runs automatically).

## 5. Do not touch

`apps/web/src/auth/**`, the other `apps/web/e2e/*` files (especially `fixtures.ts`), `playwright.config.ts`, `apps/web/middleware.ts`, `supabase/config.toml`, `packages/ui`. No new dependency. No raw colors (tokens only). No user-facing string outside `packages/i18n`.

## 6. Commands

- `pnpm --filter @shoebox/i18n test 2>&1 | tail -15` → pass.
- `pnpm --filter @shoebox/web test -- onboarding 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors.
- the e2e command in step 7 → 0 failed, 0 skipped.
- `pnpm exec biome ci apps/web packages/i18n 2>&1 | tail -30` → clean.

## 7. Acceptance

- [ ] §6 passes, axe 0 violations (autoAxe).
- [ ] One 375 px screenshot of `/vitejte` after the invalid-IČO step saved to `test-results/` (not committed), path in the report.
- [ ] `git diff --stat` lists only §3 files plus the report.

## 8. Stop and ask

Stop and write the report if: an export from 0062 is missing or named differently; the Chromium shim does not work after one symlink attempt (paste the error); a test fails twice; 25 tool calls or about 50k tokens; a file outside §3 needs a change.

## 9. Report

Write `docs/tasks/0063-report.md` (600 tokens at most) and set `Status: review`.

## Risk list (for the reviewer)

`wizard.tsx` (hidden inputs match `OnboardingInput`, pausal_dan hidden for payers), i18n copy (07 rules 12–14).

## Owner steps

Try it: sign in on the deployed app, you should land on "Nastavíme vaši firmu".
