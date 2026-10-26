# 0109: CAMT.053 and MT940 parsers, and parseStatement

Status: done
Ticket: P2-BANK-03 | Depends on: 0108 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Read the two other statement formats Czech banks export, CAMT.053 (XML) and MT940 (`.sta`), into the same signed transactions as the GPC parser, and add one `parseStatement` entry point that picks the parser from the detection result. Users of banks without GPC export can then import too.

## 2. Context

Types (`packages/bank/src/types.ts`): `ParsedStatement`, `CanonicalTx`, `AccountRef`. From 0107 `normalize.ts`: `parseAmount(text, currency)`, `parseAccount(text)`, `parseSymbol(text)`, `parseYymmdd(text)`, `symbolsFromText(text)`. From 0108: `detect.ts` (`DetectionResult`, `decodeText`), `parsers/gpc.ts` (`parseGpc(text, { profile, currency })`, `GpcProfile`). `Money` from `@shoebox/domain`.

A strict small XML reader already exists at `packages/extraction/src/isdoc/xml.ts` (refuses DOCTYPE/ENTITY, so no XXE). It exports `XmlElement { name (local, prefix dropped), ns, attrs, children, text }`, `XmlError`, `parseXml(input)`, `child(el, name)`, `childrenNamed(el, name)`, `at(el, ...path)`, `textAt(el, ...path)` (trimmed, '' when missing). `@shoebox/bank` must not depend on `@shoebox/extraction` (it pulls PDF libraries), so copy the file.

M07 §4.3.2 CAMT.053 (applied as written here):
- Statement = first `Document/BkToCstmrStmt/Stmt`. `Stmt/Id` → `statementNumber`; `FrToDt/FrDtTm` and `ToDtTm` (first 10 chars) → `periodFrom`/`periodTo`; `Acct/Id/IBAN` → `account` via `parseAccount`; `Acct/Ccy` → currency (else the option, else `CZK`). `Bal` whose `Tp/CdOrPrtry/Cd` is `OPBD`/`CLBD` → opening/closing (`CdtDbtInd` `DBIT` → negative).
- Each `Ntry`: `Sts/Cd` (or `Sts` text) other than `BOOK` → skipped, no warning. `Amt` (+ `Ccy` attribute) with `CdtDbtInd` (`CRDT` +, `DBIT` −); `RvslInd` = `true` → `isReversal`; `BookgDt/Dt` or `BookgDt/DtTm` (first 10 chars) → `bookedOn`; `ValDt/Dt|DtTm` → `valueDate`.
- `NtryDtls/TxDtls`: more than one, each with its own `Amt` (or `AmtDtls/TxAmt/Amt`) → one transaction per `TxDtls` with that amount and the entry's sign; otherwise one transaction per `Ntry` using the first `TxDtls` (if any) for details.
- `externalId` = `'camt:' + ref`, ref = first non-empty of `Ntry/AcctSvcrRef`, `Ntry/NtryRef`, `TxDtls/Refs/AcctSvcrRef`, `TxDtls/Refs/TxId`. For a split entry use the `TxDtls` refs (`AcctSvcrRef`, then `TxId`), else `<entry ref>:<1-based index>`.
- Counterparty: `CRDT` → `RltdPties/Dbtr` and `DbtrAcct`; `DBIT` → `Cdtr` and `CdtrAcct`. Name = `<party>/Nm` or `<party>/Pty/Nm`. Account = `Id/IBAN` or `Id/Othr/Id`, through `parseAccount`; when that is null and the value is non-empty keep `{ account: value }`.
- Symbols, in this order, first value per key wins: `RmtInf/Strd/CdtrRefInf/Ref` (1–10 digits only → VS), `Refs/EndToEndId` (1–10 digits only → VS), then `symbolsFromText` on each of those and on `RmtInf/Ustrd`. All `Ustrd` texts joined by one space → `message`.
- `AmtDtls/InstdAmt/Amt` with a `Ccy` different from the entry currency → `amountOriginal` in that currency, same sign as `amount`.
- Card: `BkTxCd/Domn/Fmly/Cd` is `CCRD` or `MCRD` → `cardMerchant` = counterparty name, else the first 40 chars of the message; `cardLast4` from `/(?:\*|XXXX)(\d{4})/` in the message.
- `raw` = `{ ref: <externalId or null> }`. Not well-formed XML → empty statement with warning `camt.bad_xml`.

