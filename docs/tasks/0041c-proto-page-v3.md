# 0041c: prototype page v3 (your firm, unreadable class, possible duplicates)

Status: review
Ticket: PROTO-04 (owner, 2026-10-19: Competitor B parity checks, part c of a/b/c) | Depends on: 0041a and 0041b merged | Base commit: head of phase/0 after 0041b | Branch: task/0041c-proto-page-v3 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Wire the v3 checks into the hosted page: the firm's IČO/DIČ comes from two environment variables so the "is this for me?" check runs, the owner can label a document as "Nečitelné", and the review panel warns when two uploaded documents look like the same invoice (same supplier IČO, number and total). Competitor B refuses duplicates and blurry photos, so the test must show Shoebox does too (internal research (not published) §2).

## 2. Context

- Owner decision 2026-10-19: the firm comes from `SHOEBOX_PROTO_ORG_ICO` and `SHOEBOX_PROTO_ORG_DIC` (Render dashboard, `sync: false`); no settings screen, no login. Unset = the buyer check is skipped.
- 0041b exports from `@shoebox/validation`: `type ProtoOrg = { ico: string | null; dic: string | null }`, `parseProtoOrg(ico?: string, dic?: string): ProtoOrg | undefined`, and `ProtoCheckOptions.org?: ProtoOrg`.
- 0041a added the class `unreadable` (the model answers it for a blurry or cut-off document).
- Duplicate notice (M01 semantic key, prototype subset): display only, in the browser, among the documents in this browser. Exact re-uploads are already merged by SHA-256 (`doc_id`), so this catches a second scan or photo of the same invoice. Not exported to the JSONL.
- `tsconfig.base.json` has `exactOptionalPropertyTypes: true`: never pass `org: undefined`; spread it in only when defined (code below).
- Every page string goes through the catalogs and `PAGE_KEYS` (`pageHtml` throws on an unknown key).

Anchors (all must be found verbatim, else STOP):

`scripts/proto/pipeline.ts`:
- line 21: `import { type RenderedProtoCheck, renderProtoChecks, runProtoChecks } from '@shoebox/validation';`
- line 82: `  readonly locale?: Locale;` (inside `ProtoRunInput`)
- lines 113–116: `  const checks = renderProtoChecks(` / `    runProtoChecks(extraction, { today: input.today }),` / `    input.locale ?? 'cs',` / `  );`

`scripts/proto/serve.ts`:
- line 17: `import { AUTH_REALM, isAuthorized, listenAddress } from './auth';`
- line 87: `  'proto.class.unknown',`
- line 120: `  readonly password?: string | undefined;`
- lines 222–224: `          today: pragueDateOf(now()),` / `          locale,` / `        });`
- line 291: `  const server = createProtoServer({ getClient, password: process.env.PROTO_PASSWORD });`

`scripts/proto/page.html`:
- lines 110–112: `  const CLASSES = ['received_invoice', 'received_receipt', 'non_document', 'received_credit_note',` … `    'government_filing', 'unknown'];`
- lines 183–186: the `const runValue = (run, key) => { … };` arrow function
- line 481: `    const usage = document.createElement('p');`

`render.yaml` lines 23–24: `      - key: PROTO_PASSWORD` / `        sync: false`

## 3. Files

| Path | Action | What |
|---|---|---|
| `scripts/proto/pipeline.ts` | edit | `org` on `ProtoRunInput`, passed to the checks |
| `scripts/proto/serve.ts` | edit | `org` option, env, two page keys |
| `scripts/proto/page.html` | edit | class `unreadable`, duplicate notice |
| `packages/i18n/messages/cs.json` | edit | 2 keys |
| `packages/i18n/messages/en.json` | edit | 2 keys |
| `render.yaml` | edit | two env vars |

No other file may change.

## 4. Steps

