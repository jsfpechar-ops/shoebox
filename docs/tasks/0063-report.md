# 0063 report

Status: review

## Files changed

New: `apps/web/app/vitejte/layout.tsx`, `apps/web/app/vitejte/page.tsx`, `apps/web/src/onboarding/help-tip.tsx`, `apps/web/src/onboarding/chips.tsx`, `apps/web/src/onboarding/wizard.tsx`, `apps/web/src/onboarding/wizard-logic.ts`, `apps/web/test/onboarding-wizard.test.ts`, `apps/web/e2e/onboarding.spec.ts`.
Edit: `packages/i18n/messages/cs.json`, `packages/i18n/messages/en.json` (keys appended).
Plus `docs/tasks/0063-onboarding-screen.md` (status line) and this report.

## Commands (last lines)

- `pnpm --filter @shoebox/i18n test`: `Test Files 3 passed (3)`, `Tests 24 passed (24)`.
- `pnpm --filter @shoebox/web test -- onboarding`: `Test Files 14 passed (14)`, `Tests 117 passed (117)`. The `-- onboarding` filter did not narrow the run, so all 14 web test files ran, including `onboarding-wizard.test.ts`.
- `pnpm --filter @shoebox/web typecheck`: no errors.
- `pnpm exec biome ci apps/web packages/i18n`: `Checked 81 files in 3s. No fixes applied.`
- e2e: `pnpm --filter @shoebox/web e2e -- onboarding ...` fails in the `[setup]` project before any test runs: `browserType.launch: Executable doesn't exist at .../scratchpad/pw/chromium_headless_shell-1194/chrome-linux/headless_shell`. The shim (`PLAYWRIGHT_BROWSERS_PATH`, symlinks `chromium-1194` and `chromium_headless_shell-1194` to the `-1243` folders in `/opt/pw-browsers`) did not work after one symlink attempt, so per §8 I stopped.

## §7 acceptance

- [ ] §6 e2e and axe: not run (blocked).
- [ ] 375 px screenshot: not taken (blocked).
- [x] `git diff --stat` lists only §3 files plus the report, plus `wizard-logic.ts` (see Deviations).

## Deviations

1. `wizard-logic.ts` added (§4 step 6 fallback): `apps/web/src/onboarding/wizard.tsx` cannot be imported by Vitest because the Next tsconfig has `jsx: preserve`. `regimeOptions` and `normalizeIcoInput` moved there; the test imports from it.
2. Three keys already existed from brief 0006 and were overwritten in place (value only): `onboarding.ico.label`, `onboarding.vat.question`, `onboarding.regime.question` (cs and en). The old `regime.question` text was "Jak uplatňujete výdaje?". No code used these keys. `onboarding.accountant.question` left untouched.
3. `HelpTip` sets `aria-controls` only while open (avoids a dangling reference).
4. The "?" text is `{'?'}` (Biome `no-jsx-literal-text`).
5. Shim folder is under the scratchpad, not `/tmp/pw` (system path rule).

## Questions

- Can the owner or a session with a working Chromium run the e2e? The installed `/opt/pw-browsers/chromium_headless_shell-1243` does not match Playwright 1.56.1's expected layout (`chromium_headless_shell-1194/chrome-linux/headless_shell`).

## Owner steps left

1. Make Chromium available for Playwright 1.56.1 (run `pnpm exec playwright install chromium` in a normal shell, not in this executor session), then rerun: `pnpm --filter @shoebox/web e2e -- onboarding --project=desktop-chromium --project=mobile-chromium 2>&1 | tail -30`.
2. Check the 375 px screenshot from that run once.

## Orchestrator follow-up (e2e)

The shim needs the 1194 folder names with the old inner layout (`chrome-linux/headless_shell`) pointing at the 1243 files in `/opt/pw-browsers`. With that, `PLAYWRIGHT_BROWSERS_PATH=<shim> pnpm --filter @shoebox/web e2e -- onboarding`: setup + 3 tests × desktop-chromium and mobile-chromium = 7 passed, autoAxe 0 violations. mobile-webkit cannot run here (no WebKit installed). No screenshot taken.