M07 §4.3.3 MT940 (applied as written here): a field starts at a line beginning `:<tag>:` (tag = 2 digits + optional letter); following lines without a tag continue it. `:25:` → account (`parseAccount`, else `{ account: value }`); `:28C:` → `statementNumber`; `:60F:`/`:60M:` → `C|D` + `YYMMDD` + currency + amount (comma decimal) → `openingBalance`, `periodFrom` = that date, currency; `:62F:` → `closingBalance`, `periodTo`. Each `:61:` (first line) matches `^(\d{6})(\d{4})?(RC|RD|C|D)[A-Z]?(\d+,\d{0,2})(?:[NSF][A-Z0-9]{3})?([^/]*)(?:\/\/(.*))?$`: value date; optional entry date `MMDD` → `bookedOn` (year from the value date; value month 12 and entry month 01 → next year; value 01 and entry 12 → previous year), else `bookedOn` = value date; sign `C` +, `D` −, `RC` − with `isReversal`, `RD` + with `isReversal`; `//` bank reference (trimmed, non-empty) → `externalId = 'mt940:' + ref`. A `:61:` that does not match → warning `mt940.bad_line` (line = the tag's line). The `:86:` after a `:61:` (lines joined with no separator): when it contains `?NN` subfields, `?20`–`?29` concatenated → `message`, `?32` + `?33` → counterparty name, `?31` → counterparty account (`parseAccount`); otherwise the whole text → `message`. Symbols = `symbolsFromText(message)`. `raw` = `{ line: <line of the :61:> }`.

Both parsers: balance check `'ok'` when opening + Σ amount = closing, `'mismatch'` otherwise, undefined when a balance is missing.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/bank/src/xml.ts` | new | copy of `packages/extraction/src/isdoc/xml.ts`, first comment line adjusted |
| `packages/bank/src/parsers/camt053.ts` | new | CAMT.053 parser |
| `packages/bank/src/parsers/mt940.ts` | new | MT940 parser |
| `packages/bank/src/parse.ts` | new | `parseStatement` |
| `packages/bank/src/index.ts` | edit | re-export |
| `packages/bank/test/camt053.test.ts` | new | verbatim below |
| `packages/bank/test/mt940.test.ts` | new | verbatim below |
| `packages/bank/test/parse.test.ts` | new | verbatim below |

No other file may change.

## 4. Steps

1. `cp packages/extraction/src/isdoc/xml.ts packages/bank/src/xml.ts`, then change only its first comment line to ` * A small strict XML reader (copy of packages/extraction/src/isdoc/xml.ts for bank CAMT.053). Names are local (prefix dropped),`. Commit `0109 step 1`.

2. New `packages/bank/src/parsers/camt053.ts`:
```ts
import type { ParsedStatement } from '../types';
export const CAMT053_PARSER_VERSION = 1;
export function parseCamt053(text: string, options?: { currency?: string }): ParsedStatement;
```
Then step 3's test file; implement until it passes. Commit `0109 step 2` (parser + test together).

3. New `packages/bank/test/camt053.test.ts`, verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseCamt053 } from '../src/parsers/camt053';

const bal = (cd: string, amt: string) =>
  `<Bal><Tp><CdOrPrtry><Cd>${cd}</Cd></CdOrPrtry></Tp><Amt Ccy="CZK">${amt}</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
 <BkToCstmrStmt>
  <GrpHdr><MsgId>M1</MsgId></GrpHdr>
  <Stmt>
   <Id>7</Id>
   <FrToDt><FrDtTm>2026-09-15T00:00:00</FrDtTm><ToDtTm>2026-09-30T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>CZ8720100000002400123455</IBAN></Id><Ccy>CZK</Ccy></Acct>
   ${bal('OPBD', '10000.00')}
   ${bal('CLBD', '21289.50')}
   <Ntry>
    <NtryRef>A1</NtryRef><Amt Ccy="CZK">12100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>2026-09-15</Dt></BookgDt><ValDt><Dt>2026-09-15</Dt></ValDt>
    <AcctSvcrRef>12345678</AcctSvcrRef>
    <NtryDtls><TxDtls>
     <Refs><EndToEndId>2026001</EndToEndId></Refs>
     <RltdPties><Dbtr><Pty><Nm>ODBERATEL SRO</Nm></Pty></Dbtr><DbtrAcct><Id><IBAN>CZ4608000010031234567899</IBAN></Id></DbtrAcct></RltdPties>
     <RmtInf><Ustrd>/VS/2026001/KS/0308</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <Amt Ccy="CZK">1210.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><DtTm>2026-09-16T10:00:00</DtTm></BookgDt>
    <AcctSvcrRef>12345679</AcctSvcrRef>
    <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>MCRD</Cd><SubFmlyCd>POSD</SubFmlyCd></Fmly></Domn></BkTxCd>
    <NtryDtls><TxDtls>
     <AmtDtls><InstdAmt><Amt Ccy="EUR">48.00</Amt></InstdAmt></AmtDtls>
     <RmtInf><Ustrd>NAKUP: KAVARNA PRAHA *1234</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <Amt Ccy="CZK">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><RvslInd>true</RvslInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>2026-09-17</Dt></BookgDt><AcctSvcrRef>12345680</AcctSvcrRef>
   </Ntry>
   <Ntry>
    <Amt Ccy="CZK">50.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>PDNG</Cd></Sts>
    <BookgDt><Dt>2026-09-18</Dt></BookgDt>
   </Ntry>
   <Ntry>
    <Amt Ccy="CZK">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>2026-09-19</Dt></BookgDt><AcctSvcrRef>B1</AcctSvcrRef>
    <NtryDtls>
     <TxDtls><Refs><TxId>T1</TxId></Refs><Amt Ccy="CZK">100.00</Amt></TxDtls>
     <TxDtls><Refs><TxId>T2</TxId></Refs><Amt Ccy="CZK">200.00</Amt></TxDtls>
    </NtryDtls>
   </Ntry>
  </Stmt>
 </BkToCstmrStmt>
</Document>`;

describe('parseCamt053', () => {
  const s = parseCamt053(XML);

  it('reads the statement header and balances', () => {
    expect(s.warnings).toEqual([]);
    expect(s.format).toBe('camt053');
    expect(s.statementNumber).toBe('7');
    expect(s.periodFrom).toBe('2026-09-15');
    expect(s.periodTo).toBe('2026-09-30');
    expect(s.account).toEqual({
      account: '2400123455',
      bankCode: '2010',
      iban: 'CZ8720100000002400123455',
      currency: 'CZK',
    });
    expect(s.openingBalance?.toString()).toBe('10000');
    expect(s.closingBalance?.toString()).toBe('21289.5');
    expect(s.balanceCheck).toBe('ok');
  });

  it('skips the pending entry and splits the batch entry', () => {
    expect(s.txs.map((t) => t.amount.toString())).toEqual(['12100', '-1210.5', '100', '100', '200']);
    expect(s.txs.map((t) => t.externalId)).toEqual([
      'camt:12345678',
      'camt:12345679',
      'camt:12345680',
      'camt:T1',
      'camt:T2',
    ]);
  });

  it('reads counterparty and symbols of an incoming payment', () => {
    const inc = s.txs[0];
    expect(inc?.bookedOn).toBe('2026-09-15');
    expect(inc?.valueDate).toBe('2026-09-15');
    expect(inc?.vs).toBe('2026001');
    expect(inc?.ks).toBe('308');
    expect(inc?.message).toBe('/VS/2026001/KS/0308');
    expect(inc?.counterparty).toEqual({
      account: '1003-1234567899',
      bankCode: '0800',
      iban: 'CZ4608000010031234567899',
      name: 'ODBERATEL SRO',
    });
  });

  it('reads a card payment with its original currency', () => {
    const card = s.txs[1];
    expect(card?.bookedOn).toBe('2026-09-16');
    expect(card?.cardMerchant).toBe('NAKUP: KAVARNA PRAHA *1234');
    expect(card?.cardLast4).toBe('1234');
    expect(card?.amountOriginal?.toString()).toBe('-48');
    expect(card?.amountOriginal?.currency).toBe('EUR');
  });

  it('marks a reversal', () => {
    expect(s.txs[2]?.isReversal).toBe(true);
  });

  it('flags a balance mismatch', () => {
    expect(parseCamt053(XML.replace('21289.50', '21289.51')).balanceCheck).toBe('mismatch');
  });

  it('refuses a DOCTYPE and broken XML with a warning', () => {
    const evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Document/>';
    expect(parseCamt053(evil).warnings.map((w) => w.code)).toEqual(['camt.bad_xml']);
    expect(parseCamt053('<Document>').txs).toEqual([]);
  });
});
```

4. New `packages/bank/src/parsers/mt940.ts`:
```ts
import type { ParsedStatement } from '../types';
export const MT940_PARSER_VERSION = 1;
export function parseMt940(text: string, options?: { currency?: string }): ParsedStatement;
```
Then step 5's test file; implement until it passes. Commit `0109 step 4`.

5. New `packages/bank/test/mt940.test.ts`, verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseMt940 } from '../src/parsers/mt940';

