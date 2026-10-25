# 0038d: `pnpm proto:serve`: one local page (drop a file, see fields and checks), the PR

Status: review
Ticket: PROTO-01 (part d of a/b/c/d) | Depends on: 0038c (same branch) | Base commit: head of task/proto-scanner after 0038c | Branch: task/proto-scanner | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`pnpm proto:serve` starts a plain `node:http` server on `http://localhost:4000` with one screen: drop or pick a PDF/PNG/JPG, the file goes to `POST /api/extract` (kept in memory for that request only), the page shows the extracted fields and the pass/warn/fail checks in Czech. No login, no database, no storage. This brief also opens the single PR for 0038a–d and carries the owner's click-by-click steps (Gemini key, `.env.local`, `proto:score`, `proto:serve`).

## 2. Context

Rules (AGENTS.md, rules.md), pasted:

- Hard rule 4: nothing is written to disk by the server (the upload is a request body; the model answer goes to the gitignored cassette cache like the CLI). Errors returned to the page carry the provider's status/message, never the file. The page shows the free-tier warning (`proto.page.warning`): Google may use free-tier inputs to improve its products, so only anonymized golden-v1 documents go in unless the owner decides otherwise (decisions 2026-10-18 [proto]).
- Hard rule 6: every visible string comes from `packages/i18n` (keys `proto.page.*`, `proto.field.*` added in 0038b). `page.html` holds `{{key}}` placeholders rendered by the server and a JSON of the remaining labels for the browser code; the file itself has no Czech or English copy. The page uses only `packages/ui/src/tokens.css` variables (07 §3: raw colors live there only), served at `/tokens.css`; `TODO(P1-UI)` marks it as a throwaway, the real screen is M11 in `apps/web`.
- Hard rule 7: no new dependency; `scripts/proto-serve.mjs` is the same Vite SSR runner as `proto-score.mjs`.
- Biome lints HTML under `scripts/**` too (a11y rules): headings and the label must have text (hence `{{…}}` placeholders), `lang` must be valid (`cs`, replaced at render time), no `!important`, the JSON script tag must parse (hence `"__LABELS__"` as a JSON string).
- The server resolves the LLM client on the first upload, so the page opens without a key and the browser shows the `proto.cli.no_key` message (503) instead of a crash. Unsupported `content-type` → 415 `proto.page.error_type`; over 20 MB → 413; model/network failure → 502 `proto.page.error_llm`.
- The brief writer ran the server on 2026-10-18: `GET /` 200 (8.5 kB), `GET /tokens.css` 200, `POST` with `text/plain` → 415, `POST` with a golden PDF and no key → 503 with the key message, and with the key → 200 JSON with the Alza invoice fields and 7 checks (5 pass, 2 warn).

All code below was run by the brief writer on `origin/phase/0` plus 0038a+b+c: `tsc -p scripts/proto/tsconfig.json` clean, `biome ci scripts` clean, `pnpm depcruise` clean, `pii_guard` OK.

## 3. Files

| Path | Action | What |
|---|---|---|
| `scripts/proto/serve.ts` | create | the server |
| `scripts/proto/page.html` | create | the page |
| `scripts/proto-serve.mjs` | create | Vite runner |

No other file may change (`package.json` already has `proto:serve` from 0038c).

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1 code: lines 48–255
- Step 2 code: lines 261–421
- Step 3 code: lines 427–462
- Step 4: commands only

Setup: you are on `task/proto-scanner` after 0038c (`git log --oneline -1` shows `0038c step 5` or `0038c step 6`; if not, STOP). `pnpm install` is done.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0038d step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `scripts/proto/serve.ts`

