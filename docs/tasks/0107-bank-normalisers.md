# 0107: Bank normalisers (amounts, symbols, accounts, dates)

Status: todo
Ticket: P2-BANK-01 (normalisers) | Depends on: none | Base commit: 5f5b711 | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the shared pure helpers every bank statement parser needs: read an amount as `Money` (never a float), clean VS/KS/SS symbols, read a Czech account or IBAN, and read bank dates. Later briefs (GPC, CAMT.053, MT940) build on these, so a user's bank statement lands with correct amounts.

## 2. Context

M07 §4.3 "Common normalisation (`packages/bank/src/normalize.ts`)":
- Amounts: strip spaces/NBSP/apostrophes as thousand separators; decimal separator is the last `,` or `.` followed by exactly 1–2 digits; result as `Money` (ADR-007). Never parse money via `Number`.
- VS/KS/SS: digits only, strip leading zeros, `''` → null.
- Counterparty account: split `prefix-number/bank` forms; IBAN `CZ…` → derive `account_number`/`bank_code` too; foreign IBAN kept in `counterparty_iban` only.
- Account numbers are stored normalised: `[prefix-]number` without leading zeros, `bank_code` 4 digits, IBAN validated (mod-11 per part; mod-97 for IBAN).

Existing helpers to reuse (do not copy them), `packages/validation/src/ids.ts`, exported from `@shoebox/validation`:
```ts
export function czAccountValid(prefix: string | null, number: string, bankCode: string): boolean {
export function ibanValid(iban: string): boolean {
export function czAccountToIban(
```
`czAccountToIban(prefix, number, bankCode)` returns the CZ IBAN or null when the account is invalid.

From `@shoebox/domain`: `Money.parse(text, currency)` accepts only `/^-?\d+(\.\d+)?$/` and throws otherwise; `type Currency = string`; `CZK`, `EUR`; `type LegalDate` (branded `YYYY-MM-DD`), `isLegalDate(value)`, `parseLegalDate(value)`.

`packages/bank/package.json` today has no `dependencies` block; `devDependencies` holds `typescript` and `vitest` (`catalog:`). `@shoebox/domain` and `@shoebox/validation` are workspace packages, not new vendors.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/bank/package.json` | edit | add `dependencies` |
| `pnpm-lock.yaml` | edit | updated by `pnpm install` only |
| `packages/bank/src/types.ts` | new | shared types |
| `packages/bank/src/normalize.ts` | new | the helpers |
| `packages/bank/src/index.ts` | edit | re-export |
| `packages/bank/test/normalize.test.ts` | new | the test file below, verbatim |

No other file may change.

## 4. Steps

1. `packages/bank/package.json`: after the `"scripts"` block add
```json
  "dependencies": {
    "@shoebox/domain": "workspace:*",
    "@shoebox/validation": "workspace:*"
  },
```
Run `pnpm install 2>&1 | tail -5`. Expected: done, only `pnpm-lock.yaml` changes besides package.json. Commit `0107 step 1`.

2. New `packages/bank/src/types.ts`, exactly:
```ts
import type { LegalDate, Money } from '@shoebox/domain';

/** M07 §6.1. Only gpc, camt053 and mt940 have parsers so far. */
export type StatementFormat =
  | 'gpc'
  | 'camt053'
  | 'mt940'
  | 'fio_json'
  | 'csv_fio'
  | 'csv_cs'
  | 'json_cs_george'
  | 'csv_csob'
  | 'csv_kb'
  | 'csv_rb'
  | 'csv_airbank'
  | 'csv_moneta'
  | 'csv_unicredit'
  | 'csv_mbank'
  | 'csv_airbnb'
  | 'csv_booking'
  | 'csv_comgate'
  | 'csv_gopay'
  | 'csv_paypal'
  | 'csv_zasilkovna'
  | 'csv_generic';

export interface AccountRef {
  /** `[prefix-]number`, no leading zeros. */
  account?: string;
  bankCode?: string;
  iban?: string;
  bic?: string;
}

export interface CanonicalTx {
  externalId?: string;
  bookedOn: LegalDate;
  valueDate?: LegalDate;
  /** Signed: + incoming, − outgoing, in account currency. */
  amount: Money;
  amountOriginal?: Money;
  counterparty: AccountRef & { name?: string };
  vs?: string;
  ks?: string;
  ss?: string;
  message?: string;
  cardMerchant?: string;
  cardLast4?: string;
  isReversal?: boolean;
  isPending?: boolean;
  bankTxCode?: string;
  raw: Record<string, unknown>;
}

export interface ParseWarning {
  line?: number;
  code: string;
  raw?: string;
}

