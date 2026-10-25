# 0040b: spam/marketing class, prompt v2, Claude prices, Render on Claude

Status: todo
Ticket: PROTO-03 | Depends on: 0040a | Base commit: cba65e2 (rebase on phase/0 after 0040a merges) | Branch: task/0040b-spam-class | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The owner's test set mixes invoices, receipts and spam (newsletters, marketing e-mails, offers). Today the prompt can only answer `other` → `unknown`, so spam can never be scored as caught. Add a `non_document` answer (the 04 class for "newsletters, marketing, photos, signatures"), bump the prompt version so results of v1 and v2 never mix, price Claude correctly in the cost line, and point the Render blueprint at Claude Haiku 5.5 (owner, 2026-10-18: Haiku is the default; Sonnet only to compare).

## 2. Context

- 04 domain model: `non_document` | not bookable | "newsletters, marketing, photos, signatures" | hidden in the "Ostatní" tab.
- M01 rule: an invoice that arrives in a marketing-styled e-mail is still an invoice; the class comes from the document's content, never from how it was sent.
- Claude list prices, USD per 1M tokens (claude-api skill, cached 2026-10-06): `claude-sonnet-5-5` 2.00 in / 10.00 out; `claude-haiku-5-5` 0.10 in / 0.50 out (prompts up to 100K tokens). Gemini stays `gemini-3.8-flash` 0.30 / 2.50 (its existing `TODO(verify)` stays).
- Money is never a float (ADR-007): prices are decimal strings through `Money`.

Anchors (all must be found verbatim, else STOP):

`packages/extraction/src/proto/schema.ts`:
- line 8: `export const PROTO_PROMPT_VERSION = 'm02-proto-v1';`
- lines 42–44: `  'government_filing',` / `  'other',` / `] as const;`
- line 57: `  | 'unknown';`
- line 70: `  other: 'unknown',`
- line 186 ends: `government_filing = podání nebo hlášení úřadu; other = jiné.',`

`scripts/proto/pipeline.ts` lines 27–32 (the price comment and the two `PRICE_USD_PER_MTOK_*` constants; `const USD` and `const MTOK` below them stay) and lines 133–142 (`estimateCostUsd`).

`scripts/proto/score.ts` line 138: `      cost: estimateCostUsd(usage),`

`render.yaml` lines 16–19:

```yaml
      - key: SHOEBOX_LLM_MODEL
        value: gemini-3.8-flash
      - key: GEMINI_API_KEY
        sync: false
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/test/proto-schema.test.ts` | edit | new test |
| `packages/extraction/src/proto/schema.ts` | edit | kind, class, prompt line, version |
| `scripts/proto/pipeline.ts` | edit | price table by model |
| `scripts/proto/score.ts` | edit | pass the model |
| `render.yaml` | edit | Claude env |

No other file may change.

## 4. Steps

1. **Test first.** In `proto-schema.test.ts`, after the test `'maps every kind hint to a class of 04'` (ends line 144 with `  });`), add:

```ts
  it('v2 knows spam and marketing as non_document', () => {
    expect(PROTO_PROMPT_VERSION).toBe('m02-proto-v2');
    expect(documentClassOf('non_document')).toBe('non_document');
    expect(documentClassOf('other')).toBe('unknown');
    expect(PROTO_SYSTEM_PROMPT).toContain('non_document = ');
  });
```

Add `PROTO_PROMPT_VERSION` and `PROTO_SYSTEM_PROMPT` to the file's import from `../src/index` (or wherever `documentClassOf` is imported from) if missing. Run `pnpm --filter @shoebox/extraction test -- proto-schema 2>&1 | tail -30`: the new test fails. Commit `0040b step 1`.

2. **Edit `schema.ts`.**
   - Line 8 → `export const PROTO_PROMPT_VERSION = 'm02-proto-v2';`
   - In `PROTO_KIND_HINTS`, insert `  'non_document',` between `'government_filing',` and `'other',`.
   - In `ProtoDocumentClass`, replace `  | 'unknown';` with `  | 'non_document'` + newline + `  | 'unknown';`.
   - In `KIND_TO_CLASS`, insert `  non_document: 'non_document',` before `  other: 'unknown',`.
   - In the kind_hint prompt line, replace `government_filing = podání nebo hlášení úřadu; other = jiné.',` with `government_filing = podání nebo hlášení úřadu; non_document = není účetní doklad: newsletter, reklama, marketingový e-mail, obchodní nabídka, spam, i když obsahuje ceny; other = jiný doklad, který se do žádné skupiny nevejde. Faktura nebo účtenka zůstává fakturou nebo účtenkou, i když je v marketingově vypadajícím e-mailu.',`

   Run the step 1 command: all pass. Run `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30`: clean. Commit `0040b step 2`.

