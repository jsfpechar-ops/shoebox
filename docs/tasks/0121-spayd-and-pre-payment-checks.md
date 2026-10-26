# 0121: Paying own bills: SPAYD builder and pre-payment checks (pure)

Status: todo
Ticket: P2-PAY-01 (pure part, M07 §4.9.1–§4.9.2, A13, A15) | Depends on: none | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
<!-- Risk: HIGH (money). Pure functions only; no I/O, no DB. -->

## 1. Objective

`packages/bank/src/pay/`: build the QR Platba string (SPAYD v1.2 with CRC32) for an unpaid CZK document, and run the pre-payment checks (unreliable payer, unpublished account, changed account, registry outage, paid, no/invalid account, foreign currency) as a pure function over values the caller loads. 0122 wires both into the document page.

## 2. Context

Money is never a float: `Money.toFixed2()` strings only. From `@shoebox/domain`: `Money` (`parse(text, currency)`, `compare`, `toFixed2`, `currency`), `CZK`, `LegalDate`, `parseLegalDate`, `compareLegalDates`. From `@shoebox/validation`: `ibanValid(iban)`, `czAccountToIban(prefix, number, bankCode)` (returns null when the account fails the mod-11 check; see `packages/validation/src/ids.ts` lines 30–80). CRC32: `import { crc32 } from 'node:zlib'`, exactly as `packages/extraction/src/qr/payload.ts` line 129–133 verifies it: `signed = ['SPD*1.0', ...attrs.sort()].join('*')`, hex uppercase, 8 chars, zero-padded. Both sides must agree, so the builder's output verifies with the reader.

SPAYD (research §5.1, M07 §4.9.2): `SPD*1.0*` then `KEY:VALUE*` attributes, keys sorted lexicographically (`ACC AM CC DT MSG RN X-KS X-SS X-VS`), `CRC32:` last. Max lengths: ACC 46, AM 10, MSG 60, RN 35, X-VS/X-KS/X-SS 10 digits. A raw `*` in a value becomes `%2A`. `DT` is `YYYYMMDD`, omitted when the due date is before today. `AM` is the open amount with a dot and 2 decimals; `CC` is `CZK` (anything else throws: the checks stop the caller first). The ACC is `IBAN` or `IBAN+BIC`; BIC from a small table (research §6.3 [O]: 0100 KOMBCZPP, 0300 CEKOCZPP, 0600 AGBACZPP, 0800 GIBACZPX; Fio 2010 FIOBCZPP [I]); unknown bank code → no BIC.

