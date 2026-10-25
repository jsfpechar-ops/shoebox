# 0041a: prototype reading v3 (buyer, payment method, paid stamp, unreadable)

Status: review
Ticket: PROTO-04 (owner, 2026-10-19: Competitor B parity checks, part a of a/b/c) | Depends on: none | Base commit: d7e1850 (head of phase/0) | Branch: task/0041a-proto-schema-v3 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The prototype reads no buyer, no payment method and no "already paid" stamp, and a blurry photo can only come back as a bad reading. Add those three fields and an `unreadable` answer, and tell the model never to guess a VAT rate, so the checks of 0041b can say "this invoice is for another firm", "paid by card" and "send a sharper photo" the way the competitor Competitor B does (internal research (not published) §2).

## 2. Context

- Prompt rule (M02): copy only what is printed, never derive. A missing VAT rate must stay missing: the competitor's bug was a silent net × 1,21 (internal research (not published) §2).
- 04 classes: the prototype adds `unreadable` (not bookable; the user is asked for a better photo). It is a prototype-only class; production M01 handles it as a failed reading.
- A new prompt version keeps v2 and v3 results apart in the JSONL (`prompt_version`).
- Wire conventions (M02 §4.5.4): `""` = not printed; the schema has no nullable types; `required` lists every property **in the same order** as `properties` (a test checks this).

Anchors in `packages/extraction/src/proto/schema.ts` (all must be found verbatim, else STOP):