```ts
// `pnpm proto:serve`: one local page at http://localhost:4000 (decisions 2026-10-18 [proto]). No login,
// no database, no storage: the uploaded file lives in memory for one request. Plain node:http.
// GET / is the page, GET /tokens.css the design-system tokens, POST /api/extract the pipeline.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pragueDateOf } from '@shoebox/domain';
import { isProtoMediaType, type LlmClient, LlmKeyMissingError } from '@shoebox/extraction';
import { catalogs, createT, type Locale, type MessageKey } from '@shoebox/i18n';
import {
  createCachingClient,
  loadProtoEnv,
  PROTO_MAX_FILE_BYTES,
  REPO_ROOT,
  runProtoDocument,
} from './pipeline';

export const PROTO_PORT = 4000;

const PAGE_DIR = new URL('.', import.meta.url);
const TOKENS_CSS = join(REPO_ROOT, 'packages', 'ui', 'src', 'tokens.css');

/** Every string the page shows; injected as JSON so the browser code has no literal copy. */
export const PAGE_KEYS: readonly MessageKey[] = [
  'proto.page.title',
  'proto.page.subtitle',
  'proto.page.warning',
  'proto.page.drop',
  'proto.page.pick',
  'proto.page.processing',
  'proto.page.fields',
  'proto.page.checks',
  'proto.page.no_checks',
  'proto.page.usage',
  'proto.page.error_llm',
  'proto.page.yes',
  'proto.page.no',
  'proto.page.empty',
  'proto.field.class',
  'proto.field.supplier_name',
  'proto.field.supplier_ico',
  'proto.field.supplier_dic',
  'proto.field.document_number',
  'proto.field.variable_symbol',
  'proto.field.issue_date',
  'proto.field.duzp',
  'proto.field.due_date',
  'proto.field.currency',
  'proto.field.total_net',
  'proto.field.total_vat',
  'proto.field.total_gross',
  'proto.field.vat_lines',
  'proto.field.account',
  'proto.field.iban',
  'proto.field.not_tax_document',
];

/** page.html with the labels JSON and language filled in. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** page.html with `{{key}}` placeholders rendered, the labels JSON and the language filled in. */
export function pageHtml(locale: Locale): string {
  const labels: Record<string, string> = {};
  for (const key of PAGE_KEYS) labels[key] = catalogs[locale][key];
  const json = JSON.stringify(labels).replace(/</g, '\\u003c');
  return readFileSync(new URL('page.html', PAGE_DIR), 'utf8')
    .replace('<html lang="cs">', `<html lang="${locale}">`)
    .replace(/\{\{([a-z0-9_.]+)\}\}/g, (_match, key: string) => {
      const label = labels[key];
      if (label === undefined) throw new Error(`page.html uses an unknown key ${key}`);
      return escapeHtml(label);
    })
    .replace('"__LABELS__"', json);
}

export interface ProtoServerOptions {
  /** Resolved on the first upload, so the page opens without a key and the error shows there. */
  readonly getClient: () => { client: LlmClient; model: string };
  readonly locale?: Locale;
  readonly now?: () => number;
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function createProtoServer(options: ProtoServerOptions): Server {
  const locale = options.locale ?? 'cs';
  const t = createT(locale);
  const now = options.now ?? Date.now;
  const html = pageHtml(locale);
  return createServer((request, response) => {
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? '/';
    if (request.method === 'GET' && url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    if (request.method === 'GET' && url === '/tokens.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      response.end(readFileSync(TOKENS_CSS, 'utf8'));
      return;
    }
    if (request.method === 'POST' && url === '/api/extract') {
      const mediaType = (request.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
      if (!isProtoMediaType(mediaType)) {
        sendJson(response, 415, { error: t('proto.page.error_type') });
        return;
      }
      const body = await readBody(request, PROTO_MAX_FILE_BYTES);
      if (body === null) {
        sendJson(response, 413, {
          error: t('proto.page.error_size', { mb: PROTO_MAX_FILE_BYTES / (1024 * 1024) }),
        });
        return;
      }
      let target: { client: LlmClient; model: string };
      try {
        target = options.getClient();
      } catch (error) {
        if (error instanceof LlmKeyMissingError) {
          sendJson(response, 503, { error: t('proto.cli.no_key', { keyEnv: error.keyEnv }) });
          return;
        }
        throw error;
      }
      try {
        const result = await runProtoDocument(target.client, {
          model: target.model,
          bytes: body,
          mediaType,
          today: pragueDateOf(now()),
          locale,
        });
        sendJson(response, 200, {
          extraction: result.extraction,
          checks: result.checks.map((check) => ({
            id: check.id,
            severity: check.severity,
            message: check.message,
          })),
          model: result.response.model,
          usage: result.response.usage,
          latencyMs: result.response.latencyMs,
        });
      } catch (error) {
        sendJson(response, 502, {
          error: t('proto.page.error_llm', { detail: (error as Error).message }),
        });
      }
      return;
    }
    sendJson(response, 404, { error: 'not found' });
  }
}

export function main(): Promise<number> {
  let resolved: { client: LlmClient; model: string } | undefined;
  const getClient = (): { client: LlmClient; model: string } => {
    if (resolved === undefined) {
      const env = loadProtoEnv();
      resolved = { client: createCachingClient(env.client, false), model: env.config.model };
    }
    return resolved;
  };
  const server = createProtoServer({ getClient });
  return new Promise((resolve) => {
    server.listen(PROTO_PORT, '127.0.0.1', () => {
      process.stdout.write(`proto page: http://localhost:${PROTO_PORT}\n`);
    });
    const stop = (): void => {
      server.close(() => resolve(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
```

Command: `pnpm exec tsc -p scripts/proto/tsconfig.json 2>&1 | tail -3` → no errors. Commit.

### Step 2: create `scripts/proto/page.html`

```html
<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{proto.page.title}}</title>
<link rel="stylesheet" href="/tokens.css">
<style>
  /* Prototype page: tokens from packages/ui/src/tokens.css only, no raw colors (07 §3).
     TODO(P1-UI): the real screen is M11 in apps/web; this page is throwaway. */
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--background); color: var(--foreground);
    font: 15px/1.5 Inter, system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; display: grid; gap: 16px; }
  h1 { font-size: 22px; margin: 8px 0 0; }
  h2 { font-size: 16px; margin: 0 0 8px; }
  p { margin: 0; }
  .muted { color: var(--muted-foreground); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-card); padding: 16px; }
  .warning { border-color: var(--warning); color: var(--warning); }
  .drop { border: 2px dashed var(--input); border-radius: var(--radius-card); padding: 32px 16px; text-align: center; }
  .drop.over { border-color: var(--primary); background: var(--muted); }
  .drop label { color: var(--link); text-decoration: underline; cursor: pointer; }
  .drop input { display: none; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { width: 40%; font-weight: 500; color: var(--muted-foreground); }
  ul { margin: 0; padding-left: 0; list-style: none; display: grid; gap: 6px; }
  li { display: grid; grid-template-columns: 56px 1fr; gap: 8px; }
  .sev { font-weight: 600; font-size: 12px; text-transform: uppercase; padding-top: 2px; }
  .sev.pass { color: var(--success); }
  .sev.warn { color: var(--warning); }
  .sev.fail { color: var(--destructive); }
  .error { color: var(--destructive); }
</style>
</head>
<body>
<main>
  <h1>{{proto.page.title}}</h1>
  <p class="muted">{{proto.page.subtitle}}</p>
  <p class="card warning">{{proto.page.warning}}</p>
  <div class="card drop" id="drop">
    <span>{{proto.page.drop}}</span>
    <label for="file">{{proto.page.pick}}</label>
    <input id="file" type="file" accept="application/pdf,image/png,image/jpeg">
  </div>
  <p id="status" class="muted" hidden></p>
  <p id="error" class="error" hidden></p>
  <section id="result" class="card" hidden>
    <h2>{{proto.page.fields}}</h2>
    <table><tbody id="fields"></tbody></table>
    <h2 style="margin-top:16px">{{proto.page.checks}}</h2>
    <ul id="checks"></ul>
    <p id="usage" class="muted" style="margin-top:12px"></p>
  </section>
</main>
<script id="labels" type="application/json">"__LABELS__"</script>
<script>
(() => {
  const L = JSON.parse(document.getElementById('labels').textContent);
  const t = (key, params = {}) =>
    (L[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
  const $ = (id) => document.getElementById(id);
  const drop = $('drop');
  const show = (el, text) => { el.textContent = text; el.hidden = false; };
  const empty = t('proto.page.empty');
  const yesNo = (v) => t(v ? 'proto.page.yes' : 'proto.page.no');
  const text = (v) => (v === null || v === undefined || v === '' ? empty : String(v));

  function row(tbody, labelKey, value) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    const td = document.createElement('td');
    th.textContent = t(labelKey);
    td.textContent = text(value);
    tr.append(th, td);
    tbody.append(tr);
  }

  function render(data) {
    const x = data.extraction;
    const tbody = $('fields');
    tbody.replaceChildren();
    row(tbody, 'proto.field.class', x.document_class);
    row(tbody, 'proto.field.supplier_name', x.supplier.name);
    row(tbody, 'proto.field.supplier_ico', x.supplier.ico);
    row(tbody, 'proto.field.supplier_dic', x.supplier.dic || x.supplier.vat_id);
    row(tbody, 'proto.field.document_number', x.document.number);
    row(tbody, 'proto.field.variable_symbol', x.document.variable_symbol);
    row(tbody, 'proto.field.issue_date', x.dates.issue_date);
    row(tbody, 'proto.field.duzp', x.dates.duzp);
    row(tbody, 'proto.field.due_date', x.dates.due_date);
    row(tbody, 'proto.field.currency', x.currency);
    row(tbody, 'proto.field.total_net', x.totals.net);
    row(tbody, 'proto.field.total_vat', x.totals.vat);
    row(tbody, 'proto.field.total_gross', x.totals.gross);
    row(tbody, 'proto.field.vat_lines',
      x.vat_recap.map((r) => `${r.rate_pct} %: ${r.base} + ${r.vat}`).join('; '));
    row(tbody, 'proto.field.account',
      x.payment.account_number ? `${x.payment.account_number}/${x.payment.bank_code || ''}` : null);
    row(tbody, 'proto.field.iban', x.payment.iban);
    row(tbody, 'proto.field.not_tax_document', yesNo(x.not_tax_document));
    const ul = $('checks');
    ul.replaceChildren();
    if (data.checks.length === 0) {
      const li = document.createElement('li');
      li.textContent = t('proto.page.no_checks');
      ul.append(li);
    }
    for (const c of data.checks) {
      const li = document.createElement('li');
      const sev = document.createElement('span');
      sev.className = `sev ${c.severity}`;
      sev.textContent = c.severity;
      const msg = document.createElement('span');
      msg.textContent = c.message;
      li.append(sev, msg);
      ul.append(li);
    }
    $('usage').textContent = t('proto.page.usage', {
      model: data.model, input: data.usage.inputTokens, output: data.usage.outputTokens,
      latency: data.latencyMs,
    });
    $('result').hidden = false;
  }

  async function send(file) {
    if (!file) return;
    $('error').hidden = true;
    $('result').hidden = true;
    show($('status'), t('proto.page.processing'));
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      const data = await res.json();
      $('status').hidden = true;
      if (!res.ok) { show($('error'), data.error || res.statusText); return; }
      render(data);
    } catch (err) {
      $('status').hidden = true;
      show($('error'), t('proto.page.error_llm', { detail: String(err) }));
    }
  }

  $('file').addEventListener('change', (e) => send(e.target.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    send(e.dataTransfer.files[0]);
  });
})();
</script>
</body>
</html>
```

Command: `pnpm exec biome ci scripts 2>&1 | tail -3` → `No fixes applied`, no errors. Commit.

### Step 3: create `scripts/proto-serve.mjs`, run the server

```js
// `pnpm proto:serve`: runs scripts/proto/serve.ts through Vite's SSR module loader (like eval.mjs).
// `@shoebox/*` is aliased to the package sources because scripts/ is not a workspace package.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: [
      {
        find: /^@shoebox\/(domain|extraction|i18n|testkit|validation)$/,
        replacement: `${root}packages/$1/src/index.ts`,
      },
    ],
  },
  ssr: { noExternal: [/^@shoebox\//] },
});
try {
  const page = await server.ssrLoadModule('/scripts/proto/serve.ts');
  process.exitCode = await page.main();
} finally {
  await server.close();
}
```

Command (one shell line; it starts the server, probes it, stops it):

```
(node scripts/proto-serve.mjs > /tmp/proto-serve.log 2>&1 &); sleep 10; tail -1 /tmp/proto-serve.log; curl -s -o /dev/null -w 'GET / %{http_code}\n' http://localhost:4000/; curl -s http://localhost:4000/ | grep -o '<h1>[^<]*</h1>'; curl -s -o /dev/null -w 'tokens.css %{http_code}\n' http://localhost:4000/tokens.css; curl -s -w ' %{http_code}\n' -X POST -H 'content-type: text/plain' --data 'x' http://localhost:4000/api/extract; curl -s -w ' %{http_code}\n' -X POST -H 'content-type: application/pdf' --data-binary '@testdata/golden-v1/docs/4021738955.pdf' http://localhost:4000/api/extract | cut -c1-120; pkill -f proto-serve.mjs; echo stopped
```

Expected: `proto page: http://localhost:4000`, `GET / 200`, `<h1>Shoebox – prototyp čtení dokladů</h1>`, `tokens.css 200`, `{"error":"Nepodporovaný typ souboru. Nahrajte PDF, PNG nebo JPG."} 415`, then either `{"error":"Chybí GEMINI_API_KEY. …` ` 503` (no key on this machine) or `{"extraction":{"schema_version":"m02-proto-v1","kind_hint":"invoice",…` ` 200` (key present), and `stopped`. The shell may report exit 144 from `pkill`; that is fine. Commit.