1. **Catalogs.** In `packages/i18n/messages/cs.json`, after `  "proto.class.unknown": "Jiné",` insert `  "proto.class.unreadable": "Nečitelné (pošlete lepší fotku)",`; after `  "proto.review.preview_none": "Náhled není k dispozici.",` insert `  "proto.review.duplicate": "Možná duplicita: stejný dodavatel, číslo a částka jako {name}.",`. In `en.json`, after `  "proto.class.unknown": "Other",` insert `  "proto.class.unreadable": "Unreadable (send a better photo)",`; after `  "proto.review.preview_none": "No preview available.",` insert `  "proto.review.duplicate": "Possible duplicate: same supplier, number and total as {name}.",`. If a line is the last in its file (no trailing comma), STOP. Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`: pass. Commit `0041c step 1`.

2. **`pipeline.ts`.**
   - Line 21 → `import { type ProtoOrg, type RenderedProtoCheck, renderProtoChecks, runProtoChecks } from '@shoebox/validation';` (Biome may wrap it.)
   - After `  readonly locale?: Locale;` in `ProtoRunInput` insert:
     ```ts
       /** The user's firm for the buyer check (SHOEBOX_PROTO_ORG_*); absent = skipped. */
       readonly org?: ProtoOrg;
     ```
   - Replace `    runProtoChecks(extraction, { today: input.today }),` with:
     ```ts
         runProtoChecks(
           extraction,
           input.org === undefined ? { today: input.today } : { today: input.today, org: input.org },
         ),
     ```
   Run `pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit 2>&1 | tail -30`: clean. Commit `0041c step 2`.

3. **`serve.ts`.**
   - After the line `import { flattenProtoExtraction } from '@shoebox/testkit';` insert `import { parseProtoOrg, type ProtoOrg } from '@shoebox/validation';`
   - In `PAGE_KEYS`, after `  'proto.class.unknown',` insert `  'proto.class.unreadable',` and `  'proto.review.duplicate',`.
   - After `  readonly password?: string | undefined;` in `ProtoServerOptions` insert:
     ```ts
       /** The user's firm for the buyer check; absent = skipped. */
       readonly org?: ProtoOrg;
     ```
   - Replace `          locale,` + `        });` (lines 223–224, the end of the `runProtoDocument` argument) with:
     ```ts
               locale,
               ...(options.org === undefined ? {} : { org: options.org }),
             });
     ```
   - Replace line 291 with:
     ```ts
       const org = parseProtoOrg(process.env.SHOEBOX_PROTO_ORG_ICO, process.env.SHOEBOX_PROTO_ORG_DIC);
       const server = createProtoServer({
         getClient,
         password: process.env.PROTO_PASSWORD,
         ...(org === undefined ? {} : { org }),
       });
     ```
   Run the step 2 tsc command and `pnpm exec biome check scripts/proto 2>&1 | tail -30`: clean (apply Biome's own fixes with `pnpm exec biome check --write scripts/proto` if it only reports formatting or import order). Commit `0041c step 3`.

4. **`page.html`.**
   - In `CLASSES`, insert `'unreadable', ` right after `'non_document', ` (keep the list on its lines; wrap if a line passes 100 characters).
   - After the `runValue` arrow function (its closing `  };`, line 186) insert:
     ```js
       // Possible duplicate (M01 semantic key, prototype subset): same supplier IČO, number and total.
       const dupKey = (run) => {
         const parts = ['supplier_ico', 'document_number', 'total_gross'].map((k) => runValue(run, k));
         return parts.every((p) => p !== '') ? parts.join('|') : '';
       };
       function duplicateOf(docId, run) {
         const key = dupKey(run);
         if (key === '') return null;
         for (const other of docs.values()) {
           if (other.doc_id === docId) continue;
           const otherRun = latestOk(other.doc_id);
           if (otherRun && dupKey(otherRun) === key) return other;
         }
         return null;
       }
     ```
   - Before `    const usage = document.createElement('p');` (line 481, after the loop that renders the checks) insert:
     ```js
         const dupe = duplicateOf(doc.doc_id, run);
         if (dupe) {
           const li = document.createElement('li');
           const sev = document.createElement('span');
           sev.className = 'sev warn';
           sev.textContent = 'warn';
           const msg = document.createElement('span');
           msg.textContent = t('proto.review.duplicate', { name: dupe.name });
           li.append(sev, msg);
           ul.append(li);
         }
     ```
   Check that `t`, `docs`, `latestOk`, `ul`, `doc` and `run` are the names used in `renderReview` (`grep -n "function renderReview" -A8 scripts/proto/page.html`); if not, STOP. Run `node -e "require('fs').readFileSync('scripts/proto/page.html','utf8')" && pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit 2>&1 | tail -30`. Commit `0041c step 4`.

5. **`render.yaml`.** After `      - key: PROTO_PASSWORD` / `        sync: false` append:
   ```yaml
         - key: SHOEBOX_PROTO_ORG_ICO
           sync: false
         - key: SHOEBOX_PROTO_ORG_DIC
           sync: false
   ```
   Commit `0041c step 5`.

6. **Smoke run (no key, no money).** `SHOEBOX_PROTO_ORG_ICO=00006947 timeout 8 pnpm proto:serve > /tmp/serve.log 2>&1 & sleep 5; curl -s localhost:4000/ | grep -c "Nečitelné" ; curl -s localhost:4000/ | grep -c "duplicita"`. Expected: both print 1 or more (the labels JSON). If `PROTO_PASSWORD` is set in `.env.local`, unset it for this command. No upload is made, so no model is called.

## 5. Do not touch

`packages/validation/`, `packages/extraction/`, `packages/testkit/`, `scripts/proto/score.ts`, `scripts/proto/report.ts`, `scripts/proto/auth.ts`. Never put a real IČO, DIČ or key into a file. Hard rules 4, 6 and 7 (the two env vars are the owner-approved setting).

## 6. Commands

```
pnpm --filter @shoebox/i18n test 2>&1 | tail -30
pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit 2>&1 | tail -30
pnpm exec biome check scripts/proto 2>&1 | tail -30
pnpm --filter @shoebox/validation test 2>&1 | tail -30
python3 scripts/context_lint.py 2>&1 | tail -30
```

## 7. Acceptance

- [ ] All §6 commands clean; the smoke run of step 6 prints counts ≥ 1.
- [ ] `grep -n "SHOEBOX_PROTO_ORG" render.yaml scripts/proto/serve.ts` shows both variables in both files.
- [ ] `grep -c "'unreadable'" scripts/proto/page.html` prints 1.

## 8. Stop and ask

As in the [template](TEMPLATE.md) §8.

## 9. Report

`docs/tasks/0041c-report.md`, as in the template §9. Set `Status: review`, open one PR to `phase/0`.

## Risk list (for the reviewer)

`scripts/proto/serve.ts` (env handling), `render.yaml` (merging to `phase/0` redeploys Render), `scripts/proto/page.html` (the duplicate scan reads only data already in the browser).

## Owner steps

Before or right after this PR merges (Render redeploys from `phase/0`):

1. Open dashboard.render.com and click the `shoebox-proto` service, then **Environment**.
2. Click **Add environment variable**: key `SHOEBOX_PROTO_ORG_ICO`, value your company's IČO (8 digits). Add a second one: key `SHOEBOX_PROTO_ORG_DIC`, value your DIČ (`CZ…`), or leave it out if the company has none. Click **Save changes**.
3. Type the IČO only into Render, never into the chat or the repo.

For the 100-document test, include a few of the cases you tried on Competitor B, so the report shows whether Shoebox matches or beats it. Use your own real documents (they stay in your browser) or invented ones:

- an order confirmation and a marketing e-mail with prices;
- the same invoice twice: once as the PDF and once as a phone photo;
- a deliberately blurry photo of a receipt;
- an invoice addressed to a different company;
- a rotated, noisy receipt that says "Platba kartou";
- a 2-page invoice with the totals on page 2;
- an EUR invoice from an EU supplier with reverse charge;
- an invoice with 12 % VAT whose supplier prints no DIČ.
