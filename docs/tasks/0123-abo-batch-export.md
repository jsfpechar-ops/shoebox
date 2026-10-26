# 0123: ABO/KPC payment-order file (table-driven writer, behind a flag that stays off)

Status: todo
Ticket: P2-PAY-01 (M07 §4.9.3, A14; 22 T-16) | Depends on: 0121, 0122 | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
<!-- Risk: HIGH (money). Pure writer with verbatim tests; one route behind SHOEBOX_FLAG_ABO_EXPORT, which stays OFF. -->

## 1. Objective

`buildAboBatch()` writes the domestic payment-order file (ABO/KPC) a user uploads to internet banking, from a table-driven layout, with per-item validation. A route returns the file for one document only when the flag is on, and records the export in `payment_orders`/`payment_order_items`. Exporting never marks a document paid.

## 2. Context

- **The record layout is `[verify]`** (22 T-16, M07 §4.9.3): the research files document the statement format (074/075), not the payment-order file. The layout in step 1 is the orchestrator's best reading of the banks' "ABO formát pro tuzemský platební styk" and must be checked against the Fio, ČSOB and KB import specs before the flag is lifted (owner checklist A14). That is why every width, separator and record tag lives in `layout.ts` as data (a correction is a data change, tests change with it) and why the tests prove the writer follows the table, not that a bank accepts the file. Leave `TODO(T-16)` at the top of `layout.ts`.
- Encoding windows-1250, CRLF. Every text field is ASCII-folded (`spaydFold` from 0121, then `*` back to nothing: strip any char outside `0x20–0x7E`), so the bytes are plain ASCII (a subset of windows-1250) and no encoder dependency is needed. Amounts are haléře: `Money.toFixed2()` with the dot removed, leading zeros stripped (`'0.50'` → `50`), never `Number`.
- Validation per item (M07 §4.9.3), codes: `alreadyPaid`, `missingBankAccount`, `invalidBankAccount` (`czAccountValid(prefix, number, bankCode)` from `@shoebox/validation`; prefix split on `-` as in 0121's `payToIban`), `varSymTooLong` (> 10 digits), `invalidCurrency` (only CZK), `unableToPayNegativeAmount` (negative or zero), `riskNotAcknowledged` (a `blocking` pre-payment check without the user's acknowledgement). An item with an error is left out of the file; the rest is written. One file = one source account, CZK only. File name `prikazy_{account}_{YYYYMMDD}.kpc`.
- Tables: `payment_orders(kind 'abo', money_account_id, file_path, total, item_count, created_by)`, `payment_order_items(order_id, org_id, document_id, amount, account, variable_symbol, checks, risk_acknowledged_by)` (`packages/db/migrations/0020_money.sql` lines 142–159, tenant RLS, users may insert). `money_accounts(id, org_id, type, name, currency, account_number, bank_code, iban)`.
- From 0122: `loadPayView(supabase, orgId, documentId, deps)` → `PayView | null` with `openAmount` (string), `checks`, `blocking`, `acknowledged`, `iban`, `variableSymbol`, `verifiedAt`; `PayDeps = { crpdph, now }`. Route pattern: `apps/web/app/api/export/route.ts` (auth via `requireActiveRole`, `Response.json({ error }, { status })`, binary `Response` with `Content-Disposition`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/bank/src/pay/abo/layout.ts` | new | `ABO_LAYOUT` (data only) |
| `packages/bank/src/pay/abo/abo.ts` | new | `toHalere`, `aboFold`, `validateAboItem`, `buildAboBatch` |
| `packages/bank/src/pay/index.ts` | edit | `export * from './abo/layout'; export * from './abo/abo';` |
| `packages/bank/test/abo.test.ts` | new | verbatim below |
| `apps/web/app/api/pay/abo/route.ts` | new | GET `?document=<uuid>`, flag-gated |

No other file may change. No migration, no dependency, no UI (the button on the Pay card comes with the brief that lifts the flag).

## 4. Steps

1. `layout.ts`, verbatim (data; `// TODO(T-16): [verify] against Fio, ČSOB and KB payment-order import specs` on line 1):
```ts
export const ABO_LAYOUT = {
  eol: '\r\n',
  header: { tag: 'UHL1', dateFormat: 'DDMMYY', clientNameWidth: 20, clientNumberWidth: 10, intervalFrom: '001', intervalTo: '999', secureKey: '000000' },
  group: { tag: '1', type: '1501', batchWidth: 6 },
  account: { tag: '2' },
  item: { messagePrefix: 'AV:', messageMax: 35, emptySymbol: '0' },
  trailers: { account: '3 +', file: '5 +' },
  separator: ' ',
} as const;
```
Records, in order, each ending with `eol`: header `UHL1` + `DDMMYY` of `createdOn` + client name padded right with spaces to 20 (cut at 20) + client number padded left with zeros to 10 (default `'0000000000'`) + `001` + `999` + `000000`; group `1 1501 000001 {sourceBankCode}`; account `2 {sourceAccount} {total haléře} {DDMMYY due}`; one line per included item: `{account} {haléře} {vs or 0} {bankCode}{ks or nothing} {ss or 0}` + (when the folded message is non-empty) ` AV:{message cut to 35}`; then `3 +`, then `5 +`. Commit `0123 step 1`.

2. `abo.ts`:
```ts
export type AboErrorCode = 'alreadyPaid' | 'missingBankAccount' | 'invalidBankAccount' | 'varSymTooLong' | 'invalidCurrency' | 'unableToPayNegativeAmount' | 'riskNotAcknowledged';
export interface AboItem { readonly documentId: string; readonly account: string; readonly bankCode: string; readonly amount: Money; readonly vs?: string | null; readonly ks?: string | null; readonly ss?: string | null; readonly message?: string | null; readonly paidAt?: string | null; readonly blocking?: boolean; readonly acknowledged?: boolean }
export interface AboBatchInput { readonly sourceAccount: string; readonly sourceBankCode: string; readonly clientName: string; readonly clientNumber?: string; readonly createdOn: LegalDate; readonly dueDate: LegalDate; readonly items: readonly AboItem[] }
export interface AboItemError { readonly documentId: string; readonly code: AboErrorCode }
export function toHalere(amount: Money): string;
export function aboFold(s: string): string;
export function validateAboItem(item: AboItem): AboItemError[];
export function buildAboBatch(i: AboBatchInput): { bytes: Uint8Array; text: string; fileName: string; errors: AboItemError[]; included: readonly string[]; total: Money };
```
`validateAboItem` order (every code that applies, in this order): `alreadyPaid` (paidAt set), `missingBankAccount` (account or bankCode empty), `invalidBankAccount` (only when both are present), `varSymTooLong` (vs digits > 10; the vs written is its digits), `invalidCurrency`, `unableToPayNegativeAmount`, `riskNotAcknowledged` (`blocking && !acknowledged`). `bytes = new TextEncoder().encode(text)` (ASCII only after `aboFold`). `fileName = \`prikazy_${sourceAccount}_${createdOn without dashes}.kpc\``. `total` = `Money.sum` of included amounts (CZK). Commit `0123 step 2`.

3. `packages/bank/test/abo.test.ts`, verbatim:
```ts
import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { type AboItem, buildAboBatch, toHalere, validateAboItem } from '../src/pay/abo/abo';

const czk = (s: string) => Money.parse(s, CZK);
const D = parseLegalDate;
const base = { sourceAccount: '2400123455', sourceBankCode: '2010', clientName: 'ACME', createdOn: D('2026-03-01'), dueDate: D('2026-03-15') };
const HEADER = `UHL1010326${'ACME'.padEnd(20)}0000000000001999000000`;
const good: AboItem = { documentId: 'd1', account: '1003-1234567899', bankCode: '0800', amount: czk('1210.00'), vs: '2026001', ks: '0308', ss: '55', message: 'Úhrada FV2026001' };

describe('toHalere', () => {
  it('is the 2-dp string without the dot and without leading zeros', () => {
    expect(toHalere(czk('1210.00'))).toBe('121000');
    expect(toHalere(czk('0.50'))).toBe('50');
    expect(toHalere(czk('0.00'))).toBe('0');
    expect(toHalere(czk('123456789.99'))).toBe('12345678999');
  });
});

describe('buildAboBatch', () => {
  it('fixture 1: one item', () => {
    const r = buildAboBatch({ ...base, items: [good] });
    expect(r.errors).toEqual([]);
    expect(r.included).toEqual(['d1']);
    expect(r.total.toFixed2()).toBe('1210.00');
    expect(r.fileName).toBe('prikazy_2400123455_20260301.kpc');
    expect(r.text).toBe([HEADER, '1 1501 000001 2010', '2 2400123455 121000 150326', '1003-1234567899 121000 2026001 08000308 55 AV:Uhrada FV2026001', '3 +', '5 +', ''].join('\r\n'));
    expect(new TextDecoder('ascii').decode(r.bytes)).toBe(r.text);
  });
  it('fixture 2: three items, missing symbols, long message cut at 35, client name cut at 20', () => {
    const r = buildAboBatch({
      ...base, clientName: 'Dlouhé jméno firmy, které je příliš dlouhé', clientNumber: '42',
      items: [
        good,
        { documentId: 'd2', account: '2400123455', bankCode: '2010', amount: czk('50.00'), vs: 'VS 777', message: 'Úhrada 1234567890123456789012345678901234' },
        { documentId: 'd3', account: '1003-1234567899', bankCode: '0800', amount: czk('0.50'), vs: '1', ss: '2', message: '' },
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.included).toEqual(['d1', 'd2', 'd3']);
    expect(r.total.toFixed2()).toBe('1260.50');
    expect(r.text.split('\r\n')).toEqual([
      'UHL1010326Dlouhe jmeno firmy, 0000000042001999000000',
      '1 1501 000001 2010',
      '2 2400123455 126050 150326',
      '1003-1234567899 121000 2026001 08000308 55 AV:Uhrada FV2026001',
      '2400123455 5000 777 2010 0 AV:Uhrada 1234567890123456789012345678',
      '1003-1234567899 50 1 0800 2',
      '3 +',
      '5 +',
      '',
    ]);
    expect([...r.bytes].every((b) => b >= 0x0a && b <= 0x7e)).toBe(true);
  });
  it('fixture 3: every error code; bad items are left out, the rest is written', () => {
    const r = buildAboBatch({
      ...base,
      items: [
        { ...good, documentId: 'paid', paidAt: '2026-02-20' },
        { ...good, documentId: 'noacc', account: '' },
        { ...good, documentId: 'nobank', bankCode: '' },
        { ...good, documentId: 'badacc', account: '705-1234567890', bankCode: '0710' },
        { ...good, documentId: 'longvs', vs: '12345678901' },
        { ...good, documentId: 'eur', amount: Money.parse('10.00', 'EUR') },
        { ...good, documentId: 'neg', amount: czk('-5.00') },
        { ...good, documentId: 'zero', amount: czk('0.00') },
        { ...good, documentId: 'risk', blocking: true },
        { ...good, documentId: 'ok', blocking: true, acknowledged: true },
      ],
    });
    expect(r.errors).toEqual([
      { documentId: 'paid', code: 'alreadyPaid' },
      { documentId: 'noacc', code: 'missingBankAccount' },
      { documentId: 'nobank', code: 'missingBankAccount' },
      { documentId: 'badacc', code: 'invalidBankAccount' },
      { documentId: 'longvs', code: 'varSymTooLong' },
      { documentId: 'eur', code: 'invalidCurrency' },
      { documentId: 'neg', code: 'unableToPayNegativeAmount' },
      { documentId: 'zero', code: 'unableToPayNegativeAmount' },
      { documentId: 'risk', code: 'riskNotAcknowledged' },
    ]);
    expect(r.included).toEqual(['ok']);
    expect(r.text.split('\r\n')[2]).toBe('2 2400123455 121000 150326');
    expect(validateAboItem(good)).toEqual([]);
  });
});
```
Run `pnpm --filter @shoebox/bank exec vitest run test/abo.test.ts 2>&1 | tail -30` → pass. Commit `0123 step 3`.

4. Route `apps/web/app/api/pay/abo/route.ts`, `GET(request)`: when `process.env.SHOEBOX_FLAG_ABO_EXPORT !== 'on'` → `Response.json({ error: 'not_found' }, { status: 404 })` before anything else. Then `requireActiveRole(['owner', 'member'])` (401/403 as the export route); `document` query param must be a uuid (400). `view = await loadPayView(...)` as the document page does; null → 404. Source account: the org's first `money_accounts` row with `type` of a bank account, non-null `account_number` and `bank_code`, `currency 'CZK'`, ordered by `name` (none → 409 `{ error: 'no_source_account' }`). Client name: `organizations.name`. `buildAboBatch` with one item from the view (`account` and `bankCode` from `view.iban`: chars 8–24 → number without leading zeros, prefix = chars 8–14 when not all zeros; bank code chars 4–8; `vs: view.variableSymbol`, `message: 'Uhrada ' + document number`, `paidAt: null`, `blocking: view.blocking`, `acknowledged: view.acknowledged`). Errors → 422 `{ errors }`. Otherwise insert `payment_orders` `{ org_id, kind: 'abo', money_account_id, file_path: fileName, total: total.toFixed2(), item_count: 1, created_by }` and one `payment_order_items` `{ order_id, org_id, document_id, amount, account: view.iban, variable_symbol, checks: { verifiedAt: view.verifiedAt, checks: view.checks }, risk_acknowledged_by: view.acknowledged ? userId : null }`; respond with `bytes`, `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<fileName>"`. No document content in logs. Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. Commit `0123 step 4`.

## 5. Do not touch

The Pay card, `en.json` (no copy in this brief), migrations, `packages/validation`. The flag stays off: do not add it to any env example as `on`.

## 6. Commands

The vitest run above; `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -30`; `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`; `pnpm biome check packages/bank apps/web/app/api/pay 2>&1 | tail -5` → 0 errors.

## 7. Acceptance

- [ ] `abo.test.ts` passes unchanged (3 fixtures). - [ ] Without `SHOEBOX_FLAG_ABO_EXPORT=on` the route answers 404 before touching auth or the database. - [ ] Exporting writes `payment_orders`/`payment_order_items` and never changes `documents.paid_at`.

## 8. Stop and ask

Stop and write the report if a file outside §3 needs a change, `loadPayView` from 0122 has a different shape than §2 says (quote it), a test fails twice, or you reach 25 tool calls / 50k tokens.

## 9. Report

`docs/tasks/0123-report.md` (600 tokens at most), `Status: review`: files changed, each command with its last 5 lines, deviations. Owner hand-off (A14): set `SHOEBOX_FLAG_ABO_EXPORT=on` only on a test deployment, open `/api/pay/abo?document=<id>` for one unpaid invoice, upload the `.kpc` to Fio, ČSOB and KB; report which accepted it. The layout stays `[verify]` until then.
