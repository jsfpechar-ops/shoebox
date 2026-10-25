# 0064 report: onboarding as reference-app-style steps

Status: review

## Files changed

apps/web/src/onboarding/wizard-logic.ts, wizard.tsx, chips.tsx; packages/i18n/messages/en.json, cs.json; apps/web/test/onboarding-wizard.test.ts; apps/web/e2e/onboarding.spec.ts; this report; the brief's Status line.

## Commands (last lines)

- `pnpm --filter @shoebox/i18n test`: 3 files, 24 tests passed.
- `pnpm --filter @shoebox/web test`: 14 files, 121 tests passed.
- `pnpm --filter @shoebox/web typecheck`: clean (after fixing one `WizardStep | undefined` index type in `back()`).
- `pnpm exec biome ci apps/web packages/i18n`: 81 files, no errors (after formatting the changed files and fixing two literal-text and one hook-deps finding).
- e2e `PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/pwshim pnpm --filter @shoebox/web e2e -- onboarding`: 7 passed; 3 failed, all `[mobile-webkit]` with "Executable doesn't exist" (WebKit not installed, expected per brief). Desktop and mobile Chromium all pass; no skipped tests reported.

## Acceptance (section 7)

- [x] §6 passes on Chromium projects; autoAxe in the e2e fixtures passed.
- [x] Screenshot produced by the e2e test (`onboarding-375.png`, written under the test output folder). Not opened by me, see Deviations.
- [x] Changed files are the §3 list plus the report and the brief's Status line.

## Deviations

- `autoFocus` not used on the IČO input (Biome a11y); the input is focused from a ref on mount instead.
- Focus effect on step change has a `biome-ignore useExhaustiveDependencies` comment.
- `ChipQuestion` gained a `hideLegend` prop (legend kept for screen readers, question shown as the page h2) and `layout` prop as specified.
- Hidden inputs: the radio group for the current screen is rendered; answers from other screens are sent as hidden inputs, and the manual address fields are hidden after the IČO screen.
- Enter on the IČO screen is handled by the form's onSubmit (lookup or continue) and never posts the wizard.
- Biome formatter was run on the changed §3 files to pass `biome ci`.
- Screenshot not viewed (one-look rule) because of the tool-call budget.

## Questions

None.

## Owner steps left

None. Merge is by the orchestrator/owner as usual; nothing pushed.
