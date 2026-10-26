# 0108: Statement format detection and the GPC/ABO parser

Status: done
Ticket: P2-BANK-02 | Depends on: 0107 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Recognise which kind of bank statement file the user dropped (GPC/ABO, CAMT.053 XML, MT940, PDF, or something else) and read GPC/ABO files, the format almost every Czech bank exports, into signed transactions with a balance check. This is the first real bank import format.

## 2. Context

M07 §4.2 (detection, steps used here): reject > 10 MB (`bank.import.too_large`). Encoding: UTF-8 BOM → utf-8; valid UTF-8 → utf-8; else windows-1250. XML whose root or namespace contains `camt.053` / `BkToCstmrStmt` → `camt053` (version from `urn:iso:std:iso:20022:tech:xsd:camt.053.001.NN`). Text with lines starting `:20:` and containing `:25:` and `:61:` → `mt940` (`.sta` extension raises confidence). First non-empty line starts with `074` and length 128 (± CR/LF) → `gpc`. PDF → `unsupported_pdf`. Nothing matched → `csv_generic` (the CSV wizard comes later).

M07 §4.3: parsers output signed amounts in account currency (+ incoming, − outgoing) and never throw on a bad row: the row is skipped with a `ParseWarning { line, code, raw }`.

M07 §4.3.1 GPC: positions are 1-based, record = 128 chars; numbers zero-padded, text space-padded, amounts in haléře, dates `DDMMYY`.
- **074 header**: 4–19 client account (edicni: prefix 6 + number 10); 20–39 account name; 40–45 old balance date (`periodFrom` = that date + 1 day for profile `gpc_fio`, the date itself for `gpc_generic`); 46–59 old balance + 60 sign (`+`/`-`); 61–74 new balance + 75 sign; 76–89 debit turnover + 90 sign; 91–104 credit turnover + 105 sign; 106–108 statement number; 109–114 posting date (`periodTo`); 115–128 filler.
- **075 transaction**: 4–19 client account (must equal the 074 account); 20–35 counter-account (all zeros → none); 36–48 transaction id (`externalId = 'gpc:' + id` without leading zeros for `gpc_fio` when not all zeros; `gpc_generic` sets no externalId); 49–60 amount in haléře; 61 posting code; 62–71 VS; 72–81 KS field (`gpc_fio`: `00` + counterparty bank code 4 + KS 4; `gpc_generic`: plain KS 10); 82–91 SS; 92–97 valuta (`000000` → none); 98–117 counterparty name (trimmed); 118 change code (ignored); 119–122 currency (last 3 digits ISO 4217 numeric); 123–128 booking date (`000000` → valuta; if also none → 074 posting date).
- **078/079** lines after a 075: their text after the first 3 chars, trimmed, is appended to that transaction's `message` (joined with one space).
- **Posting codes** (both profiles): `1` → −amount; `2` → +amount; `4` → +amount, `isReversal`; `5` → −amount, `isReversal`.
- **Balance check**: opening + Σ amount = closing, Σ |negative amounts| = |debit turnover| and Σ positive amounts = |credit turnover| → `'ok'`, else `'mismatch'`.

Helpers from 0107 (`packages/bank/src/normalize.ts`): `parseSymbol`, `parseAccount`, `decodeGpcAccount`, `parseDdmmyy`. Types in `packages/bank/src/types.ts`: `ParsedStatement`, `CanonicalTx`, `ParseWarning`, `StatementFormat`. From `@shoebox/domain`: `Money` (`Money.parse(text, currency)`, `.add`, `.negate`, `.abs`, `.equals`, `.isNegative`, `.isPositive`, `Money.zero(currency)`, `Money.sum(items, currency)`), `addDays(date, days)`.