export interface ParsedStatement {
  format: StatementFormat;
  parserVersion: number;
  profile?: string;
  account?: AccountRef & { currency?: string };
  periodFrom?: LegalDate;
  periodTo?: LegalDate;
  statementNumber?: string;
  openingBalance?: Money;
  closingBalance?: Money;
  controlDebit?: Money;
  controlCredit?: Money;
  /** 'ok' | 'mismatch'; undefined when the file has no balances. */
  balanceCheck?: 'ok' | 'mismatch';
  txs: CanonicalTx[];
  warnings: ParseWarning[];
}
```
Run `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -5`. Expected: no errors. Commit `0107 step 2`.

3. New `packages/bank/src/normalize.ts` with exactly these exports. Implement until the step 4 tests pass; do not edit the test file.
```ts
/** Amount text → Money; null when it is not an amount. */
export function parseAmount(text: string, currency: Currency): Money | null;
/** VS/KS/SS: every non-digit dropped, leading zeros stripped; null when empty, all zeros, or > 10 digits. */
export function parseSymbol(text: string | null | undefined): string | null;
/** `prefix-number`/`number` without leading zeros; prefix omitted when it is all zeros or empty. */
export function formatAccount(prefix: string | null, number: string): string;
/** 'prefix-number/bank', 'number/bank' or an IBAN (spaces allowed, any case). null when invalid. */
export function parseAccount(text: string): AccountRef | null;
/** GPC 16-digit account field in `edicni` encoding (prefix 6 + number 10). null when all zeros or not 16 digits. */
export function decodeGpcAccount(field: string): string | null;
/** 'DDMMYY' → LegalDate (century 20YY); null for '000000' or an impossible date. */
export function parseDdmmyy(text: string): LegalDate | null;
/** 'YYMMDD' → LegalDate (century 20YY); null for '000000' or an impossible date. */
export function parseYymmdd(text: string): LegalDate | null;
/** VS/KS/SS found in free text with the M07 §4.3.2 regexes, each through parseSymbol. */
export function symbolsFromText(text: string): { vs?: string; ks?: string; ss?: string };
```
Rules:
- `parseAmount`: trim; remove every space, NBSP (` `), narrow NBSP (` `) and `'`; take an optional leading `+` or `-`; the rest may hold only digits, `,` and `.`. If it ends with `[.,]\d{1,2}`, that separator is the decimal point; every other `,`/`.` is removed. With no such ending, every `,`/`.` is removed. Build `-?digits(.digits)?` and call `Money.parse`. Anything else (empty, letters, no digits) → null. Never use `Number` or `parseFloat`.
- `parseAccount`: spaces removed, uppercased. An IBAN (`/^[A-Z]{2}\d{2}[A-Z0-9]+$/`) must pass `ibanValid`, else null. A `CZ` IBAN also yields `bankCode` = chars 5–8, `account` = `formatAccount(chars 9–14, chars 15–24)`; a foreign IBAN yields `{ iban }` only. The domestic form is `/^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/`; it must pass `czAccountValid` (prefix null when absent or all zeros), and yields `{ account, bankCode, iban: czAccountToIban(...) }`. Anything else → null.
- `parseDdmmyy`/`parseYymmdd`: 6 digits only, build `20YY-MM-DD`, return it only when `isLegalDate` is true.
- `symbolsFromText`: regexes `/(?:^|\/)VS[:\/]?\s*(\d{1,10})/`, `/(?:^|\/)KS[:\/]?\s*(\d{1,10})/`, `/(?:^|\/)SS[:\/]?\s*(\d{1,10})/`; a key is present only when parseSymbol gives a value.

Commit `0107 step 3`.