### Step 4: repo guards, report, PR

Command: `pnpm exec biome ci scripts 2>&1 | tail -2` → no errors; `pnpm depcruise 2>&1 | tail -2` → `no dependency violations found`; `python3 scripts/pii_guard.py --all scripts/proto/serve.ts scripts/proto/page.html scripts/proto-serve.mjs 2>&1 | tail -1` → `pii_guard: OK`; `python3 scripts/context_lint.py 2>&1 | tail -1` → `context lint: OK`; `git diff --stat origin/phase/0 | tail -1` → 28 files changed (0038a–d together). Nothing to commit. Write the report (§9), push (`git push origin task/proto-scanner 2>&1 | tail -3`) and open **one** PR for 0038a–d against `phase/0` titled `PROTO-01: scanner prototype, page + score (0038a-d)` with the four reports linked and this paragraph in the body: "Prototype only (decisions 2026-10-18 [proto]): Gemini free tier, anonymized golden-v1 documents only. No login, DB or storage. Claude stays the production target behind `SHOEBOX_LLM_PROVIDER`."

## 5. Do not touch

`package.json` (done in 0038c), `packages/**` (0038a–c are done), `scripts/proto/pipeline.ts`, `scripts/proto/score.ts`, `scripts/proto-score.mjs`, `packages/ui/src/tokens.css` (read by the server, never edited), `apps/**`, `.env*`, `docs/v3/**`, `.github/**`. Hard rules 4, 6, 7, 8. No raw color in `page.html` (only `var(--…)`), no Czech or English copy in it (only `{{proto.…}}` and label keys).

