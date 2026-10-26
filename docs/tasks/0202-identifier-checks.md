# 0202: Account, IBAN, DIČ checks and IČO repair candidates

Status: todo
Ticket: P1-EXT-01 (identifier part) | Depends on: none | Base commit: 496b1e9 | Branch: task/0202-identifier-checks | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0202-report.md

## 1. Objective

Pure checks for Czech bank accounts, IBANs and DIČ, plus a list of nearby valid IČOs for an IČO that fails its check digit. The AI misreads about 1 IČO in 5; with these candidates and the known-supplier list the app can propose the right one.

## 2. Context

Existing (verbatim, `packages/validation/src/proto-checks/checks.ts`): `export function icoChecksumValid(ico: string): boolean` (8 digits, mod 11, weights 8..2). Reuse it, do not copy it.

M02 §4.4.4 (pasted):
- CZ account `prefix-number/bank`: both parts mod 11 with weights `6,3,7,9,10,5,8,4,2,1` applied right-aligned (pad left with zeros to 10 digits; valid iff the weighted sum mod 11 is 0). Prefix up to 6 digits (optional), number 2–10 digits with at least 2 non-zero digits, bank code exactly 4 digits.
- IBAN: remove spaces, uppercase; country length table (CZ 24, SK 24, DE 22, IE 22, NL 18, AT 20, PL 28, GB 22, FR 27, IT 27, ES 24, BE 16, LU 20, HU 28); unknown country → 15..34; mod 97 of the rearranged number == 1.
- DIČ `CZ` + 8 digits → IČO mod 11; `CZ` + 10 digits → valid iff the number mod 11 == 0, or mod 11 == 10 and the last digit is 0; `CZ699` + 6 digits (10 digits total starting 699) accepted unchecked; `CZ` + 9 digits accepted unchecked (old birth numbers).
- CZ IBAN from an account: `CZ` + 2 check digits + bank (4) + prefix (6, zero-padded) + number (10, zero-padded).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/validation/src/ids.ts` | new | the functions |
| `packages/validation/test/ids.test.ts` | new | tests below, verbatim |
| `packages/validation/src/index.ts` | edit | add `export * from './ids';` |

No other file may change.

## 4. Steps

1. Create `packages/validation/src/ids.ts` exporting exactly:

```ts
export function czAccountValid(prefix: string | null, number: string, bankCode: string): boolean;
export function ibanValid(iban: string): boolean;
export function czAccountToIban(prefix: string | null, number: string, bankCode: string): string | null; // null when czAccountValid is false
export function czDicValid(dic: string): boolean; // input like "CZ25596641"; spaces removed, uppercased first
/** Valid IČOs one digit change or one adjacent swap away, sorted, never the input itself. Input must be 8 digits, else []. */
export function icoRepairCandidates(ico: string): string[];
```

2. Create `packages/validation/test/ids.test.ts`, verbatim:

```ts
import { describe, expect, it } from 'vitest';
import {
  czAccountToIban,
  czAccountValid,
  czDicValid,
  ibanValid,
  icoRepairCandidates,
} from '../src/index';

describe('czAccountValid', () => {
  it('accepts a valid prefix and number', () => {
    expect(czAccountValid('19', '2000145399', '0800')).toBe(true);
    expect(czAccountValid(null, '2000145399', '0800')).toBe(true);
  });
  it('rejects a bad check, a bad bank code, too few non-zero digits', () => {
    expect(czAccountValid('19', '2000145398', '0800')).toBe(false);
    expect(czAccountValid('19', '2000145399', '800')).toBe(false);
    expect(czAccountValid(null, '0000000011', '0800')).toBe(false);
    expect(czAccountValid('1234567', '2000145399', '0800')).toBe(false);
  });
});

describe('IBAN', () => {
  it('validates mod 97 and length', () => {
    expect(ibanValid('CZ65 0800 0000 1920 0014 5399')).toBe(true);
    expect(ibanValid('cz6508000000192000145399')).toBe(true);
    expect(ibanValid('CZ6508000000192000145398')).toBe(false);
    expect(ibanValid('CZ650800000019200014539')).toBe(false);
    expect(ibanValid('DE89370400440532013000')).toBe(true);
  });
  it('builds a CZ IBAN from an account', () => {
    expect(czAccountToIban('19', '2000145399', '0800')).toBe('CZ6508000000192000145399');
    expect(czAccountToIban('19', '2000145398', '0800')).toBeNull();
  });
});

describe('czDicValid', () => {
  it.each([
    ['CZ25596641', true],
    ['CZ 25596641', true],
    ['CZ25596642', false],
    ['CZ7103192745', true],
    ['CZ7103192746', false],
    ['CZ6995012345', true],
    ['CZ510101123', true],
    ['SK2020123456', false],
    ['CZ123', false],
  ])('%s → %s', (dic, ok) => {
    expect(czDicValid(dic)).toBe(ok);
  });
});

describe('icoRepairCandidates', () => {
  it('finds the swapped digits and every single-digit fix', () => {
    expect(icoRepairCandidates('25596614')).toEqual([
      '25556614',
      '25591614',
      '25596314',
      '25596616',
      '25596624',
      '25596641',
      '25996614',
      '55596614',
    ]);
  });
  it('never returns the input and ignores bad shapes', () => {
    expect(icoRepairCandidates('25596641')).not.toContain('25596641');
    expect(icoRepairCandidates('2559664')).toEqual([]);
    expect(icoRepairCandidates('2559664a')).toEqual([]);
  });
});
```

   Implement until these tests pass; do not edit the test file. Run `pnpm --filter @shoebox/validation test -- ids 2>&1 | tail -30` → all pass.

3. Add the export line to `packages/validation/src/index.ts`. Run `pnpm --filter @shoebox/validation typecheck 2>&1 | tail -30` and `pnpm exec biome check packages/validation 2>&1 | tail -30` → clean (`pnpm exec biome format --write packages/validation` if only formatting fails).

## 5. Do not touch

Everything outside §3, including `checks.ts`. Hard rules 4 and 7.

## 6. Commands

As in steps 2–3.

## 7. Acceptance

- [ ] `ids` tests pass, typecheck and biome clean.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0202-report.md`, 200 tokens at most. Set `Status: review`.

## Risk list (for the reviewer)

`ids.ts` weights and the DIČ rule.