Fix from 0107 review: in `packages/bank/test/normalize.test.ts` the NBSP cases lost their escapes. Lines today:
```ts
    ['1 234,56', '1234.56'],
    ['1 234,56', '1234.56'],
    ['1 234,5', '1234.5'],
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/bank/test/normalize.test.ts` | edit | restore two escapes only |
| `packages/bank/src/detect.ts` | new | detection and decoding |
| `packages/bank/src/parsers/gpc.ts` | new | GPC parser |
| `packages/bank/src/index.ts` | edit | re-export |
| `packages/bank/test/detect.test.ts` | new | verbatim below |
| `packages/bank/test/gpc.test.ts` | new | verbatim below |

No other file may change.

## 4. Steps

1. `normalize.test.ts`: the second of the three lines above becomes `    ['1 234,56', '1234.56'],` and the third becomes `    ['1 234,5', '1234.5'],` (the six characters backslash-u-0-0-a-0 typed literally in the source, so the string holds the NBSP). Run `pnpm --filter @shoebox/bank test -- normalize 2>&1 | tail -5` → pass (if it fails, `parseAmount` must also strip ` ` and ` `; fix `normalize.ts` then, and say so in the report). Commit `0108 step 1`.

2. New `packages/bank/src/detect.ts` with exactly these exports; implement until step 3's tests pass:
```ts
import type { StatementFormat } from './types';

export type DetectedFormat = StatementFormat | 'unsupported_pdf';
export type TextEncoding = 'utf-8' | 'windows-1250';
export interface DetectionResult {
  format: DetectedFormat;
  /** 0..1 */
  confidence: number;
  encoding: TextEncoding;
  /** CAMT.053 only: the two-digit version, e.g. '08'. */
  camtVersion?: string;
}
export const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;
export class StatementTooLargeError extends Error {
  readonly code = 'bank.import.too_large';
}
export function detectEncoding(bytes: Uint8Array): TextEncoding;
/** Decodes the whole file; drops a UTF-8 BOM. */
export function decodeText(bytes: Uint8Array, encoding: TextEncoding): string;
export function detectStatementFormat(bytes: Uint8Array, filename?: string): DetectionResult;
```
Rules: `bytes.length > MAX_STATEMENT_BYTES` → throw `StatementTooLargeError`. `detectEncoding`: BOM `EF BB BF` or `new TextDecoder('utf-8', { fatal: true })` succeeds → `'utf-8'`, else `'windows-1250'`. In `detectStatementFormat`, check in this order on the decoded text (first 65 536 characters): starts with `%PDF` → `unsupported_pdf`, 1; trimmed text starts with `<` and contains `camt.053` or `BkToCstmrStmt` → `camt053`, 1, `camtVersion` from `/camt\.053\.001\.(\d{2})/` when found; some line starts with `:20:` and the text contains `:25:` and `:61:` → `mt940`, 1 when `filename` ends with `.sta` (any case), else 0.9; first non-empty line (CR stripped) starts with `074` and has length 128 → `gpc`, 1; else `csv_generic`, 0. Commit `0108 step 2`.