## 6. Commands

```
pnpm exec tsc -p scripts/proto/tsconfig.json 2>&1 | tail -30     # exit 0
pnpm exec biome ci scripts 2>&1 | tail -30                       # No fixes applied, no errors
pnpm depcruise 2>&1 | tail -3                                    # no dependency violations found
python3 scripts/pii_guard.py --all scripts/proto/serve.ts scripts/proto/page.html scripts/proto-serve.mjs 2>&1 | tail -3   # pii_guard: OK
python3 scripts/context_lint.py 2>&1 | tail -30                  # context lint: OK
```
Plus the one-line server probe in step 3.

## 7. Acceptance

- [ ] Step 3 probe: `GET / 200` with the Czech `<h1>`, `tokens.css 200`, `text/plain` → 415 with the Czech message, PDF → 503 key message or 200 JSON.
- [ ] `grep -c "{{proto\." scripts/proto/page.html` → `8`; `grep -c "#[0-9a-fA-F]\{3,6\}" scripts/proto/page.html` → `0` (no raw color); `grep -n "data-i18n\|Nahrajte\|Upload" scripts/proto/page.html` → no output (no copy in the file).
- [ ] `pnpm exec biome ci scripts` clean (HTML a11y rules included); `pnpm exec tsc -p scripts/proto/tsconfig.json` exit 0.
- [ ] `git diff --stat origin/phase/0 -- package.json pnpm-lock.yaml` → `package.json | 2 +` and `pnpm-lock.yaml | 7 +` only.
- [ ] One PR against `phase/0` with the four report links.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- the server probe fails twice (read `/tmp/proto-serve.log` once, fix once);
- port 4000 is busy (`EADDRINUSE` in the log): report it, do not change the port;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0038d-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left (copy the list below).

