# 0038d report: `pnpm proto:serve`

Status: review
Branch: task/proto-scanner (no PR opened; the orchestrator opens it)

## 1. Files changed (this brief)

- `scripts/proto/serve.ts` (new, 206 lines)
- `scripts/proto/page.html` (new, 159 lines)
- `scripts/proto-serve.mjs` (new, 28 lines)
- `docs/tasks/0038d-proto-serve.md` (Status line only: todo to review)
- `docs/tasks/0038d-report.md` (this file)

`git diff --stat origin/phase/0`: 36 files, 6892 insertions, 7 deletions (covers 0038a to d together; the brief's "28 files" count did not match).

## 2. Commands and results

- `pnpm install --frozen-lockfile`: `Done in 2.3s using pnpm v10.28.0`
- `pnpm exec tsc -p scripts/proto/tsconfig.json`: no output (exit 0)
- `pnpm exec biome ci scripts`: `Checked 14 files ... No fixes applied.`
- `pnpm depcruise`: `no dependency violations found (262 modules, 533 dependencies cruised)`
- `python3 scripts/pii_guard.py --all ...`: `pii_guard: OK`
- `python3 scripts/context_lint.py`: `context lint: OK`
- Server probe (`node scripts/proto-serve.mjs`, port 4000):
  - `proto page: http://localhost:4000`
  - `GET /` 200, `<h1>Shoebox – prototyp čtení dokladů</h1>`
  - `GET /tokens.css` 200
  - `POST` text/plain: `{"error":"Nepodporovaný typ souboru. Nahrajte PDF, PNG nebo JPG."}` 415
  - `POST` PDF (golden-v1 4021738955): `{"error":"Chybí GEMINI_API_KEY. ...` (no-key message; the trailing status code was cut off by my `cut -c1-120`, so the 503 is not separately confirmed)
  - After stop, `GET /` returns 000 (server down). The shell reported exit 144 from `pkill`, as the brief expects.

## 3. Section 7 acceptance

- [x] Probe: GET / 200 with Czech h1, tokens.css 200, 415 Czech message, PDF gives the key message
- [ ] grep checks for `{{proto.` count, raw colors, copy strings: not run (out of tool budget)
- [x] biome ci clean; tsc exit 0
- [ ] `git diff --stat origin/phase/0 -- package.json pnpm-lock.yaml`: not run; the full stat above shows package.json 2 lines and pnpm-lock.yaml 7 lines
- [ ] One PR against phase/0: not opened (per executor instructions; orchestrator opens it)

## 4. Deviations

- Probe log written to the scratchpad directory, not `/tmp` (per the session rules).
- Commit messages carry the Co-Authored-By and Claude-Session trailers.
- Step 1 had a tsc command, step 2 a biome command, step 3 the probe; all run as the brief says.

## 5. Questions

None.

## 6. Owner steps left

1. Add the Gemini key to `.env.local` in the repo root as `GEMINI_API_KEY=...` (never commit it).
2. Run `pnpm proto:score` to score the golden set.
3. Run `pnpm proto:serve` and open http://localhost:4000 in the browser.
4. Review and merge the 0038a to d PR into `phase/0` (the orchestrator opens it).