- line 8: `export const PROTO_PROMPT_VERSION = 'm02-proto-v2';`
- lines 43–44: `  'non_document',` / `  'other',`
- line 58: `  | 'non_document'`
- line 73: `  other: 'unknown',`
- lines 76–78: the function `documentClassOf`
- lines 104–105: `      required: ['name', 'ico', 'dic', 'vat_id', 'country'],` / `    },`
- line 144: `        iban: S,`
- line 146: `      required: ['account_number', 'bank_code', 'iban'],`
- lines 159–164: the `reverse_charge_text` property and `      required: ['not_tax_document_text', 'non_vat_payer_text', 'reverse_charge_text'],`
- lines 168–169: `    'kind_hint',` / `    'supplier',`
- line 188: `  'vat_recap je rekapitulace DPH po sazbách; pokud doklad žádný rozpis DPH neobsahuje, vrať prázdné pole.',`
- line 189 contains: `spam, i když obsahuje ceny; other = jiný doklad`
- lines 239–240: `  };` / `  readonly document: { readonly number: string | null; readonly variable_symbol: string | null };`
- line 256: `    readonly iban: string | null;`
- line 261: `    readonly reverse_charge_text: boolean;`
- line 343: `  const flags = objectAt(root, 'flags');`
- line 350: `  }` closing the currency block (followed by `  const vatRecap: ProtoVatLine[] = [];`)
- line 368: `    reverse_charge_text: boolAt(flags, 'reverse_charge_text'),`
- line 380: `    },` closing `supplier:` in the return value (followed by `    document: {`)
- line 400: `      iban: textAt(payment, 'iban')?.replace(/\s/g, '').toUpperCase() ?? null,`

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/test/proto-schema.test.ts` | edit | wire fixture, expectations, v3 test |
| `packages/extraction/src/proto/schema.ts` | edit | version, class, schema, prompt, type, parser |

No other file may change.

## 4. Steps

1. **Test first.** In `packages/extraction/test/proto-schema.test.ts`:
   - In `wire()`, after the `supplier: { … },` object (ends line 24 `    },`) insert:
     ```ts
         buyer: { name: 'Odběratel s.r.o.', ico: '87 65 43 21', dic: 'cz87654321' },
     ```
   - Replace `    payment: { account_number: '123', bank_code: '0100', iban: 'cz00 test iban' },` with `    payment: { account_number: '123', bank_code: '0100', iban: 'cz00 test iban', method: 'card' },`
   - Replace the one-line `    flags: { not_tax_document_text: false, non_vat_payer_text: false, reverse_charge_text: false },` (line 31) with:
     ```ts
         flags: {
           not_tax_document_text: false,
           non_vat_payer_text: false,
           reverse_charge_text: false,
           paid_text: true,
         },
     ```
   - In the test `'normalizes "" to null, trims identifiers and derives the class'`, after the `expect(out.supplier).toEqual({ … });` block insert:
     ```ts
         expect(out.buyer).toEqual({ name: 'Odběratel s.r.o.', ico: '87654321', dic: 'CZ87654321' });
         expect(out.payment.method).toBe('card');
         expect(out.flags.paid_text).toBe(true);
     ```
   - Replace the whole test `it('v2 knows spam and marketing as non_document', () => { … });` with:
     ```ts
       it('v3 reads the buyer, the payment method, a paid stamp and unreadable documents', () => {
         expect(PROTO_PROMPT_VERSION).toBe('m02-proto-v3');
         expect(documentClassOf('non_document')).toBe('non_document');
         expect(documentClassOf('unreadable')).toBe('unreadable');
         expect(documentClassOf('other')).toBe('unknown');
         expect(PROTO_SYSTEM_PROMPT).toContain('non_document = ');
         expect(PROTO_SYSTEM_PROMPT).toContain('unreadable = ');
         expect(PROTO_SYSTEM_PROMPT).toContain('Sazbu DPH nikdy neodhaduj');
         const raw = wire();
         raw.payment = { account_number: '', bank_code: '', iban: '', method: 'bitcoin' };
         raw.buyer = null;
         const out = parseProtoExtraction(raw);
         expect(out.payment.method).toBeNull();
         expect(out.issues).toEqual(['payment.method']);
         expect(out.buyer).toEqual({ name: null, ico: null, dic: null });
         expect(parseProtoExtraction({}).flags.paid_text).toBe(false);
       });
     ```
   Run `pnpm --filter @shoebox/extraction test -- proto-schema 2>&1 | tail -30`: the changed tests fail. Commit `0041a step 1`.

2. **Edit `schema.ts`** (one commit, every sub-step below):
   - a. Line 8 → `export const PROTO_PROMPT_VERSION = 'm02-proto-v3';`
   - b. In `PROTO_KIND_HINTS`, insert `  'unreadable',` between `  'non_document',` and `  'other',`.
   - c. In `ProtoDocumentClass`, after `  | 'non_document'` insert the line `  | 'unreadable'`.
   - d. In `KIND_TO_CLASS`, insert `  unreadable: 'unreadable',` before `  other: 'unknown',`.
   - e. After the function `documentClassOf` (its closing `}`), insert:
     ```ts

     export const PROTO_PAYMENT_METHODS = [
       'bank_transfer',
       'card',
       'cash',
       'cash_on_delivery',
       'other',
     ] as const;
     export type ProtoPaymentMethod = (typeof PROTO_PAYMENT_METHODS)[number];
     ```
   - f. In `PROTO_RESPONSE_SCHEMA`, after the supplier's `      required: ['name', 'ico', 'dic', 'vat_id', 'country'],` and its `    },`, insert:
     ```ts
         buyer: {
           type: 'object',
           properties: {
             name: { type: 'string', description: 'Buyer (customer) name as printed; "" if not printed' },
             ico: { type: 'string', description: 'Buyer Czech IČO, 8 digits; "" if not printed' },
             dic: { type: 'string', description: 'Buyer DIČ or VAT ID; "" if not printed' },
           },
           required: ['name', 'ico', 'dic'],
         },
     ```
   - g. After `        iban: S,` insert:
     ```ts
             method: {
               type: 'string',
               enum: [...PROTO_PAYMENT_METHODS, ''],
               description: 'How it is or was paid, as printed; "" if not printed',
             },
     ```
     and replace `      required: ['account_number', 'bank_code', 'iban'],` with `      required: ['account_number', 'bank_code', 'iban', 'method'],`.
   - h. After the `reverse_charge_text: { … },` property (before the flags `required`) insert:
     ```ts
             paid_text: {
               type: 'boolean',
               description: 'The document states it is already paid (e.g. "Zaplaceno", "Uhrazeno")',
             },
     ```
     and replace the flags `required` line with `      required: ['not_tax_document_text', 'non_vat_payer_text', 'reverse_charge_text', 'paid_text'],` (if Biome wraps it, keep Biome's formatting).
   - i. In the top-level `required`, insert `    'buyer',` right after `    'supplier',`.
   - j. In `PROTO_SYSTEM_PROMPT`, after the line starting `  'vat_recap je rekapitulace DPH po sazbách;` insert:
     ```ts
       'Sazbu DPH nikdy neodhaduj a nedopočítávej: když na dokladu není rozpis podle sazeb, nech vat_recap prázdné, i když je vytištěna celková DPH.',
       'buyer je odběratel (komu je doklad vystaven); na účtence často chybí, pak nech "".',
       'payment.method: bank_transfer = převodem; card = kartou (i „Platba kartou“, terminál); cash = hotově; cash_on_delivery = dobírka; other = jinak; "" = neuvedeno. flags.paid_text = na dokladu stojí, že je už zaplaceno („Zaplaceno“, „Uhrazeno“, „Neplaťte“).',
     ```
     and in the kind_hint line replace `spam, i když obsahuje ceny; other = jiný doklad` with `spam, i když obsahuje ceny; unreadable = doklad je rozmazaný, oříznutý nebo jinak nečitelný, takže dodavatele, částku nebo datum nejde spolehlivě přečíst (pak ostatní pole nech prázdná); other = jiný doklad`.
   - k. In `ProtoExtraction`, after the supplier type's closing `  };` (line 239) insert `  readonly buyer: { readonly name: string | null; readonly ico: string | null; readonly dic: string | null };`; after `    readonly iban: string | null;` insert `    readonly method: ProtoPaymentMethod | null;`; after `    readonly reverse_charge_text: boolean;` insert `    readonly paid_text: boolean;`.
   - l. In `parseProtoExtraction`: after `  const flags = objectAt(root, 'flags');` insert `  const buyer = objectAt(root, 'buyer');`. After the currency block's closing `  }` (before `  const vatRecap`) insert:
     ```ts
       const rawMethod = textAt(payment, 'method');
       let method: ProtoPaymentMethod | null = null;
       if (rawMethod !== null && (PROTO_PAYMENT_METHODS as readonly string[]).includes(rawMethod)) {
         method = rawMethod as ProtoPaymentMethod;
       } else if (rawMethod !== null) {
         issues.push('payment.method');
       }
     ```
     After `    reverse_charge_text: boolAt(flags, 'reverse_charge_text'),` insert `    paid_text: boolAt(flags, 'paid_text'),`. In the return value, after the supplier block's `    },` (before `    document: {`) insert:
     ```ts
         buyer: {
           name: textAt(buyer, 'name'),
           ico: textAt(buyer, 'ico')?.replace(/\s/g, '') ?? null,
           dic: textAt(buyer, 'dic')?.replace(/\s/g, '').toUpperCase() ?? null,
         },
     ```
     and after the `iban:` line of the returned `payment` insert `      method,`.

   Run the step 1 command: all pass. Run `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30`: clean. Commit `0041a step 2`.