const STA = [
  ':20:STMT7',
  ':25:2400123455/2010',
  ':28C:7',
  ':60F:C260914CZK10000,00',
  ':61:2609150915C12100,00NTRF12345678//12345678',
  ':86:?20/VS/2026001/KS/0308?32ODBERATEL SRO',
  '?31CZ4608000010031234567899',
  ':61:2609160916D1210,50NMSC//12345679',
  ':86:NAKUP: KAVARNA PRAHA',
  ':61:2609170917RD100,00NTRF//12345680',
  ':61:nonsense',
  ':62F:C260930CZK20989,50',
].join('\r\n');

describe('parseMt940', () => {
  const s = parseMt940(STA);

  it('reads header and balances', () => {
    expect(s.format).toBe('mt940');
    expect(s.statementNumber).toBe('7');
    expect(s.account).toEqual({
      account: '2400123455',
      bankCode: '2010',
      iban: 'CZ8720100000002400123455',
      currency: 'CZK',
    });
    expect(s.periodFrom).toBe('2026-09-14');
    expect(s.periodTo).toBe('2026-09-30');
    expect(s.openingBalance?.toString()).toBe('10000');
    expect(s.closingBalance?.toString()).toBe('20989.5');
    expect(s.balanceCheck).toBe('ok');
  });

  it('reads the same transactions as the GPC file of the period', () => {
    expect(s.txs.map((t) => t.amount.toString())).toEqual(['12100', '-1210.5', '100']);
    expect(s.txs.map((t) => t.externalId)).toEqual(['mt940:12345678', 'mt940:12345679', 'mt940:12345680']);
    const [inc, out, storno] = s.txs;
    expect(inc?.bookedOn).toBe('2026-09-15');
    expect(inc?.vs).toBe('2026001');
    expect(inc?.ks).toBe('308');
    expect(inc?.counterparty).toEqual({
      account: '1003-1234567899',
      bankCode: '0800',
      iban: 'CZ4608000010031234567899',
      name: 'ODBERATEL SRO',
    });
    expect(out?.message).toBe('NAKUP: KAVARNA PRAHA');
    expect(storno?.isReversal).toBe(true);
  });

  it('warns on a bad :61: line', () => {
    expect(s.warnings.map((w) => [w.line, w.code])).toEqual([[11, 'mt940.bad_line']]);
  });

  it('rolls the entry date over the year end', () => {
    const y = parseMt940(
      [':25:2400123455/2010', ':60F:C261231CZK0,00', ':61:2612310102C5,00NTRF//X1', ':62F:C270102CZK5,00'].join('\n'),
    );
    expect(y.txs[0]?.valueDate).toBe('2026-12-31');
    expect(y.txs[0]?.bookedOn).toBe('2027-01-02');
  });
});
```

6. New `packages/bank/src/parse.ts`:
```ts
import type { DetectionResult } from './detect';
import type { GpcProfile } from './parsers/gpc';
import type { ParsedStatement } from './types';

