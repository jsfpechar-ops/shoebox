# 0040d: review page: batch upload, label, download results

Status: todo
Ticket: PROTO-03 | Depends on: 0040b, 0040c | Base commit: cba65e2 (rebase on phase/0 after 0040c merges) | Branch: task/0040d-proto-review | PR base: phase/0
Executor: Sonnet 5.5 (reason: visual judgement) | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

On the Render page the owner drops ~100 real documents at once, the model reads them one by one, and for each one he sees the document next to what the model read, corrects the class (invoice / receipt / spam / …) and any wrong field, and saves. His corrections are the ground truth. Everything is kept as append-only events (`proto-results-v2` from 0040c: one `run` per model reading, one `label` per correction revision), and one button downloads them as JSON Lines for `pnpm proto:report` and for Claude to analyze.

## 2. Context

- Rules: hard rule 4 (the server stays stateless and never logs a request or response body, document text, field values or the model's answer; it keeps no file, result or label); hard rule 6 (every visible string through `packages/i18n`; `page.html` has no copy, only `{{key}}` placeholders and the labels JSON; only `var(--…)` tokens, no raw colors); `textContent` only, never `innerHTML`.
- Storage is the owner's browser (IndexedDB), because Render's free disk is wiped on every restart and the prototype has no database (decisions 2026-10-18 [proto]). Wrap every IndexedDB call in try/catch; if IndexedDB is unavailable, the page still works for one session and shows `proto.review.storage_error`.
- Event shapes are `ProtoRunRecord` and `ProtoLabelRecord` in `packages/testkit/src/proto/results.ts` (0040c). Append-only: a re-read adds a run, a save adds a label revision (`rev` + 1, `supersedes` = the previous `label_id`, `basis_run_id` = the run shown while labeling). Never update or delete an event except through **clear**.
- `doc_id` is the SHA-256 of the file bytes (`crypto.subtle.digest`), lowercase hex. `run_id` comes from the server (`crypto.randomUUID()`); `label_id` and `batch_id` (one per drop or file-picker selection) from the browser (`crypto.randomUUID()`).
- Current files: `scripts/proto/serve.ts` (217 lines: `PAGE_KEYS`, `pageHtml`, `createProtoServer`, `main`), `scripts/proto/page.html` (159 lines, single file upload, read-only result table). `scripts/proto/pipeline.ts` exports `estimateCostUsd(usage, model)` after 0040b. `@shoebox/extraction` exports `PROTO_PROMPT_VERSION`. `ProtoExtraction` has `schema_version` and `issues`.

Anchors in `serve.ts` (verbatim, else STOP):

```ts
  readonly getClient: () => { client: LlmClient; model: string };
```

```ts
        sendJson(response, 200, {
          extraction: result.extraction,
```

```ts
      resolved = { client: createCachingClient(env.client, false), model: env.config.model };
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/i18n/messages/cs.json` | edit | keys below |
| `packages/i18n/messages/en.json` | edit | keys below |
| `scripts/proto/serve.ts` | edit | richer `/api/extract` answer, keys |
| `scripts/proto/page.html` | rewrite | the review page |
| `.gitignore` | edit | ignore exported results |
| `docs/tasks/0040d-report.md` | create | report |

No other file may change.

## 4. Steps

1. **Copy (cs.json and en.json, same keys).** Change the five existing messages marked (change) and add the new ones, keeping the catalogs' key order style (alphabetical inside `proto.`). Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`: passes. Commit `0040d step 1`.

| Key | cs | en |
|---|---|---|
| `proto.page.subtitle` (change) | Nahrajte doklady, i víc najednou. U každého zkontrolujte, co model přečetl, a opravte chyby: vaše opravy jsou správné odpovědi pro vyhodnocení. | Upload documents, several at once if you like. Check what the model read on each one and fix the mistakes: your corrections are the right answers for the evaluation. |
| `proto.page.warning` (change) | Doklady čte model Claude přes Anthropic API; vstupy se nepoužívají k tréninku. Soubory, výsledky a vaše opravy zůstávají jen v tomto prohlížeči, dokud je nestáhnete. | Documents are read by Claude through the Anthropic API; inputs are not used for training. Files, results and your corrections stay in this browser until you download them. |
| `proto.page.usage` (change) | {model}, prompt {prompt}: {input} tokenů na vstupu, {output} na výstupu, {latency} ms, {cost} USD. | {model}, prompt {prompt}: {input} input tokens, {output} output tokens, {latency} ms, {cost} USD. |
| `proto.page.drop` (change) | Přetáhněte sem soubory (PDF, PNG, JPG) nebo | Drop files here (PDF, PNG, JPG) or |
| `proto.page.pick` (change) | vyberte soubory | choose files |
| `proto.review.queue` | Doklady | Documents |
| `proto.review.progress` | Označeno {labeled} z {total} | Labeled {labeled} of {total} |
| `proto.review.status_waiting` | čeká | waiting |
| `proto.review.status_reading` | čtu… | reading… |
| `proto.review.status_ready` | k označení | to label |
| `proto.review.status_labeled` | označeno | labeled |
| `proto.review.status_error` | chyba | error |
| `proto.review.empty_hint` | Prázdné pole znamená, že údaj na dokladu není. | An empty field means the value is not on the document. |
| `proto.review.note` | Poznámka (co je na dokladu zvláštní) | Note (anything unusual about the document) |
| `proto.review.save` | Uložit a další | Save and next |
| `proto.review.reread` | Přečíst znovu | Read again |
| `proto.review.download` | Stáhnout výsledky (.jsonl) | Download results (.jsonl) |
| `proto.review.clear` | Smazat vše z prohlížeče | Delete everything from this browser |
| `proto.review.clear_confirm` | Opravdu smazat všechny soubory, výsledky a opravy z tohoto prohlížeče? | Delete all files, results and corrections from this browser? |
| `proto.review.storage_error` | Prohlížeč nedovolí ukládat data (anonymní okno?). Opravy se po zavření stránky ztratí. | This browser does not allow storing data (private window?). Corrections are lost when the page closes. |
| `proto.review.download_nag` | Máte {count} oprav, které ještě nejsou stažené. Stáhněte si výsledky, ať o ně nepřijdete. | You have {count} corrections not downloaded yet. Download the results so you don't lose them. |
| `proto.review.preview_none` | Náhled není k dispozici. | No preview available. |
| `proto.class.received_invoice` | Faktura | Invoice |
| `proto.class.received_receipt` | Účtenka | Receipt |
| `proto.class.non_document` | Spam / reklama | Spam / marketing |
| `proto.class.received_credit_note` | Dobropis | Credit note |
| `proto.class.received_proforma` | Zálohová faktura | Proforma invoice |
| `proto.class.received_advance_tax_doc` | Daňový doklad k záloze | Advance tax document |
| `proto.class.order_confirmation` | Objednávka | Order confirmation |
| `proto.class.settlement_statement` | Vyúčtování / výpis | Statement |
| `proto.class.government_filing` | Úřední podání | Government filing |
| `proto.class.unknown` | Jiné | Other |

2. **Edit `serve.ts`.**
   - `getClient` returns `{ client: LlmClient; model: string; provider: string }` (anchor 1); `main` fills `provider: env.config.provider` (anchor 3).
   - `POST /api/extract` answers `{ run, checks }`, where `checks` keeps `{id, severity, message}` for display and `run` holds the server's part of a `ProtoRunRecord`: `run_id` (`randomUUID()` from `node:crypto`), `provider`, `model_requested` (`target.model`), `model` (`response.model`), `prompt_version` (`PROTO_PROMPT_VERSION`), `schema_version` (`extraction.schema_version`), `effort: null`, `input_mode` (`'pdf'` for `application/pdf`, else `'image'`), `attempt: 1` (`TODO(proto-eval)`: the adapters do not report retries yet), `ok: true`, `error: null`, `stop_reason` (`response.stopReason`), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` (from `response.usage`), `cost_usd` (`estimateCostUsd(response.usage, target.model)`), `latency_ms`, `extracted_at` (ISO), `parse_issues` (`extraction.issues`), `checks` (`{id, severity}`), `fields` (`flattenProtoExtraction(extraction)` from `@shoebox/testkit`), `raw_response` (`response.text`). Replace anchor 2's object with this shape.
   - On a model failure (today's 502 branch) answer `502 { error, run }` with the same `run` facts that exist, `ok: false`, `error` = the error message (status and provider message only), `fields: []`, tokens 0, `cost_usd: '0.0000'`, `raw_response: null`.
   - The server never prints a body: keep `process.stdout` to the start line only.
   - `PAGE_KEYS`: keep the keys the new page uses (all `proto.page.*` above plus `proto.page.processing`, `error_llm`, `error_type`, `error_size`, `empty`, `checks`, `no_checks`, `fields`, `title`), the 12 field keys `proto.field.<PROTO_RESULT_FIELDS>` plus `proto.field.class`, every new `proto.review.*` and `proto.class.*` key. Drop keys the page no longer uses.
   Run `pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit 2>&1 | tail -30`: clean. Commit `0040d step 2`.

3. **Rewrite `page.html`.** Keep the head, tokens link, labels JSON script and `t()` helper of the current file. Behavior:
   - **Upload:** the drop zone and file input accept many files (`multiple`); each drop or selection gets a new `batch_id`. Each file: hash it (`doc_id`), store `{doc_id, name, type, size, blob}` in store `files` (if not there yet), add it to the queue. Files are read **one at a time** (`POST /api/extract` with the bytes and its content type). A document that already has an `ok` run with the current `prompt_version` and `model_requested` is not sent again.
   - **Run events:** on every answer (200 or 502 with a `run`), add the browser's part and store the full `ProtoRunRecord` in store `runs`: `schema: 'proto-results-v2'`, `kind: 'run'`, `doc_id`, `batch_id`, `file_name`, `media_type`, `size_bytes`, `channel: 'upload'`, `page_count: null`, `has_text_layer: null`, plus every server field.
   - **Stores** (IndexedDB database `shoebox-proto`, version 1): `files` (key `doc_id`), `runs` (key `run_id`, index `doc_id`), `labels` (key `label_id`, index `doc_id`). On load, rebuild the queue from the stores, so a reload or a Render restart loses nothing.
   - **Queue:** a list of documents with name and status (`status_waiting`, `status_reading`, `status_ready`, `status_labeled`, `status_error`), the progress line `proto.review.progress`, and the buttons `download` and `clear` (with `confirm(clear_confirm)`; clearing deletes the three stores). After every 10th label saved since the last download, and before `clear`, show `proto.review.download_nag` with the count. Clicking a document opens it in the review panel; after `save`, the next not-labeled document opens.
   - **Review panel:** the preview (PDF in an `<iframe>` of an object URL, image in an `<img>` with `alt` = file name, else `preview_none`) beside a form for the document's latest `ok` run. The form: a `<select>` for the class with the ten `proto.class.*` options (values = the class ids), then one text `<input>` per field of `PROTO_RESULT_FIELDS` with its `proto.field.*` label, except `not_tax_document`, which is a checkbox (`'true'`/`'false'`). Prefilled from the latest label revision if there is one, else from the run's `fields` (`null` → empty). A field whose value differs from the run's gets a visible marker (border `var(--warning)`) and the model's value as small muted text under it. Then the `empty_hint` line, the `note` textarea, the checks list (severity + message, as today), the usage line (`proto.page.usage` with `cost`, `prompt`) and buttons `save` and `reread` (reread sends the file again whatever the cache rule says, adding a run).
   - **Save:** stores a new `ProtoLabelRecord`: `schema`, `kind: 'label'`, `label_id`, `doc_id`, `rev` (previous + 1, else 1), `supersedes` (previous `label_id` or `null`), `basis_run_id` (the run shown), `labeled_by: 'owner'`, `labeled_at` (ISO), `fields` (13 `{key, value}` with `class` first, `''` for empty), `note`.
   - **Download:** every run, then every label, one JSON line each, in the order stored. File name `shoebox-results-<YYYY-MM-DD>.jsonl`, through a Blob link. Downloading resets the nag counter.
   - **Layout:** one column up to 1023 px (queue, then preview, then form); from 1024 px the queue is a narrow left column and preview and form sit side by side. 16 px side padding, no horizontal scroll at 375 px. Labels are `<label for>`; buttons are `<button>`; the queue items are buttons; focus visible.
   Commit `0040d step 3`.

4. **Edit `.gitignore`:** add the line `shoebox-results-*.jsonl` with the comment `# proto eval exports hold real document values (hard rule 4)` above it. Commit `0040d step 4`.

5. **Report.** Write `docs/tasks/0040d-report.md` (template §9), set `Status: review`, open one PR to `phase/0`. The browser check is 0040e. Commit `0040d step 5`.

## 5. Do not touch

`packages/testkit/**`, `packages/extraction/**`, `scripts/proto/pipeline.ts`, `scripts/proto/score.ts`, `scripts/proto/auth.ts`, `render.yaml`, `apps/**`. Hard rules 4, 6, 7 (no new dependency: plain IndexedDB, no idb library). The probe and screenshots belong to 0040e.

## 6. Commands

```
pnpm --filter @shoebox/i18n test 2>&1 | tail -30
pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit 2>&1 | tail -30
pnpm exec vitest run --project unit scripts/test/proto-auth.test.ts 2>&1 | tail -30
pnpm exec biome check scripts/proto packages/i18n 2>&1 | tail -30
```

## 7. Acceptance

- [ ] i18n test passes; `grep -c "#[0-9a-fA-F]\{3,6\}" scripts/proto/page.html` → `0`; `grep -n "innerHTML" scripts/proto/page.html` → nothing; no Czech or English copy in `page.html`.
- [ ] `grep -n "console.log\|stdout.write" scripts/proto/serve.ts` shows only the start line.
- [ ] scripts typecheck and biome clean.

## 8. Stop and ask

As in the [template](TEMPLATE.md) §8.

## 9. Report

As in the template §9.

## Risk list (for the reviewer)

`scripts/proto/serve.ts` (what leaves the server), `scripts/proto/page.html` (the export format must match 0040c exactly; no `innerHTML`).

## Owner steps

After 0040e is merged and Render has redeployed:

1. Open the Render page and sign in with the prototype password.
2. Drag in a first batch of about 10 documents to check that it works, then the rest.
3. For each document: pick the right type (Faktura, Účtenka, Spam / reklama, …), fix every wrong field, empty a field the document doesn't have, then click **Uložit a další**.
4. Click **Stáhnout výsledky (.jsonl)** whenever the page reminds you, and at the end. Keep the files in one private folder on your computer.
5. Upload the file to this project's thread so Claude can run the report and explain the failures. Never put it in GitHub, an issue, or any other chat: it holds your suppliers' real details.
6. After a prompt or model change, click **Přečíst znovu** (or re-drop the files) and download again; the old and new runs are compared from the same file.
