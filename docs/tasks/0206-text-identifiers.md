# 0206: Find identifiers in the PDF text layer

Status: todo
Ticket: P1-EXT-03 (regex extractors, identifier part) | Depends on: 0202 | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0206-report.md

## 1. Objective

Pure regex extractors that find IČO, DIČ/VAT ID, IBAN, Czech account numbers and variable symbols in a PDF's text, keep only checksum-valid values, and pick the supplier's IČO and DIČ (the one that is not the user's own). The worker (0207) uses them to correct the AI's misread identifiers.

## 2. Context

M02 §4.4.3–4.4.4 (pasted, trimmed). All regexes run on a **folded** copy (lowercase, NFD, strip `\p{M}`), because real PDFs lose háčky (`IC:`, `DIC:`). IBAN runs on the original text uppercased.
- IČO: `\bico?\b\s*[:.]?\s*(\d(?:\s?\d){5,7})(?!\d)` (any single spaces between digits, e.g. `255 96 641`); rejected if the 25 chars before the match contain `ubytovani|objednav|zakaznick|klient|pod cislem|registr|cislo uctu`. Remove spaces, zero-pad to 8, keep only when `icoChecksumValid`.
- DIČ / VAT ID: `\b(?:dic|vat(?:\s?(?:id|no\.?|number))?|ic dph|tax id|ust-?id(?:nr)?|btw)\b\s*[:.]?\s*([a-z]{2}\s?[0-9a-z]{2,13})` → uppercase, strip spaces. `CZ…` kept only when `czDicValid`; others kept when `^[A-Z]{2}[0-9A-Z]{2,13}$` and they contain at least 2 digits.
- VS: `\b(?:vs|var\.?\s*symbol|variabilni\s+symbol)\b\s*[:.]?\s*(\d{1,10})\b`.
- CZ account: `(?<![\d-])(?:(\d{1,6})-)?(\d{2,10})\s?\/\s?(\d{4})(?!\d)` kept when `czAccountValid`.
- IBAN: `\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?)\b`, spaces removed, kept when `ibanValid`.
- Party: a value equal to the org's own → buyer; exactly one other distinct valid value → supplier; more than one → no winner (null).

`@shoebox/validation` exports `icoChecksumValid`, `czDicValid`, `czAccountValid`, `ibanValid` (0202). Add it as a workspace dependency of `@shoebox/extraction` (`"@shoebox/validation": "workspace:*"`); validation does not import extraction, so there is no cycle.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/package.json`, `pnpm-lock.yaml` | edit | workspace dependency (`pnpm install`) |
| `packages/extraction/tsconfig.json` | edit | only if project references are used for workspace deps (copy how `apps/worker/tsconfig.json` refers to validation) |
| `packages/extraction/src/text/identifiers.ts` | new | the extractors |
| `packages/extraction/test/text-identifiers.test.ts` | new | tests below, verbatim |
| `packages/extraction/src/index.ts` | edit | `export * from './text/identifiers';` |

## 4. Steps

1. Exports, exactly:

```ts
export interface CzAccount { readonly prefix: string | null; readonly number: string; readonly bankCode: string }
export interface TextIdentifiers {
  readonly icos: readonly string[];        // distinct, valid, in order found
  readonly dics: readonly string[];
  readonly ibans: readonly string[];
  readonly accounts: readonly CzAccount[];
  readonly variableSymbols: readonly string[];
  readonly supplierIco: string | null;
  readonly supplierDic: string | null;
}
export function foldText(text: string): string;
export function findIdentifiers(text: string, org: { readonly ico: string | null; readonly dic: string | null }): TextIdentifiers;
```

   Folding must keep string length equal to the input for the regexes to map back; it is enough to fold with `text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()` and run every regex on that (values are digits/letters only, so mapping back is not needed).

2. Test file, verbatim:

```ts
import { describe, expect, it } from 'vitest';
import { findIdentifiers, foldText } from '../src/index';

// Synthetic values only (hard rule 4). 25596641 and 00006947 are valid IČOs.
const ORG = { ico: '00006947', dic: 'CZ00006947' };

const INVOICE = [
  'Faktura - daňový doklad č. 2026001',
  'Dodavatel: Testovací s.r.o., IČ: 255 96 641, DIČ: CZ25596641',
  'Odběratel: Já OSVČ, IČO 00006947 DIČ CZ00006947',
  'Bankovní spojení: 19-2000145399/0800  IBAN: CZ65 0800 0000 1920 0014 5399',
  'Variabilní symbol: 2026001',
].join('\n');

describe('foldText', () => {
  it('strips diacritics and lowercases', () => {
    expect(foldText('DIČ Číslo účtu')).toBe('dic cislo uctu');
  });
});

describe('findIdentifiers', () => {
  it('finds every identifier and picks the supplier', () => {
    expect(findIdentifiers(INVOICE, ORG)).toEqual({
      icos: ['25596641', '00006947'],
      dics: ['CZ25596641', 'CZ00006947'],
      ibans: ['CZ6508000000192000145399'],
      accounts: [{ prefix: '19', number: '2000145399', bankCode: '0800' }],
      variableSymbols: ['2026001'],
      supplierIco: '25596641',
      supplierDic: 'CZ25596641',
    });
  });

  it('works without háčky (Competitor-style PDFs lose them)', () => {
    const r = findIdentifiers('IC: 25596641 DIC: CZ25596641', ORG);
    expect(r.supplierIco).toBe('25596641');
    expect(r.supplierDic).toBe('CZ25596641');
  });

  it('drops checksum-invalid values and booking numbers', () => {
    const r = findIdentifiers('IČ: 25596642\nČíslo objednávky IČO 25596641\nDIČ: CZ25596642', ORG);
    expect(r.icos).toEqual([]);
    expect(r.dics).toEqual([]);
    expect(r.supplierIco).toBeNull();
  });

  it('keeps a foreign VAT ID and refuses "CZSL000D"-like junk', () => {
    const r = findIdentifiers('VAT ID: IE 6388047V\nDIČ: CZSL000D', ORG);
    expect(r.dics).toEqual(['IE6388047V']);
    expect(r.supplierDic).toBe('IE6388047V');
  });

  it('has no supplier winner when two other IČOs appear', () => {
    const r = findIdentifiers('IČ: 25596641\nIČ: 27074358', ORG);
    expect(r.icos).toEqual(['25596641', '27074358']);
    expect(r.supplierIco).toBeNull();
  });

  it('ignores dates and invalid accounts', () => {
    const r = findIdentifiers('Datum 12/2026, účet 19-2000145398/0800', ORG);
    expect(r.accounts).toEqual([]);
  });
});
```

   Implement until these tests pass; do not edit the test file.

## 5. Do not touch

Everything outside §3. Hard rules 4 and 7 (a workspace package is not a new dependency).

## 6. Commands

```
pnpm --filter @shoebox/extraction test 2>&1 | tail -30
pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30
pnpm exec biome check --write packages/extraction 2>&1 | tail -30
```

## 7. Acceptance

- [ ] §6 passes.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0206-report.md`, 200 tokens at most. Set `Status: review`.

## Risk list (for the reviewer)

Party assignment in `identifiers.ts`.