3. **Downstream check, no edits.** Run `pnpm --filter @shoebox/testkit test 2>&1 | tail -30` and `pnpm --filter @shoebox/validation typecheck 2>&1 | tail -30`: both pass unchanged (they build extractions through `parseProtoExtraction`, which tolerates the missing buyer). If either fails, STOP (§8).

## 5. Do not touch

`packages/extraction/src/llm/`, `packages/testkit/`, `packages/validation/`, `scripts/proto/`, i18n catalogs (0041b and 0041c own them). Hard rules 1, 2 and 4 (synthetic test values only).

## 6. Commands

```
pnpm --filter @shoebox/extraction test -- proto-schema 2>&1 | tail -30
pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30
pnpm --filter @shoebox/testkit test 2>&1 | tail -30
pnpm eval --quick 2>&1 | tail -30
pnpm exec biome check packages/extraction 2>&1 | tail -30
python3 scripts/context_lint.py 2>&1 | tail -30
```

## 7. Acceptance

- [ ] All extraction and testkit tests pass; typecheck and Biome clean; `pnpm eval --quick` passes.
- [ ] `grep -n "m02-proto-v2" packages/extraction/src` prints nothing.
- [ ] `grep -c "Sazbu DPH nikdy neodhaduj" packages/extraction/src/proto/schema.ts` prints 1.

## 8. Stop and ask

As in the [template](TEMPLATE.md) §8.

## 9. Report

`docs/tasks/0041a-report.md`, as in the template §9. Set `Status: review`, open one PR to `phase/0`.

## Risk list (for the reviewer)

`packages/extraction/src/proto/schema.ts` (prompt wording and the schema sent to the model). A prompt change invalidates the cached answers in `.cache/proto-cassettes`, so the next `pnpm proto:score` calls the model again.

## Owner steps

None for this brief. Merging redeploys Render; the page keeps working and reads with prompt v3.