3. New `packages/bank/test/detect.test.ts`, verbatim; run `pnpm --filter @shoebox/bank test -- detect 2>&1 | tail -30` → pass. Commit `0108 step 3`.
```ts
import { describe, expect, it } from 'vitest';
import {
  decodeText,
  detectEncoding,
  detectStatementFormat,
  MAX_STATEMENT_BYTES,
  StatementTooLargeError,
} from '../src/detect';

const bytes = (text: string) => new TextEncoder().encode(text);
const GPC_074 = `074${'0'.repeat(6)}2400123455${'SYSEL TEST'.padEnd(20)}${'0'.repeat(89)}`;

describe('detectEncoding / decodeText', () => {
  it('reads plain ASCII and UTF-8 as utf-8', () => {
    expect(detectEncoding(bytes('hello'))).toBe('utf-8');
    expect(detectEncoding(bytes('Žluťoučký'))).toBe('utf-8');
  });

  it('falls back to windows-1250 and decodes it', () => {
    const cp1250 = new Uint8Array([0x8e, 0x4c, 0x55, 0x8d, 0x4f, 0x55, 0xc8, 0x4b, 0xdd]);
    expect(detectEncoding(cp1250)).toBe('windows-1250');
    expect(decodeText(cp1250, 'windows-1250')).toBe('ŽLUŤOUČKÝ');
  });

  it('drops a UTF-8 BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('074')]);
    expect(detectEncoding(withBom)).toBe('utf-8');
    expect(decodeText(withBom, 'utf-8')).toBe('074');
  });
});

describe('detectStatementFormat', () => {
  it('finds GPC by its 128-char 074 header', () => {
    expect(GPC_074).toHaveLength(128);
    expect(detectStatementFormat(bytes(`\r\n${GPC_074}\r\n`))).toEqual({
      format: 'gpc',
      confidence: 1,
      encoding: 'utf-8',
    });
  });

  it('does not take a short 074 line for GPC', () => {
    expect(detectStatementFormat(bytes('074 short line')).format).toBe('csv_generic');
  });

  it('finds CAMT.053 and its version', () => {
    const xml =
      '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt/></Document>';
    expect(detectStatementFormat(bytes(xml))).toEqual({
      format: 'camt053',
      confidence: 1,
      encoding: 'utf-8',
      camtVersion: '08',
    });
  });

  it('finds MT940, surer with a .sta name', () => {
    const sta =
      ':20:STMT\n:25:2400123455/2010\n:28C:1\n:60F:C260914CZK10000,00\n:61:2609150915C12100,00NTRFNONREF//123\n:62F:C260915CZK22100,00\n';
    expect(detectStatementFormat(bytes(sta), 'vypis.STA').confidence).toBe(1);
    expect(detectStatementFormat(bytes(sta), 'vypis.txt')).toEqual({
      format: 'mt940',
      confidence: 0.9,
      encoding: 'utf-8',
    });
  });

  it('marks a PDF as unsupported', () => {
    expect(detectStatementFormat(bytes('%PDF-1.7\n...')).format).toBe('unsupported_pdf');
  });

  it('leaves anything else to the CSV wizard', () => {
    expect(detectStatementFormat(bytes('a;b;c\n1;2;3\n'))).toEqual({
      format: 'csv_generic',
      confidence: 0,
      encoding: 'utf-8',
    });
  });

  it('rejects files over 10 MB', () => {
    expect(() => detectStatementFormat(new Uint8Array(MAX_STATEMENT_BYTES + 1))).toThrow(
      StatementTooLargeError,
    );
  });
});
```

4. New `packages/bank/src/parsers/gpc.ts` with exactly these exports; implement until step 5's tests pass:
```ts
import type { ParsedStatement } from '../types';

export const GPC_PARSER_VERSION = 1;
export type GpcProfile = 'gpc_fio' | 'gpc_generic';
export interface GpcOptions {
  /** Default 'gpc_generic'. */
  profile?: GpcProfile;
  /** Account currency; default 'CZK'. */
  currency?: string;
}
export function parseGpc(text: string, options?: GpcOptions): ParsedStatement;
```
Rules beyond §2:
- Split on `/\r?\n/`, skip empty lines; `line` in warnings is the 1-based line number in the file.
- Haléře → Money by string work only: strip leading zeros, left-pad to at least 3 digits, insert `.` before the last 2 digits, prefix `-` when the sign is `-`, then `Money.parse`. Never `Number`.
- A 075/074 line that is not exactly 128 chars, or any line whose type is not 074/075/078/079 → warning `gpc.bad_line`, skipped. Unknown posting code → `gpc.posting_code`, skipped. 075 account ≠ 074 account → `gpc.account_mismatch`, skipped. No booking date at all → `gpc.no_date`, skipped. A file currency (map `203` CZK, `978` EUR, `840` USD, `826` GBP, `985` PLN, `348` HUF, `756` CHF; `000` or unknown → no check) different from the account currency → warning `gpc.currency_mismatch`, row kept in the account currency.
- Counterparty: `account` = `decodeGpcAccount` (none when all zeros); for `gpc_fio` `bankCode` = KS field chars 3–6 unless `0000`; when both exist and `parseAccount(account + '/' + bankCode)` is not null, take its `iban` too. `name` = trimmed name field, omitted when empty.
- `raw` = `{ line: <line number>, code: <posting code> }`.
- `statementNumber` = the 3 digits with leading zeros stripped (`'0'` stays `'0'`). `account` = `{ account: <decoded 074 account>, currency }`. `format: 'gpc'`, `parserVersion: GPC_PARSER_VERSION`, `profile`.
- No 074 header at all → return an empty statement with warning `gpc.no_header`.
Commit `0108 step 4`.

