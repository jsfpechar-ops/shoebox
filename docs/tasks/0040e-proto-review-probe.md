# 0040e: browser check of the review page (no real key)

Status: todo
Ticket: PROTO-03 | Depends on: 0040d | Base commit: cba65e2 (rebase on phase/0 after 0040d merges) | Branch: task/0040e-proto-review-probe | PR base: phase/0
Executor: Sonnet 5.5 (reason: visual judgement) | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Prove the review page of 0040d works end to end in a real browser before the owner spends money on it: upload, read, label, revise, reload, download, report. Fix what the check finds in `page.html` only.

## 2. Context

- No real API key is available to the executor. The check runs `createProtoServer` (from `scripts/proto/serve.ts`) with a fake `getClient` whose client returns a fixed, valid proto JSON answer with invented values (hard rule 4: no real data).
- Playwright uses the preinstalled Chromium at `/opt/pw-browsers`; never run `playwright install`.
- The exported file must parse with `parseProtoResults` (0040c) and produce a report with `pnpm proto:report`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `scripts/proto/page.html` | edit, only if the check finds a bug | fixes |
| `docs/tasks/0040e-report.md` | create | report |

The probe script and screenshots live in `/tmp` and are never committed. No other file may change.

## 4. Steps

1. **Write `/tmp/probe/serve-fake.mjs`** that starts `createProtoServer({ getClient: () => ({ client: fake, model: 'claude-haiku-5-5', provider: 'anthropic' }) })` on port 4100 through the Vite SSR loader pattern of `scripts/proto-score.mjs` (load `/scripts/proto/serve.ts`). `fake.complete` returns an `LlmResponse` with `stopReason: 'end_turn'`, invented invoice JSON in `json` and `text`, small usage numbers, `latencyMs: 5`. Start it in the background; `curl -s localhost:4100/ | head -5` shows the page.

2. **Write `/tmp/probe/check.mjs`** (Playwright, Chromium `executablePath: '/opt/pw-browsers/chromium'` if the default launch fails) that:
   1. opens the page at 1440 × 900, uploads two PNG files it generates (any 10 × 10 image, different bytes);
   2. waits until both show `status_ready`;
   3. on the first, changes the class to `received_receipt` and one field, saves; checks the second document opens;
   4. opens the first again, changes the note, saves (second label revision);
   5. reloads the page and checks both documents and the label are still there;
   6. clicks **reread** on the second and waits for it to be ready again;
   7. downloads the JSONL to `/tmp/probe/out.jsonl`;
   8. saves screenshots at 1440 × 900 and 375 × 812 to `/tmp/probe/`;
   9. runs axe if `@axe-core/playwright` is already in `node_modules`, else prints `axe skipped`.

3. **Check the export:** `pnpm proto:report /tmp/probe/out.jsonl 2>&1 | head -50`. Expected in the summary: 3 runs, 0 failed runs, 2 documents, 1 labeled, 2 label revisions. Look at both screenshots (Read the PNGs) for overlap, cut-off text and horizontal scroll at 375 px.

4. **Fix** anything the check or screenshots show, in `page.html` only, then rerun steps 2 and 3. One commit per fix: `0040e fix k: <what>`. If a fix needs another file, STOP.

5. **Report** `docs/tasks/0040e-report.md` (template §9): the step 3 summary lines, axe result or skip, what each screenshot shows in words, the fixes. Delete `/tmp/probe`. Set `Status: review`, open one PR to `phase/0`.

## 5. Do not touch

Everything except `scripts/proto/page.html` and the report. Hard rules 4 (no real document, no screenshot file in the repo), 6, 7.

## 6. Commands

```
pnpm proto:report /tmp/probe/out.jsonl 2>&1 | head -50
pnpm --filter @shoebox/i18n test 2>&1 | tail -30
pnpm exec biome check scripts/proto 2>&1 | tail -30
```

## 7. Acceptance

- [ ] The step 3 summary shows 3 runs, 2 documents, 1 labeled, 2 label revisions.
- [ ] After a reload, both documents and the label are still there.
- [ ] No horizontal scroll at 375 px; axe 0 violations, or the skip stated.
- [ ] `git status --short` shows no file outside §3.

## 8. Stop and ask

As in the [template](TEMPLATE.md) §8.

## 9. Report

As in the template §9.

## Risk list (for the reviewer)

`scripts/proto/page.html` if changed.

## Owner steps

The ones in 0040d, once this is merged.
