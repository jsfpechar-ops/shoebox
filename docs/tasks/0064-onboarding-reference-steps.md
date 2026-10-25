# 0064: Onboarding as reference-app-style steps

Status: review
Ticket: P1-ONB-01 (onboarding from IČO) | Depends on: 0063 | Base commit: branch head | Branch: claude/project-thread-e840r7 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Owner 2026-10-25: "take inspiration from the reference app, it needs to be dumb-proof easy". Turn the one-page wizard of 0063 into the the reference app setup-wizard pattern: one question per screen, a progress bar, the IČO looked up by itself as soon as 8 digits are typed, chip answers that move on by themselves, a Back button, and a celebration screen at the end.

## 2. Context

- The reference app pattern (from its `setup_wizard/_layout.html`, Jinja, not portable code): a head with a segmented progress bar (`<ol aria-hidden>` of equal segments, 6 px high, fully rounded; done = success color, current = primary, rest = border color) and the text "Step n of N"; a body with ONE big question as `h2` and a one-line "why" sentence under it; a foot with a quiet Back button on the left and the primary button on the right; the final screen is a success banner with a ✓ mark, short text and one primary button.
- Current code (0063, read these first): `apps/web/src/onboarding/wizard.tsx` (`OnboardingWizard`, `DoneView`, `streetLine`, hidden inputs, `useActionState(completeOnboarding)`), `wizard-logic.ts` (`regimeOptions`, `normalizeIcoInput`), `chips.tsx` (`ChipQuestion`), `help-tip.tsx` (`HelpTip`). Keep the server actions, the hidden-input contract and the HelpTip/ChipQuestion components; only the flow and layout change.
- i18n: until brief 0050 (English default) merges, every new key must be in both `cs.json` and `en.json`. Owner wants English for now: write real English in `en.json`; in `cs.json` write Czech where you can do it in plain words, else copy the English. Existing `onboarding.*` keys stay.
- Design: tokens only, body size text, 44 px targets, chips are radio inputs in a `fieldset` + `legend` (07 §8, rules 11–14).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/onboarding/wizard-logic.ts` | edit | step logic |
| `apps/web/src/onboarding/wizard.tsx` | edit | step UI |
| `apps/web/src/onboarding/chips.tsx` | edit | full-width option cards variant |
| `packages/i18n/messages/en.json`, `cs.json` | edit | new keys |
| `apps/web/test/onboarding-wizard.test.ts` | edit | step tests |
| `apps/web/e2e/onboarding.spec.ts` | edit | follow the new flow |

No other file may change.

## 4. Steps

1. `wizard-logic.ts`: add
```ts
export type WizardStep = 'ico' | 'vat' | 'regime' | 'detail';
/** Steps the user will see, in order: detail only for pausalni_vydaje / pausalni_dan. */
export function stepsFor(regime: string): readonly WizardStep[];
/** True when this answer is the last one needed, so the screen shows "Finish" instead of moving on. */
export function isLastStep(step: WizardStep, regime: string): boolean;
```
   `stepsFor('')` and `stepsFor('danova_evidence')` and `stepsFor('nevim')` → `['ico','vat','regime']`; `stepsFor('pausalni_vydaje')` / `('pausalni_dan')` → 4 steps. `isLastStep('regime','nevim')` true, `isLastStep('regime','pausalni_vydaje')` false, `isLastStep('detail', any)` true.

2. `chips.tsx`: add an optional prop `layout?: 'pills' | 'cards'` (default `'pills'`). `'cards'` renders each option as a full-width block (`grid gap-3`, min height 56 px, padding 16 px, `rounded-card`, border, `text-body`, selected = primary border + light fill using tokens, a ✓ at the right when selected). Keep the radio inputs.

3. `wizard.tsx`, rebuild the layout (keep `DoneView` logic, restyle it):
   - State `step: WizardStep`. Frame: progress bar (segments = `stepsFor(regime).length`, aria-hidden) + visible text `onboarding.step.count` ("Step {n} of {total}"); `h2` question (`text-title`) with its HelpTip beside it; one "why" line (`text-body`); the content; a foot with Back (`variant` quiet/ghost, hidden on the first step) left and the primary button right (only when the step needs one).
   - **ico**: question `onboarding.q.ico` ("What is your IČO?") + HelpTip ico; why `onboarding.why.ico` ("We'll fill in your name and address from the business register."). Big `Input` (`inputMode="numeric"`, `autoFocus`, label `onboarding.ico.label` above it). On change: `normalizeIcoInput`; when it reaches 8 digits run the check: invalid → status `onboarding.ico.invalid`; valid → `lookupIco` automatically (no click). Enter key does the same. Keep a `Find` button only as a secondary fallback (`onboarding.ico.find`). Found → a `Card` "Is this you?" (`onboarding.found.question`) with name (`text-card-title`) and address, primary `onboarding.found.yes` ("Yes, that's me") → step `vat`; quiet `onboarding.found.not_me` clears. Not found → status message. Unavailable → status message + the 4 manual inputs + primary `onboarding.next` ("Continue", enabled when all filled) → `vat`.
   - **vat**: question `onboarding.vat.question` + HelpTip vat; why `onboarding.why.vat`; the ARES payer note when `vatGuess === 'platce'`; `ChipQuestion layout="cards"` with the 4 VAT answers; tapping one sets it and goes to `regime` after 250 ms (so the ✓ is seen). If `vatGuess === 'neplatce'`, preselect "Ne" and also show primary `onboarding.next`.
   - **regime**: question `onboarding.regime.question` + HelpTip expenses; why `onboarding.why.regime`; cards from `regimeOptions(vat)`; tap → if `isLastStep` stay and show primary `onboarding.finish` ("Finish") which submits the form; else go to `detail` after 250 ms.
   - **detail**: rate cards (80/60/40/30) or band cards (1/2/3) with their HelpTip; tap selects; primary `onboarding.finish` submits.
   - The `<form action={formAction}>` wraps the whole frame from step `vat` on, holding all hidden inputs and the chosen answers as hidden inputs too (`vat`, `regime`, `pausalRate`, `pausalDanBand`), so going Back never loses data and submit sends everything. While pending, the Finish button shows `onboarding.saving`. Errors: status line with `onboarding.error.<code>`.
   - Done: success banner (✓ mark in a success-colored circle, `onboarding.done.title`, `onboarding.done.text` "From now on just e-mail your receipts and invoices here, we do the rest."), the address card with the copy button, primary link `onboarding.done.continue`. Move focus to the banner heading on arrival.
   - Move focus to the new step's `h2` (tabIndex -1) on every step change; the status line stays `aria-live="polite"`.

4. i18n new keys (en text below; cs per §2): `onboarding.step.count` "Step {n} of {total}", `onboarding.q.ico` "What is your IČO?", `onboarding.why.ico` (above), `onboarding.why.vat` "This decides which tax reports we prepare for you.", `onboarding.why.regime` "This decides how we count your costs. You can change it later.", `onboarding.found.question` "Is this you?", `onboarding.found.yes` "Yes, that's me", `onboarding.next` "Continue", `onboarding.finish` "Finish", `onboarding.back` "Back", `onboarding.done.text` (above). Also set the `en.json` text of the existing `onboarding.found.not_me` to "No, change the IČO".

5. Unit test: add the `stepsFor`/`isLastStep` cases from step 1.

6. e2e (Czech is still the default locale until 0050 merges; take texts from `cs.json` exactly): keep the three tests but adapt them: typing `12345678` (no click) shows the invalid message; the "Co je IČO?" help still opens; the counter text "1" and the IČO question are visible. Do not depend on ARES.

## 5. Do not touch

`actions.ts`, `schema.ts`, `prefill.ts`, `gate.ts`, `help-tip.tsx`, `apps/web/src/auth/**`, other e2e files, `packages/ui`. No new dependency, no raw colors.

## 6. Commands

- `pnpm --filter @shoebox/i18n test 2>&1 | tail -15`
- `pnpm --filter @shoebox/web test 2>&1 | tail -15`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm exec biome ci apps/web packages/i18n 2>&1 | tail -30`
- e2e: `PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/pwshim pnpm --filter @shoebox/web e2e -- onboarding 2>&1 | tail -30` (the shim already exists; desktop-chromium and mobile-chromium must pass; mobile-webkit fails only because WebKit is not installed, ignore it).

## 7. Acceptance

- [ ] §6 passes (Chromium projects), autoAxe 0 violations.
- [ ] Screenshot `onboarding-375.png` still produced by the e2e.
- [ ] `git diff --stat` lists only §3 files plus the report.

## 8. Stop and ask

Stop and write the report if: an excerpt is not found; a test fails twice; 25 tool calls or about 50k tokens; a file outside §3 needs a change.

## 9. Report

Write `docs/tasks/0064-report.md` (600 tokens at most), set `Status: review`, commit `git add <paths> && git commit -m "0064: onboarding as reference-app-style steps"`. Do not push.

## Risk list (for the reviewer)

`wizard.tsx`: hidden inputs still match `OnboardingInput`; Back keeps answers; paušální daň hidden for payers.

## Owner steps

None.
