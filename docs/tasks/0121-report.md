# 0121 report

Status: review

Files changed: `packages/bank/src/pay/` (`bic.ts`, `account.ts`, `spayd.ts`, `checks.ts`, `index.ts`), `packages/bank/src/index.ts` (`export * from './pay/index'`), `packages/bank/test/spayd.test.ts`, `test/pre-payment.test.ts` (verbatim from §4), `packages/bank/package.json` (`zxing-wasm 3.1.5` devDependency), `pnpm-lock.yaml`.

Commands (last lines):
- `pnpm --filter @shoebox/bank exec vitest run test/spayd.test.ts test/pre-payment.test.ts`: `Test Files 2 passed (2)`, `Tests 21 passed (21)` (incl. zxing-wasm QR round-trip; wasm loaded fine).
- `pnpm --filter @shoebox/bank typecheck`: clean.
- `pnpm biome check packages/bank`: `Checked 49 files … No fixes applied`, 0 errors (after auto-fix + manual optional chains in checks.ts).
- `pnpm --filter @shoebox/bank test`: 18 files, 216 tests passed.

Acceptance §7:
- [x] Both test files pass unchanged (assertions verbatim; biome reformatted whitespace only — required for `biome check` to pass).
- [x] `buildSpayd(EXAMPLE)` verifies with `parseQrPayload` from `@shoebox/extraction`: verified via a temporary vitest file (later deleted, no dependency added); `r.ok` true, iban `CZ6508000000192000145399`, bic `GIBACZPX`, amount `480.50`, VS `1234567890`.
- [x] `zxing-wasm` is dev-only in `packages/bank` (devDependencies; not importable from src — dep-cruiser guards this in CI).

Deviations: this session started from a fresh clone of `phase/0` (the previous session's uncommitted pay files were never pushed), so steps 1–3 were re-implemented from the brief and committed as `0121 step 1`–`3` instead of a single handover commit. Local Node is v26 (engines want >=22 <23): pnpm warns, all commands pass. First vitest run failed once on my transcription typo in the BIC test (`GIBACZPP` vs the brief's `GIBACZPX`); fixed to match the brief verbatim, then green. `pnpm install --no-frozen-lockfile` used (fresh clone had no store); lockfile only records the zxing-wasm devDependency.

Left: 0122 wires `buildSpayd` + `prePaymentChecks` into the document page.