export class StatementFormatNeededError extends Error {
  readonly code = 'bank.import.format_needed';
}
/** Decodes with detection.encoding and calls the parser of detection.format; any other format throws StatementFormatNeededError. */
export function parseStatement(
  bytes: Uint8Array,
  detection: DetectionResult,
  options?: { currency?: string; gpcProfile?: GpcProfile },
): ParsedStatement;
```
New `packages/bank/test/parse.test.ts`, verbatim; implement until it passes. Commit `0109 step 6`.
```ts
import { describe, expect, it } from 'vitest';
import { detectStatementFormat } from '../src/detect';
import { parseStatement, StatementFormatNeededError } from '../src/parse';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('parseStatement', () => {
  it('dispatches MT940', () => {
    const b = bytes(':20:S\n:25:2400123455/2010\n:60F:C260914CZK0,00\n:61:260915C5,00NTRF//R1\n:62F:C260915CZK5,00\n');
    const s = parseStatement(b, detectStatementFormat(b, 'a.sta'));
    expect(s.format).toBe('mt940');
    expect(s.txs).toHaveLength(1);
  });

  it('dispatches GPC with the given profile', () => {
    const head = `0740000002400123455${'X'.padEnd(20)}140926${'0'.repeat(14)}+${'0'.repeat(14)}+${'0'.repeat(14)}-${'0'.repeat(14)}+001300926${' '.repeat(14)}`;
    const b = bytes(head);
    const s = parseStatement(b, detectStatementFormat(b), { gpcProfile: 'gpc_fio' });
    expect(s.format).toBe('gpc');
    expect(s.profile).toBe('gpc_fio');
  });

  it('asks for a format for CSV and PDF', () => {
    for (const text of ['a;b\n1;2\n', '%PDF-1.7']) {
      const b = bytes(text);
      expect(() => parseStatement(b, detectStatementFormat(b))).toThrow(StatementFormatNeededError);
    }
  });
});
```

7. `packages/bank/src/index.ts`: add `export * from './parse';`, `export * from './parsers/camt053';`, `export * from './parsers/mt940';` (do not export `xml.ts`). Run typecheck. Commit `0109 step 7`.

## 5. Do not touch

`packages/extraction/` (copy only), every other package and app. Hard rules: money never via `Number`/`parseFloat`; no new dependency; DOCTYPE/ENTITY stays refused; no real bank data.

## 6. Commands

- `pnpm --filter @shoebox/bank test 2>&1 | tail -30` → all pass.
- `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -30` → no errors.
- `pnpm biome check packages/bank 2>&1 | tail -30` → clean (`--write` once for formatting only).

## 7. Acceptance

- [ ] Test files match §4 (formatter re-wrapping aside) and pass.
- [ ] `diff <(tail -n +3 packages/extraction/src/isdoc/xml.ts) <(tail -n +3 packages/bank/src/xml.ts)` is empty.
- [ ] Typecheck and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong (say which assertion and why);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a file outside §3 needs a change;
- a step is unclear.

## 9. Report

Write `docs/tasks/0109-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you could not do, and why.