Checks (M07 §4.9.1), severity `ok | info | warning | blocking`: `ALREADY_PAID` (paid_at set or open ≤ tolerance) blocking; `NO_ACCOUNT` blocking; `ACCOUNT_INVALID` blocking; `UNRELIABLE_PAYER` blocking when the org is `platce`, else warning; `ACCOUNT_NOT_PUBLISHED` (supplier is a VAT payer, org is `platce`, pay-to IBAN not among the supplier's active published accounts) blocking when the document total exceeds `vat.ruceni_cash_threshold` (270 000 CZK; 22 TA-16 default: compare the total incl. VAT, leave `TODO(decision-TA-16)`), else warning; `ACCOUNT_CHANGED` warning; `REGISTRY_UNAVAILABLE` warning, never blocking; `FOREIGN_CURRENCY` info (no QR). `REGISTRY_OK` (ok) when the registry answered, the supplier is a VAT payer, not unreliable, and the account is published. "Blocking" hides the QR until the user acknowledges (0122); nothing here prevents paying.

Test accounts (synthetic): `2400123455/2010` = `CZ8720100000002400123455`; `1003-1234567899/0800` = `CZ4608000010031234567899`; `705-1234567890/0710` is checksum-invalid on purpose. IBANs were computed by hand (ISO 7064 mod 97); if `czAccountToIban` disagrees, stop and report.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/bank/package.json` | edit | add devDependency `"zxing-wasm": "3.1.5"` (already in the lockfile via `@shoebox/extraction`; `pnpm install --offline`) |
| `packages/bank/src/pay/bic.ts` | new | `BANK_BIC`, `bicForBankCode` |
| `packages/bank/src/pay/account.ts` | new | `PayToAccount`, `payToIban` |
| `packages/bank/src/pay/spayd.ts` | new | `spaydFold`, `spaydSymbol`, `spaydCrc32`, `buildSpayd` |
| `packages/bank/src/pay/checks.ts` | new | `RegistryLookup`, `toRegistryLookup`, `prePaymentChecks` |
| `packages/bank/src/pay/index.ts` | new | re-exports the four files |
| `packages/bank/src/index.ts` | edit | add `export * from './pay/index';` after the matcher line |
| `packages/bank/test/spayd.test.ts` | new | verbatim below |
| `packages/bank/test/pre-payment.test.ts` | new | verbatim below |

No other file may change. No migration.

## 4. Steps

1. `bic.ts`: `export const BANK_BIC: Readonly<Record<string, string>>` with the five codes of §2; `export function bicForBankCode(code: string): string | undefined`. `account.ts`:
```ts
export interface PayToAccount { readonly account?: string | null; readonly bank_code?: string | null; readonly iban?: string | null; readonly bic?: string | null }
export type PayToResult = { kind: 'none' } | { kind: 'invalid' } | { kind: 'ok'; iban: string; bankCode: string };
/** Printed IBAN when valid (spaces removed, upper case); else built from account/bank_code ("19-2000145399" = prefix 19); mod-11 failure → invalid. */
export function payToIban(payTo: PayToAccount | null): PayToResult;
```
`none` when `payTo` is null or has neither a non-empty `iban` nor both `account` and `bank_code`. `bankCode` = IBAN chars 4–8. Commit `0121 step 1`.

2. `spayd.ts`:
```ts
export interface SpaydInput { readonly iban: string; readonly bic?: string; readonly amount: Money; readonly vs?: string; readonly ks?: string; readonly ss?: string; readonly dueDate?: LegalDate; readonly message?: string; readonly recipientName?: string }
/** NFD, combining marks removed, `*` → `%2A`, whitespace collapsed, trimmed; case kept. */
export function spaydFold(s: string): string;
/** Digits of `vs` when 1–10 of them; else digits of `documentNumber` when 1–10; else undefined. */
export function spaydSymbol(vs: string | null, documentNumber: string | null): string | undefined;
/** Uppercase 8-hex CRC32 of ['SPD*1.0', ...attrs sorted].join('*'); attrs are `KEY:VALUE` without CRC32. */
export function spaydCrc32(attrs: readonly string[]): string;
/** `today` decides whether DT is written (omitted when dueDate < today); without `today` DT is always written. Throws RangeError unless amount.currency === 'CZK'. */
export function buildSpayd(i: SpaydInput, today?: LegalDate): string;
```
Attributes: `ACC:{iban}` + (`+{bic}` when given), `AM:{toFixed2}`, `CC:CZK`, `DT:{YYYYMMDD}`, `MSG:{fold, slice 0..60}`, `RN:{fold, slice 0..35}`, `X-KS`, `X-SS`, `X-VS` (symbols only when 1–10 digits). Output: `['SPD*1.0', ...sorted, 'CRC32:' + crc].join('*')`. Commit `0121 step 2`.

3. `checks.ts`:
```ts
export type CheckSeverity = 'ok' | 'info' | 'warning' | 'blocking';
export type CheckCode = 'ALREADY_PAID' | 'NO_ACCOUNT' | 'ACCOUNT_INVALID' | 'UNRELIABLE_PAYER' | 'ACCOUNT_NOT_PUBLISHED' | 'ACCOUNT_CHANGED' | 'REGISTRY_UNAVAILABLE' | 'FOREIGN_CURRENCY' | 'REGISTRY_OK';
export interface PaymentCheck { readonly code: CheckCode; readonly severity: CheckSeverity }
export type RegistryLookup =
  | { readonly status: 'ok'; readonly fetchedAt: string; readonly subject: { readonly unreliable: boolean; readonly vatPayer: boolean; readonly publishedIbans: readonly string[] } | null }
  | { readonly status: 'unavailable' } | { readonly status: 'skipped' };
/** Structural mirror of @shoebox/registries CrpdphSubject (no package dependency). */
export interface CrpdphSubjectLike { readonly nespolehlivyPlatce: 'ANO' | 'NE' | 'NENALEZEN'; readonly typSubjektu: string; readonly zverejneneUcty: readonly { readonly datumZverejneniUkonceni: string | null; readonly ucet: { kind: 'standard'; predcisli: string | null; cislo: string; kodBanky: string } | { kind: 'nonstandard'; cislo: string } }[] }
export function toRegistryLookup(subject: CrpdphSubjectLike | undefined, fetchedAt: string): RegistryLookup; // active accounts only (no end date); standard → czAccountToIban (skip nulls), nonstandard → cislo without spaces, upper
export interface PrePaymentInput { readonly paidAt: string | null; readonly openAmount: Money; readonly totalGross: Money; readonly payTo: PayToAccount | null; readonly orgVatStatus: 'neplatce' | 'identifikovana_osoba' | 'platce'; readonly registry: RegistryLookup; readonly earlierIbans: readonly string[]; readonly thresholdCzk: number; readonly toleranceCzk: string }
export interface PrePaymentResult { readonly checks: readonly PaymentCheck[]; readonly blocking: boolean; readonly iban: string | null; readonly bic: string | undefined; readonly qrAllowed: boolean }
export function prePaymentChecks(i: PrePaymentInput): PrePaymentResult;
```
Order of evaluation and of the output: FOREIGN_CURRENCY (openAmount.currency !== 'CZK'); ALREADY_PAID (`paidAt !== null` or `openAmount.compare(Money.parse(toleranceCzk, openAmount.currency)) <= 0`); NO_ACCOUNT / ACCOUNT_INVALID from `payToIban`; REGISTRY_UNAVAILABLE; UNRELIABLE_PAYER; ACCOUNT_NOT_PUBLISHED (`vatPayer && orgVatStatus === 'platce' && iban !== null && !publishedIbans.includes(iban)`; blocking when `totalGross.currency === 'CZK' && totalGross.compare(Money.parse(`${thresholdCzk}.00`, CZK)) > 0`); REGISTRY_OK (`status ok`, subject, `vatPayer`, not unreliable, iban published); ACCOUNT_CHANGED (`iban !== null && earlierIbans.length > 0 && !earlierIbans.includes(iban)`). `blocking` = any blocking; `qrAllowed = !blocking && iban !== null && openAmount.currency === 'CZK'`; `bic = bicForBankCode(bankCode)`. `index.ts` + `src/index.ts` export. Commit `0121 step 3`.

4. Tests. `packages/bank/test/spayd.test.ts`, verbatim:
```ts
import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { readBarcodes, writeBarcode } from 'zxing-wasm/full';
import { bicForBankCode } from '../src/pay/bic';
import { buildSpayd, spaydCrc32, spaydFold, spaydSymbol } from '../src/pay/spayd';

const czk = (s: string) => Money.parse(s, CZK);
const D = parseLegalDate;
const FIO = 'CZ8720100000002400123455';
const EXAMPLE = { iban: 'CZ6508000000192000145399', bic: 'GIBACZPX', amount: czk('480.50'), vs: '1234567890', message: 'Faktura 2026001' };
const FULL = { iban: FIO, bic: 'FIOBCZPP', amount: czk('1210.00'), vs: '2026001', ks: '0308', ss: '55', dueDate: D('2026-03-15'), message: 'Úhrada FV2026001', recipientName: 'ACME s.r.o.' };

describe('spaydCrc32', () => {
  it('signs header + sorted attributes joined by * (same as the reader)', () => {
    expect(spaydCrc32(['ACC:CZ6508000000192000145399+GIBACZPX', 'AM:480.50', 'CC:CZK', 'X-VS:1234567890', 'MSG:Faktura 2026001'])).toBe('A479C1F2');
  });
});

describe('spaydFold / spaydSymbol / bic', () => {
  it('folds diacritics, encodes * and keeps case', () => {
    expect(spaydFold('Úhrada  A*B ')).toBe('Uhrada A%2AB');
  });
  it('picks the VS, then the document number, else nothing', () => {
    expect(spaydSymbol('VS 2026001', null)).toBe('2026001');
    expect(spaydSymbol(null, 'FV-2026/001')).toBe('2026001');
    expect(spaydSymbol('12345678901', 'FV-2026/001')).toBe('2026001');
    expect(spaydSymbol(null, 'FV-20260001234')).toBeUndefined();
    expect(spaydSymbol('', null)).toBeUndefined();
  });
  it('knows the listed bank codes only', () => {
    expect([bicForBankCode('0800'), bicForBankCode('2010'), bicForBankCode('9999')]).toEqual(['GIBACZPX', 'FIOBCZPP', undefined]);
  });
});

describe('buildSpayd', () => {
  it('research §5.1 example: keys alphabetical, CRC32 last (A13)', () => {
    expect(buildSpayd(EXAMPLE)).toBe('SPD*1.0*ACC:CZ6508000000192000145399+GIBACZPX*AM:480.50*CC:CZK*MSG:Faktura 2026001*X-VS:1234567890*CRC32:A479C1F2');
  });
  it('full set with due date and symbols', () => {
    expect(buildSpayd(FULL, D('2026-03-01'))).toBe(`SPD*1.0*ACC:${FIO}+FIOBCZPP*AM:1210.00*CC:CZK*DT:20260315*MSG:Uhrada FV2026001*RN:ACME s.r.o.*X-KS:0308*X-SS:55*X-VS:2026001*CRC32:05A85966`);
  });
  it('omits DT when the due date is in the past', () => {
    expect(buildSpayd(FULL, D('2026-04-01'))).toBe(`SPD*1.0*ACC:${FIO}+FIOBCZPP*AM:1210.00*CC:CZK*MSG:Uhrada FV2026001*RN:ACME s.r.o.*X-KS:0308*X-SS:55*X-VS:2026001*CRC32:E29071C2`);
  });
  it('encodes * in the message, drops an over-long VS, no BIC when none is given', () => {
    expect(buildSpayd({ iban: FIO, bic: 'FIOBCZPP', amount: czk('5.00'), vs: '12345', message: 'Uhrada A*B' })).toBe(`SPD*1.0*ACC:${FIO}+FIOBCZPP*AM:5.00*CC:CZK*MSG:Uhrada A%2AB*X-VS:12345*CRC32:CEF7024D`);
    expect(buildSpayd({ iban: FIO, bic: 'FIOBCZPP', amount: czk('5.00'), vs: '12345678901', message: 'Uhrada A*B' })).not.toContain('X-VS');
    expect(buildSpayd({ iban: 'CZ6508000000192000145399', amount: czk('100.00'), message: 'Uhrada X' })).toBe('SPD*1.0*ACC:CZ6508000000192000145399*AM:100.00*CC:CZK*MSG:Uhrada X*CRC32:2A807489');
  });
  it('truncates MSG to 60 and RN to 35', () => {
    expect(buildSpayd({ iban: FIO, bic: 'FIOBCZPP', amount: czk('1.00'), message: 'a'.repeat(70), recipientName: 'b'.repeat(40) })).toBe(`SPD*1.0*ACC:${FIO}+FIOBCZPP*AM:1.00*CC:CZK*MSG:${'a'.repeat(60)}*RN:${'b'.repeat(35)}*CRC32:79345A68`);
  });
  it('refuses a non-CZK amount', () => {
    expect(() => buildSpayd({ iban: FIO, amount: Money.parse('10.00', 'EUR') })).toThrow(RangeError);
  });
  it('A13: survives a QR write and read with zxing-wasm', async () => {
    const s = buildSpayd(EXAMPLE);
    const w = await writeBarcode(s, { format: 'QRCode', ecLevel: 'M', scale: 4 });
    if (w.image === null) throw new Error(w.error);
    const r = await readBarcodes(new Uint8Array(await w.image.arrayBuffer()), { formats: ['QRCode'] });
    expect(r[0]?.text).toBe(s);
  });
});
```
`packages/bank/test/pre-payment.test.ts`, verbatim:
```ts
import { CZK, Money } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { payToIban } from '../src/pay/account';
import { type PrePaymentInput, prePaymentChecks, toRegistryLookup } from '../src/pay/checks';

const czk = (s: string) => Money.parse(s, CZK);
const FIO = 'CZ8720100000002400123455';
const CS = 'CZ4608000010031234567899';
const codes = (r: ReturnType<typeof prePaymentChecks>) => r.checks.map((c) => `${c.code}:${c.severity}`);

function input(over: Partial<PrePaymentInput> = {}): PrePaymentInput {
  return {
    paidAt: null, openAmount: czk('1210.00'), totalGross: czk('1210.00'),
    payTo: { account: '2400123455', bank_code: '2010', iban: null, bic: null },
    orgVatStatus: 'platce',
    registry: { status: 'ok', fetchedAt: '2026-03-01T10:42:00Z', subject: { unreliable: false, vatPayer: true, publishedIbans: [FIO] } },
    earlierIbans: [], thresholdCzk: 270_000, toleranceCzk: '1.00', ...over,
  };
}

describe('payToIban', () => {
  it('prefers a valid printed IBAN, else builds one, else invalid or none', () => {
    expect(payToIban({ iban: 'cz87 2010 0000 0024 0012 3455' })).toEqual({ kind: 'ok', iban: FIO, bankCode: '2010' });
    expect(payToIban({ account: '1003-1234567899', bank_code: '0800' })).toEqual({ kind: 'ok', iban: CS, bankCode: '0800' });
    expect(payToIban({ account: '705-1234567890', bank_code: '0710' })).toEqual({ kind: 'invalid' });
    expect(payToIban({ iban: 'CZ0000000000000000000000' })).toEqual({ kind: 'invalid' });
    expect(payToIban(null)).toEqual({ kind: 'none' });
    expect(payToIban({ account: '', bank_code: null })).toEqual({ kind: 'none' });
  });
});

describe('prePaymentChecks (A15)', () => {
  it('all good: one ok row, QR allowed, BIC from the table', () => {
    const r = prePaymentChecks(input());
    expect(codes(r)).toEqual(['REGISTRY_OK:ok']);
    expect(r).toMatchObject({ blocking: false, iban: FIO, bic: 'FIOBCZPP', qrAllowed: true });
  });
  it('unreliable payer: blocking for platce, warning for neplatce', () => {
    const reg = { status: 'ok' as const, fetchedAt: 'x', subject: { unreliable: true, vatPayer: true, publishedIbans: [FIO] } };
    const a = prePaymentChecks(input({ registry: reg }));
    expect(codes(a)).toEqual(['UNRELIABLE_PAYER:blocking']);
    expect(a.qrAllowed).toBe(false);
    const b = prePaymentChecks(input({ registry: reg, orgVatStatus: 'neplatce' }));
    expect(codes(b)).toEqual(['UNRELIABLE_PAYER:warning']);
    expect(b.qrAllowed).toBe(true);
  });
  it('unpublished account: blocking above the §109 threshold, warning below', () => {
    const reg = { status: 'ok' as const, fetchedAt: 'x', subject: { unreliable: false, vatPayer: true, publishedIbans: [CS] } };
    expect(codes(prePaymentChecks(input({ registry: reg, totalGross: czk('300000.00'), openAmount: czk('300000.00') })))).toEqual(['ACCOUNT_NOT_PUBLISHED:blocking']);
    expect(codes(prePaymentChecks(input({ registry: reg })))).toEqual(['ACCOUNT_NOT_PUBLISHED:warning']);
    expect(codes(prePaymentChecks(input({ registry: reg, orgVatStatus: 'neplatce' })))).toEqual([]);
  });
  it('registry outage is a warning only', () => {
    const r = prePaymentChecks(input({ registry: { status: 'unavailable' } }));
    expect(codes(r)).toEqual(['REGISTRY_UNAVAILABLE:warning']);
    expect(r.qrAllowed).toBe(true);
  });
  it('paid or nothing open blocks', () => {
    expect(codes(prePaymentChecks(input({ paidAt: '2026-03-02' })))).toEqual(['ALREADY_PAID:blocking', 'REGISTRY_OK:ok']);
    expect(codes(prePaymentChecks(input({ openAmount: czk('0.50') })))).toEqual(['ALREADY_PAID:blocking', 'REGISTRY_OK:ok']);
  });
  it('no account or an invalid one blocks', () => {
    expect(codes(prePaymentChecks(input({ payTo: null })))).toEqual(['NO_ACCOUNT:blocking']);
    const r = prePaymentChecks(input({ payTo: { account: '705-1234567890', bank_code: '0710' } }));
    expect(codes(r)).toEqual(['ACCOUNT_INVALID:blocking']);
    expect(r.iban).toBeNull();
  });
  it('foreign currency: info, no QR, not blocking', () => {
    const r = prePaymentChecks(input({ openAmount: Money.parse('10.00', 'EUR'), totalGross: Money.parse('10.00', 'EUR') }));
    expect(codes(r)).toEqual(['FOREIGN_CURRENCY:info', 'REGISTRY_OK:ok']);
    expect(r).toMatchObject({ blocking: false, qrAllowed: false });
  });
  it('account differs from earlier payments to this partner', () => {
    expect(codes(prePaymentChecks(input({ earlierIbans: [CS] })))).toEqual(['REGISTRY_OK:ok', 'ACCOUNT_CHANGED:warning']);
    expect(codes(prePaymentChecks(input({ earlierIbans: [CS, FIO] })))).toEqual(['REGISTRY_OK:ok']);
  });
});

describe('toRegistryLookup', () => {
  it('maps a CRPDPH subject, active accounts only', () => {
    const r = toRegistryLookup({
      nespolehlivyPlatce: 'NE', typSubjektu: 'PLATCE_DPH',
      zverejneneUcty: [
        { datumZverejneniUkonceni: null, ucet: { kind: 'standard', predcisli: null, cislo: '2400123455', kodBanky: '2010' } },
        { datumZverejneniUkonceni: '2025-01-01', ucet: { kind: 'standard', predcisli: '1003', cislo: '1234567899', kodBanky: '0800' } },
        { datumZverejneniUkonceni: null, ucet: { kind: 'nonstandard', cislo: 'de89 3704 0044 0532 0130 00' } },
      ],
    }, '2026-03-01T10:42:00Z');
    expect(r).toEqual({ status: 'ok', fetchedAt: '2026-03-01T10:42:00Z', subject: { unreliable: false, vatPayer: true, publishedIbans: [FIO, 'DE89370400440532013000'] } });
    expect(toRegistryLookup(undefined, 'x')).toEqual({ status: 'ok', fetchedAt: 'x', subject: null });
  });
});
```
`vatPayer` = `typSubjektu === 'PLATCE_DPH'`; `unreliable` = `nespolehlivyPlatce === 'ANO'`. Run `pnpm --filter @shoebox/bank exec vitest run test/spayd.test.ts test/pre-payment.test.ts 2>&1 | tail -30` → pass. Commit `0121 step 4`.

## 5. Do not touch

The matcher, parsers, `apps/`, `packages/registries`, `en.json`. No float anywhere; no `Number(amount)`.

## 6. Commands

`pnpm install --offline 2>&1 | tail -5`; the vitest command above; `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -30`; `pnpm biome check packages/bank 2>&1 | tail -5` → 0 errors (no `!` non-null assertions).

## 7. Acceptance

- [ ] Both test files pass unchanged. - [ ] `buildSpayd(EXAMPLE)` verifies with `parseQrPayload` from `@shoebox/extraction` (state in the report; do not add the dependency). - [ ] `bank` has no runtime dependency on `zxing-wasm` (dev only).

## 8. Stop and ask

Stop and write the report if a test fails twice, `czAccountToIban` disagrees with the hard-coded IBANs, the zxing round trip cannot load its wasm offline (report the error; the other tests still must pass), or you reach 25 tool calls / 50k tokens.

## 9. Report

`docs/tasks/0121-report.md` (600 tokens at most), `Status: review`: files changed, each command with its last 5 lines, deviations.
