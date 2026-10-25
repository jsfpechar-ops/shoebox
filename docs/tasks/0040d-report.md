# 0040d report: review page

Status: review
Branch: task/0040d-proto-review | Base: origin/phase/0 (4bd52b0, after 0040b and 0040c)

## Files changed
cs.json, en.json (5 messages changed, 32 added), scripts/proto/serve.ts, scripts/proto/page.html (rewrite), .gitignore, this report.

## Commands (last lines)
- `pnpm --filter @shoebox/i18n test`: 3 files, 24 tests passed.
- `pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit`: clean (no output).
- `pnpm exec vitest run --project unit scripts/test/proto-auth.test.ts`: 7 passed.
- `pnpm exec biome check scripts/proto packages/i18n`: clean.
- `grep -c "#[0-9a-fA-F]\{3,6\}" page.html` -> 0; `innerHTML` -> none; `console.log|stdout.write` in serve.ts -> only the start line.

## Acceptance
- [x] i18n test, no raw colors, no innerHTML, no copy in page.html
- [x] serve.ts prints only the start line
- [x] typecheck and biome clean

## Deviations
- Biome lints page.html: one `biome-ignore` for `[hidden] { display: none !important }`.
- "Not sent again" rule: the page learns the current prompt_version and model_requested from the latest server answer (or the latest stored ok run on load), so the very first read in a fresh session is always sent.
- Check messages are shown from memory; after a reload only the check id is shown (messages are not part of the export schema).
- On a 502 the run has `schema_version: ''` (unknown) and latency measured by the server.
- Not exercised in a browser (0040e).

## Questions
None.

## Owner steps left
After 0040e merges and Render redeploys: the "Owner steps" list in the brief.