5. New `packages/bank/test/gpc.test.ts`, verbatim; run `pnpm --filter @shoebox/bank test -- gpc 2>&1 | tail -30` → pass. Commit `0108 step 5`.
```ts
import { describe, expect, it } from 'vitest';
import { parseGpc } from '../src/parsers/gpc';

const z = (v: string, n: number) => v.padStart(n, '0');
const t = (v: string, n: number) => v.padEnd(n, ' ').slice(0, n);
const OWN = '0000002400123455';

function h074(o: { opening: string; closing: string; debit: string; credit: string }): string {
  return (
    `074${OWN}${t('SYSEL TEST', 20)}140926` +
    `${z(o.opening, 14)}+${z(o.closing, 14)}+${z(o.debit, 14)}-${z(o.credit, 14)}+` +
    `007300926${' '.repeat(14)}`
  );
}

function r075(o: {
  counter?: string;
  id?: string;
  halere: string;
  code: string;
  vs?: string;
  ks?: string;
  ss?: string;
  valuta?: string;
  name?: string;
  currency?: string;
  date?: string;
  account?: string;
}): string {
  return (
    `075${o.account ?? OWN}${z(o.counter ?? '', 16)}${z(o.id ?? '', 13)}${z(o.halere, 12)}${o.code}` +
    `${z(o.vs ?? '', 10)}${z(o.ks ?? '', 10)}${z(o.ss ?? '', 10)}${o.valuta ?? '000000'}` +
    `${t(o.name ?? '', 20)}0${o.currency ?? '0203'}${o.date ?? '000000'}`
  );
}

const IN = r075({
  counter: '0010031234567899',
  id: '12345678',
  halere: '1210000',
  code: '2',
  vs: '2026001',
  ks: '0008000308',
  valuta: '150926',
  name: 'ODBERATEL SRO',
  date: '150926',
});
const OUT = r075({ id: '12345679', halere: '121050', code: '1', name: 'Platba kartou', date: '160926' });
const STORNO = r075({ id: '12345680', halere: '10000', code: '4', valuta: '170926' });
const HEAD = h074({ opening: '1000000', closing: '2098950', debit: '121050', credit: '1220000' });
const FILE = [HEAD, IN, OUT, '078NAKUP: KAVARNA PRAHA', STORNO].join('\r\n');

describe('parseGpc', () => {
  it('builds 128-char records', () => {
    for (const line of [HEAD, IN, OUT, STORNO]) expect(line).toHaveLength(128);
  });

  it('reads the Fio profile: header, signs, symbols, reversal, message', () => {
    const s = parseGpc(FILE, { profile: 'gpc_fio' });
    expect(s.warnings).toEqual([]);
    expect(s.format).toBe('gpc');
    expect(s.profile).toBe('gpc_fio');
    expect(s.account).toEqual({ account: '2400123455', currency: 'CZK' });
    expect(s.periodFrom).toBe('2026-09-15');
    expect(s.periodTo).toBe('2026-09-30');
    expect(s.statementNumber).toBe('7');
    expect(s.openingBalance?.toString()).toBe('10000');
    expect(s.closingBalance?.toString()).toBe('20989.5');
    expect(s.balanceCheck).toBe('ok');
    expect(s.txs).toHaveLength(3);

    const [inc, out, storno] = s.txs;
    expect(inc?.amount.toString()).toBe('12100');
    expect(inc?.externalId).toBe('gpc:12345678');
    expect(inc?.bookedOn).toBe('2026-09-15');
    expect(inc?.valueDate).toBe('2026-09-15');
    expect(inc?.vs).toBe('2026001');
    expect(inc?.ks).toBe('308');
    expect(inc?.ss).toBeUndefined();
    expect(inc?.counterparty).toEqual({
      account: '1003-1234567899',
      bankCode: '0800',
      iban: 'CZ4608000010031234567899',
      name: 'ODBERATEL SRO',
    });

    expect(out?.amount.toString()).toBe('-1210.5');
    expect(out?.counterparty).toEqual({ name: 'Platba kartou' });
    expect(out?.vs).toBeUndefined();
    expect(out?.message).toBe('NAKUP: KAVARNA PRAHA');
    expect(out?.isReversal).toBeFalsy();

    expect(storno?.amount.toString()).toBe('100');
    expect(storno?.isReversal).toBe(true);
    expect(storno?.bookedOn).toBe('2026-09-17');
  });

  it('reads the generic profile: plain KS, no external id, period from the balance date', () => {
    const s = parseGpc(FILE);
    expect(s.profile).toBe('gpc_generic');
    expect(s.periodFrom).toBe('2026-09-14');
    expect(s.txs[0]?.ks).toBe('8000308');
    expect(s.txs[0]?.externalId).toBeUndefined();
    expect(s.txs[0]?.counterparty.bankCode).toBeUndefined();
  });

  it('flags a balance mismatch', () => {
    const bad = [h074({ opening: '1000000', closing: '2098951', debit: '121050', credit: '1220000' }), IN, OUT, STORNO];
    expect(parseGpc(bad.join('\n'), { profile: 'gpc_fio' }).balanceCheck).toBe('mismatch');
  });

  it('skips bad rows with a warning and keeps the rest', () => {
    const odd = r075({ id: '9', halere: '100', code: '9', date: '150926' });
    const other = r075({ id: '8', halere: '100', code: '1', date: '150926', account: '0000002400123463' });
    const s = parseGpc([HEAD, 'garbage', IN, odd, other].join('\n'), { profile: 'gpc_fio' });
    expect(s.txs).toHaveLength(1);
    expect(s.warnings.map((w) => [w.line, w.code])).toEqual([
      [2, 'gpc.bad_line'],
      [4, 'gpc.posting_code'],
      [5, 'gpc.account_mismatch'],
    ]);
  });

  it('warns on a foreign currency code but keeps the row', () => {
    const eur = r075({ id: '7', halere: '100', code: '2', date: '150926', currency: '0978' });
    const s = parseGpc([HEAD, eur].join('\n'), { profile: 'gpc_fio' });
    expect(s.txs).toHaveLength(1);
    expect(s.txs[0]?.amount.currency).toBe('CZK');
    expect(s.warnings.map((w) => w.code)).toEqual(['gpc.currency_mismatch']);
  });

  it('returns an empty statement without a header', () => {
    const s = parseGpc(IN);
    expect(s.txs).toEqual([]);
    expect(s.warnings.map((w) => w.code)).toContain('gpc.no_header');
  });
});
```

6. `packages/bank/src/index.ts`: after `export * from './normalize';` add `export * from './detect';` and `export * from './parsers/gpc';`. Run typecheck. Commit `0108 step 6`.

## 5. Do not touch

Every other package and app; `normalize.ts` only if step 1 says so. Hard rules: money never via `Number`/`parseFloat`; no new dependency (no XML or CSV library); no real bank data in tests.

## 6. Commands

- `pnpm --filter @shoebox/bank test 2>&1 | tail -30` → all pass.
- `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -30` → no errors.
- `pnpm biome check packages/bank 2>&1 | tail -30` → clean (`--write` once for formatting only; formatting may re-wrap the test files, that is fine).

## 7. Acceptance

- [ ] Test files match §4 (formatter re-wrapping aside) and pass.
- [ ] `grep -nE "Number\(|parseFloat" packages/bank/src/parsers/gpc.ts packages/bank/src/detect.ts` shows no amount parsing.
- [ ] Typecheck and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong (say which assertion and why);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a file outside §3 needs a change;
- a step is unclear.

## 9. Report

Write `docs/tasks/0108-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you could not do, and why.