4. New `packages/bank/test/normalize.test.ts`, verbatim:
```ts
import { CZK, EUR, Money } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  decodeGpcAccount,
  formatAccount,
  parseAccount,
  parseAmount,
  parseDdmmyy,
  parseSymbol,
  parseYymmdd,
  symbolsFromText,
} from '../src/normalize';

const amt = (text: string) => parseAmount(text, CZK)?.toString() ?? null;
const m = (text: string) => Money.parse(text, CZK).toString();

describe('parseAmount', () => {
  it.each([
    ['1234.56', '1234.56'],
    ['1 234,56', '1234.56'],
    ['1 234,56', '1234.56'],
    ['1 234,5', '1234.5'],
    ["1'234.50", '1234.5'],
    ['1.234,56', '1234.56'],
    ['1,234.56', '1234.56'],
    ['12.345.678,9', '12345678.9'],
    ['-1 500', '-1500'],
    ['+20,00', '20'],
    ['- 100,00', '-100'],
    ['1.234', '1234'],
    ['0,01', '0.01'],
    ['  42  ', '42'],
  ])('%s', (input, expected) => {
    expect(amt(input)).toBe(m(expected));
  });

  it.each(['', '   ', 'abc', '12a', '--5', '1 234 Kč', ','])('rejects %j', (input) => {
    expect(amt(input)).toBeNull();
  });

  it('keeps the currency', () => {
    expect(parseAmount('10,5', EUR)?.currency).toBe('EUR');
  });
});

describe('parseSymbol', () => {
  it.each([
    ['0000001234', '1234'],
    [' 12 34 ', '1234'],
    ['VS 0308', '308'],
    ['1234567890', '1234567890'],
  ])('%s', (input, expected) => {
    expect(parseSymbol(input)).toBe(expected);
  });

  it.each(['', '0000000000', '12345678901', null, undefined, 'abc'])('null for %j', (input) => {
    expect(parseSymbol(input)).toBeNull();
  });
});

describe('formatAccount', () => {
  it('drops leading zeros and an empty prefix', () => {
    expect(formatAccount('000000', '0002400123455')).toBe('2400123455');
    expect(formatAccount('001003', '1234567899')).toBe('1003-1234567899');
    expect(formatAccount(null, '0000012345')).toBe('12345');
  });
});

describe('parseAccount', () => {
  it('reads number/bank and computes the IBAN', () => {
    expect(parseAccount('2400123455/2010')).toEqual({
      account: '2400123455',
      bankCode: '2010',
      iban: 'CZ8720100000002400123455',
    });
  });

  it('reads prefix-number/bank', () => {
    expect(parseAccount('1003-1234567899/0800')).toEqual({
      account: '1003-1234567899',
      bankCode: '0800',
      iban: 'CZ4608000010031234567899',
    });
  });

  it('reads a CZ IBAN with spaces and lower case', () => {
    expect(parseAccount('cz46 0800 0010 0312 3456 7899')).toEqual({
      account: '1003-1234567899',
      bankCode: '0800',
      iban: 'CZ4608000010031234567899',
    });
  });

  it('keeps a foreign IBAN only as iban', () => {
    expect(parseAccount('DE89 3704 0044 0532 0130 00')).toEqual({ iban: 'DE89370400440532013000' });
  });

  it.each(['2400123456/2010', '2400123455/201', 'CZ8720100000002400123456', 'hello', ''])(
    'rejects %j',
    (input) => {
      expect(parseAccount(input)).toBeNull();
    },
  );
});

describe('decodeGpcAccount', () => {
  it('splits prefix and number', () => {
    expect(decodeGpcAccount('0000002400123455')).toBe('2400123455');
    expect(decodeGpcAccount('0010031234567899')).toBe('1003-1234567899');
  });

  it('null for zeros or a wrong length', () => {
    expect(decodeGpcAccount('0000000000000000')).toBeNull();
    expect(decodeGpcAccount('123')).toBeNull();
  });
});

describe('dates', () => {
  it('reads DDMMYY and YYMMDD', () => {
    expect(parseDdmmyy('260926')).toBe('2026-09-26');
    expect(parseYymmdd('260926')).toBe('2026-09-26');
  });

  it('null for zeros and impossible dates', () => {
    expect(parseDdmmyy('000000')).toBeNull();
    expect(parseDdmmyy('310226')).toBeNull();
    expect(parseYymmdd('261340')).toBeNull();
    expect(parseYymmdd('12345')).toBeNull();
  });
});

describe('symbolsFromText', () => {
  it('reads slash-separated symbols', () => {
    expect(symbolsFromText('/VS/1234/KS/0308/SS/00042')).toEqual({ vs: '1234', ks: '308', ss: '42' });
  });

  it('reads VS: at the start', () => {
    expect(symbolsFromText('VS: 2026001 thanks')).toEqual({ vs: '2026001' });
  });

  it('ignores VS inside a word', () => {
    expect(symbolsFromText('XVS 123')).toEqual({});
  });
});
```
Run `pnpm --filter @shoebox/bank test -- normalize 2>&1 | tail -30`. Expected: all pass. Commit `0107 step 4`.

5. `packages/bank/src/index.ts`: below the existing line `export const packageName = '@shoebox/bank' as const;` add
```ts
export * from './normalize';
export type * from './types';
```
Run typecheck. Commit `0107 step 5`.

## 5. Do not touch

`packages/validation/`, `packages/domain/`, every other package and app. Hard rules: money is never a float (no `Number(`, `parseFloat(` or `+text` on amounts in `normalize.ts`); no new external dependency.

## 6. Commands

- `pnpm --filter @shoebox/bank test 2>&1 | tail -30` → all pass (smoke + normalize).
- `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -30` → no errors.
- `pnpm biome check packages/bank 2>&1 | tail -30` → no errors (run `pnpm biome check --write packages/bank` once if it only reports formatting).

## 7. Acceptance

- [ ] The test file is byte-identical to §4 step 4 and passes.
- [ ] `grep -nE "Number\(|parseFloat|parseInt" packages/bank/src/normalize.ts` finds nothing for amounts (parseInt on date parts is allowed only if you need it; prefer string slicing).
- [ ] Typecheck and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- `pnpm install` needs the network and fails;
- a file outside §3 needs a change;
- a step is unclear.

## 9. Report

Write `docs/tasks/0107-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you could not do, and why.
