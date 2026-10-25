# 0038c report: proto:score

Status: review. Steps 1-3 in the first planned run, 4-6 in this one.

## 1. Files changed (steps 4-5, this run)

- `scripts/proto/score.ts` (new): CLI for all golden-v1 documents, compared with labels.json.
- `scripts/proto-score.mjs` (new): Vite SSR runner, same pattern as `scripts/eval.mjs`.
- `package.json`: adds `proto:score` and `proto:serve` after `eval`.
- `.gitignore`: adds `.cache/`.
- Whole branch vs `origin/phase/0`: 32 files, 6452 insertions, 7 deletions (steps 1-3 included).

## 2. Commands

- `pnpm exec tsc -p scripts/proto/tsconfig.json 2>&1 | tail -3`: exit 0, no output.
- `pnpm exec biome ci scripts 2>&1 | tail -3`: `Checked 11 files ... No fixes applied.` (no errors).
- `pnpm --filter @shoebox/testkit exec vitest run test/proto-score.test.ts 2>&1 | tail -6`: `Tests 6 passed (6)`.
- `pnpm proto:score 2>&1 | tail -4` (no key): prints the `GEMINI_API_KEY is not set` message, `ELIFECYCLE Command failed with exit code 2`, exit 2. This is the expected no-key result. No real API call was made.
- `git status --short | grep -c cache`: `0`.
- `pnpm depcruise 2>&1 | tail -2`: `no dependency violations found (262 modules, 533 dependencies cruised)`.
- `python3 scripts/pii_guard.py --all ... | tail -1`: `pii_guard: OK`.
- `pnpm lint 2>&1 | tail -3`: ends with `check:tenant-sql: 114 files, no Drizzle call on a tenant table outside withTenant()`.
- `git diff --stat origin/phase/0 -- pnpm-lock.yaml | tail -1`: `1 file changed, 7 insertions(+)` (0038b only).
- `grep -rn "AQ\.\|AIza" scripts packages/testkit`: no output.
- `git diff --stat origin/phase/0 -- packages/testkit/package.json`: empty.

## 3. Acceptance (section 7)

- [x] proto-score test: 6 passed.
- [x] no-key run prints the message and exits 2. The with-key run (table, cache second run) was not done: no key on this machine.
- [x] `grep -c "proto:" package.json` = 2; `.cache/` line present once; no `.cache` in `git status`.
- [x] tsc exit 0; depcruise clean; testkit `package.json` unchanged.
- [x] no key material in `scripts` or `packages/testkit`.

## 4. Deviations

- None in the code. The brief's `package.json` adds `proto:serve` pointing at `scripts/proto-serve.mjs`, which belongs to 0038d and does not exist yet; added as written.
- Commit hash of step 3 is `bb7abf9` (the brief's `0038c step 3` message matched).

## 5. Questions

- None.

## 6. Owner steps left

- Put `GEMINI_API_KEY` into `.env.local` at the repo root, then run `pnpm proto:score`. Expect a table, a cost line, and on a rerun `18 odpovědí z cache`.
- No PR yet: 0038d opens it.
