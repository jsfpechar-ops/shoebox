# 0209: Registry warnings: unreliable payer, unpublished account, invalid EU VAT ID

Status: todo
Ticket: P1-VAL-04 (rules D, proto subset) | Depends on: 0202, 0204, 0208 | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0209-report.md

## 1. Objective

After reading, the worker asks the VAT register (CRPDPH) about a Czech supplier DIČ and VIES about a foreign VAT ID, and adds warnings: the supplier is an unreliable VAT payer, the bank account to pay is not published in the register, the supplier is not in the VAT register although the invoice charges VAT, or the EU VAT ID is invalid. Registry checks never block and an outage adds nothing.

## 2. Context

`createCrpdphClient`, `createViesClient` (0204) and `RegistryResult` from `@shoebox/registries`; `czAccountToIban`, `ibanValid` from `@shoebox/validation`. Add `"@shoebox/registries": "workspace:*"` to `apps/worker/package.json` (workspace package, not a new dependency). Timeout 3000 ms (`registry.timeout_ms`, 06 §2.2; TODO(decision-tolerances-in-rules): read it from rules once product keys are seeded).

The warnings are plain validation rows (`severity: 'warning'`), so the status stays as the math/identity checks decided.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/doc-extract/registry-checks.ts` | new | `registryRows` |
| `apps/worker/test/registry-checks.test.ts` | new | tests (step 3) |
| `apps/worker/src/doc-extract/handler.ts` | edit | call it before save |
| `apps/worker/package.json`, `pnpm-lock.yaml` | edit | workspace dependency |
| `packages/i18n/messages/en.json` | edit | four keys |

## 4. Steps

1. `registry-checks.ts`:

```ts
export interface RegistryDeps { readonly crpdph: CrpdphClient; readonly vies: ViesClient }
export function defaultRegistryDeps(): RegistryDeps; // real clients, timeoutMs 3000
/** Warning rows (never blocking). Any unavailable/throwing lookup contributes nothing. */
export async function registryRows(
  x: ProtoExtraction,
  org: { readonly ico: string | null; readonly dic: string | null },
  deps: RegistryDeps,
): Promise<ValidationRow[]>;
```
   - Czech DIČ: `x.supplier.dic` matches `^CZ(\d{8,10})$` and ≠ `org.dic` → `crpdph.status([digits])`; on `ok` take the subject with that `dic`:
     - `nespolehlivyPlatce === 'ANO'` → `PROTO_REG_UNRELIABLE` params `{ dic, messageKey: 'proto.check.reg_unreliable.warn' }`;
     - `typSubjektu === 'NENALEZEN'` and some `x.vat_recap` row has VAT ≠ 0 → `PROTO_REG_NOT_VAT_PAYER` `{ dic, messageKey: 'proto.check.reg_not_vat_payer.warn' }`;
     - `x.payment.method === 'bank_transfer'`, the IBAN to pay is known (`x.payment.iban` when `ibanValid`, else `czAccountToIban(null, account_number, bank_code)` when both are set; an `account_number` with `-` is split into prefix and number), the subject has ≥ 1 account without `datumZverejneniUkonceni`, and none equals that IBAN (standard accounts compared via `czAccountToIban`, non-standard by uppercase string without spaces) → `PROTO_REG_ACCOUNT_UNPUBLISHED` `{ dic, iban, messageKey: 'proto.check.reg_account_unpublished.warn' }`.
   - Foreign VAT ID: `x.supplier.vat_id` matches `^([A-Z]{2})([0-9A-Z]{2,13})$`, country ≠ `CZ`, and `org.dic` matches `^CZ\d+$` → `vies.check(cc, number, { countryCode: 'CZ', vatNumber: org.dic.slice(2) })`; `ok` and `valid === false` → `PROTO_REG_VAT_ID_INVALID` `{ vatId, messageKey: 'proto.check.reg_vat_id_invalid.warn' }`.
   - Every row: `ruleVersion: 1, severity: 'warning'`. Wrap each lookup in try/catch.
2. `handler.ts`: `DocExtractDeps` gains `readonly registries?: RegistryDeps; // default defaultRegistryDeps()`. Just before `store.save`, for non-ISDOC and ISDOC readings alike: `write = { ...write, validations: [...write.validations, ...(await registryRows(<the saved extraction>, org, deps.registries ?? defaultRegistryDeps()))] }` — keep the extraction used by `toWrite` reachable (e.g. return it alongside the write). Existing handler tests must not hit the network: add `registries` with fakes returning `{ status: 'unavailable', reason: 'timeout' }` to the test file's shared setup if needed (that edit to `doc-extract-handler.test.ts` is allowed).
3. `apps/worker/test/registry-checks.test.ts`: fakes for both clients; one test per row (raised, and not raised: `NE` payer; account published as standard `19-2000145399/0800` while paying `CZ6508000000192000145399` → no row; VIES `valid: true` → no row); CRPDPH `unavailable` → `[]`; a throwing client → `[]`; the org's own DIČ is never looked up. Synthetic values only (`25596641`, `00006947`, `CZ6508000000192000145399`, `DE123456789`).
4. `en.json`:

```json
  "proto.check.reg_unreliable.warn": "The VAT register lists {dic} as an unreliable VAT payer. If you pay them, you may have to pay their VAT yourself. Consider paying the VAT part straight to the tax office.",
  "proto.check.reg_not_vat_payer.warn": "The invoice charges VAT, but {dic} is not in the VAT register. You cannot claim this VAT until the supplier fixes it.",
  "proto.check.reg_account_unpublished.warn": "The account {iban} is not published in the VAT register for {dic}. Paying a large amount to it can make you liable for their VAT.",
  "proto.check.reg_vat_id_invalid.warn": "The EU VAT ID {vatId} is not valid in VIES. Ask the supplier for a correct invoice.",
```

## 5. Do not touch

Everything outside §3. Hard rule 4: never log registry answers with document data. Tests never call live services.

## 6. Commands

```
pnpm install 2>&1 | tail -3
pnpm --filter @shoebox/worker test 2>&1 | tail -30
pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30
pnpm --filter @shoebox/i18n test 2>&1 | tail -30
pnpm exec biome check --write apps/worker packages/i18n 2>&1 | tail -30
```

## 7. Acceptance

- [ ] §6 passes.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0209-report.md`, 200 tokens at most. Set `Status: review`.

## Risk list (for the reviewer)

`registry-checks.ts` account comparison; nothing blocks.