3. **Edit `pipeline.ts`.** Replace the price comment and the two constants (lines 27–32; keep `const USD` and `const MTOK`) with:

```ts
/**
 * List prices in USD per 1M tokens, by model id (decimal strings, never floats). Claude prices
 * from the claude-api reference (cached 2026-10-06). Gemini: TODO(verify) on ai.google.dev/pricing.
 */
export const PRICES_USD_PER_MTOK: Readonly<Record<string, { input: string; output: string }>> = {
  'claude-sonnet-5-5': { input: '2.00', output: '10.00' },
  'claude-haiku-5-5': { input: '0.10', output: '0.50' },
  'gemini-3.8-flash': { input: '0.30', output: '2.50' },
};
```

Replace `estimateCostUsd` (lines 133–142, keep its doc comment, add `Unknown model = "n/a".`) with:

```ts
export function estimateCostUsd(usage: LlmUsage, model: string): string {
  const price = PRICES_USD_PER_MTOK[model];
  if (price === undefined) return 'n/a';
  const input = Money.parse(price.input, USD).multiply(String(usage.inputTokens)).divide(MTOK);
  const output = Money.parse(price.output, USD).multiply(String(usage.outputTokens)).divide(MTOK);
  return input.add(output).toDecimal().toFixed(4);
}
```

Commit `0040b step 3`.

4. **Edit `score.ts` line 138** → `      cost: estimateCostUsd(usage, env.config.model),`. Run `pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit 2>&1 | tail -30` (expected: no errors) and `pnpm exec biome check scripts/proto 2>&1 | tail -30` (expected: no errors). Commit `0040b step 4`.

5. **Edit `render.yaml`.** Replace the anchor with:

```yaml
      - key: SHOEBOX_LLM_PROVIDER
        value: anthropic
      - key: SHOEBOX_LLM_MODEL
        value: claude-haiku-5-5
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: GEMINI_API_KEY
        sync: false
```

Commit `0040b step 5`.

## 5. Do not touch

`packages/extraction/src/llm/`, `packages/testkit/`, `scripts/proto/serve.ts`, `scripts/proto/page.html`, i18n catalogs (0040d owns page copy). Hard rules 1 and 7.

## 6. Commands

```
pnpm --filter @shoebox/extraction test -- proto-schema 2>&1 | tail -30
pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30
pnpm eval --quick 2>&1 | tail -30
python3 scripts/context_lint.py 2>&1 | tail -30
```

## 7. Acceptance

- [ ] The new test passes; typecheck clean; `pnpm eval --quick` passes.
- [ ] `grep -n "m02-proto-v1" packages/extraction/src` prints nothing.
- [ ] `render.yaml` has `SHOEBOX_LLM_PROVIDER: anthropic` and `ANTHROPIC_API_KEY` with `sync: false`.

## 8. Stop and ask

As in the [template](TEMPLATE.md) §8.

## 9. Report

`docs/tasks/0040b-report.md`, as in the template §9. Set `Status: review`, open one PR to `phase/0`.

## Risk list (for the reviewer)

`scripts/proto/pipeline.ts` (money), `render.yaml` (merging to `phase/0` redeploys Render).

## Owner steps

Before this PR is merged (Render redeploys from `phase/0` on merge):

1. Open console.anthropic.com, sign in, go to **Settings › Billing** and add credits (5 USD covers many full runs of 100 documents on Haiku 5.5).
2. Go to **Settings › API keys**, click **Create key**, name it `shoebox-proto`, copy it.
3. Open dashboard.render.com, click the `shoebox-proto` service, then **Environment**.
4. Click **Add environment variable**: key `ANTHROPIC_API_KEY`, value the copied key. Click **Save changes**.
5. Tell Claude in the thread that the key is in. Never paste the key into the chat.