## Risk list (for the reviewer)

`serve.ts`: routes (`GET /`, `GET /tokens.css`, `POST /api/extract`, else 404), `content-type` checked against `isProtoMediaType` before reading the body, 20 MB cap with `request.destroy()`, the client resolved lazily so a missing key is a 503 with the i18n message, `{{key}}` placeholders HTML-escaped and limited to `PAGE_KEYS` (unknown key throws at start), labels JSON escapes `<`, `today` from `pragueDateOf(Date.now())` for the date checks, bound to `127.0.0.1`. `page.html`: no literal copy, tokens only, `textContent` everywhere (no `innerHTML`), the browser does `{param}` substitution for the two parameterized labels (`proto.page.usage`, `proto.page.error_llm`), the raw ICU text is safe because those messages have no plural or select. Free-tier privacy warning is on the page. The server has no unit test (the executor's curl probe is the check); the pipeline underneath is tested in 0038a–c.

## Owner steps

1. Open https://aistudio.google.com/ in your browser and sign in with your Google account.
2. In the left menu click **Get API key** (or open https://aistudio.google.com/app/apikey).
3. Click **Create API key**, pick or create a Google Cloud project when asked, and copy the key that appears (it starts with `AIza` or `AQ.`). Keep it to yourself: it is a secret.
4. In the repo root create a file named `.env.local` (next to `package.json`; it is gitignored) with one line: `GEMINI_API_KEY=<paste the key here>`. Optional second line: `SHOEBOX_LLM_MODEL=gemini-3.8-flash` (that is the default).
5. In a terminal at the repo root run `pnpm install --frozen-lockfile` once, then `pnpm proto:score`. The first run calls Gemini for the 18 golden documents one by one (about ten minutes on the free tier) and prints the accuracy table; run it again and it finishes in seconds from the cache. `pnpm proto:score --fresh` calls the model again.
6. Run `pnpm proto:serve`, open http://localhost:4000 in the browser, drop one file from `testdata/golden-v1/docs/` onto the page, and read the fields and checks. Stop the server with Ctrl+C.
7. Privacy: the free tier lets Google use what you send to improve its products. Until you decide otherwise, drop only the anonymized `testdata/golden-v1/docs/` files on the page, never a real invoice or receipt. If you want to test real documents, say so and the orchestrator will record the decision (paid tier or the Claude adapter).
8. If the page says `Chybí GEMINI_API_KEY`, the `.env.local` line is missing or misspelled; if a document shows `gemini: HTTP 429`, wait a minute (free-tier limit) and drop it again.
