# 0504: Grouping rules: which pages make one document

Status: in-progress
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0503 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

From the page look-over (0503), decide which pages form one document. One function both splits (a 12-page scan with 6 invoices) and joins (one invoice photographed as 2 pictures). It never guesses: when two documents might be one, it keeps them apart and returns a question for the user. Pure logic, no I/O.

## 2. Context

- `packages/extraction/src/sort/page-map.ts` (0503) exports `PageItem { where; kind: PageKind; supplierName; supplierIco; docNumber; labelN: number | null; labelOf: number | null; hasTotals; startsDocument }` and `PageKind` (`'invoice' | 'receipt' | 'credit_note' | 'other_document' | 'attachment' | 'not_document'`).
- Owner rule (2026-10-26): the users are laypeople who drop pages in any order and any mix. A wrong join puts wrong amounts on an invoice, so when unsure keep pages apart and ask (default answer: separate).

### The algorithm (implement exactly this)

Definitions, for two items a and b:
- `nameKey(name)`: NFKD, remove combining marks (`/\p{M}/gu`), lowercase, then remove every character that is not `a-z` or `0-9`.
- `supplierKeyOf(item)`: `item.supplierIco` if not `''`, else `nameKey(item.supplierName)`.
- `sameSupplier(a, b)`: if both have an ICO → `'yes'` when equal, else `'no'`. Else if both nameKeys are not `''` → `'yes'` when equal or one contains the other, else `'no'`. Else `'unknown'`.
- `numberKey(n)`: uppercase, all whitespace removed.
- `compatible(a, b)`: neither is `not_document`, `sameSupplier(a, b) !== 'no'`, and the numberKeys are equal or at least one is `''`.
- `canMerge(G, H)` for two groups: every piece of G is `compatible` with every piece of H.

Steps:
1. Walk `pages` in the given order (the caller sorts them by file, then page). A page with `blank` true or no items goes to `skipped`. Otherwise each item becomes one piece `{ fileIndex, filePage, region: item.where, item }`, in item order. The pieces in this order are P[0..n-1] ("upload order").
2. Each piece starts as its own group (union-find).
3. **Rule A, same number:** for every pair i < j where both numberKeys are not `''` and equal, `sameSupplier !== 'no'` and `canMerge` → merge.
4. **Rule B, page labels:** for each piece p in order with `labelN > 1` and `labelOf` set: skip it if its group already holds a piece with the same `labelOf` and `labelN = p.labelN - 1`. Candidates = the other groups that hold a piece q with the same `labelOf` and `q.labelN = p.labelN - 1`, where `canMerge(group(q), group(p))`, and which do not already hold a piece with p's `labelN` and `labelOf`. Exactly one candidate → merge. Two or more → mark p **held** and record a question between p and the nearest q (the one with the highest upload index below p's; if none is below, the lowest index).
5. **Rule C, continuation:** for each p = P[k], k ≥ 1, not held, whose group has one piece, with `startsDocument` false or kind `attachment`: if `canMerge(group(P[k-1]), group(p))` → merge.
6. **Rule D, missing totals:** for each p = P[k], k ≥ 1, not held, whose group has one piece, with `hasTotals` true: let G = group(P[k-1]). If no piece of G has totals, `sameSupplier(P[k-1].item, p.item) === 'yes'` and `canMerge(G, group(p))` → merge.
7. **Rule E, unsure:** for each p = P[k], k ≥ 1, not held, in a different group than P[k-1]: if `sameSupplier(P[k-1].item, p.item) === 'yes'`, no piece of group(P[k-1]) has totals and `canMerge` → record a question between P[k-1] and p. Do not merge.
8. Output. Groups are ordered by their lowest upload index. Inside a group: if every piece has a `labelN` and they share one `labelOf`, order by `labelN` (ties by upload index); otherwise by upload index. A question becomes the pair of its two pieces' group indexes `[low, high]`. Drop pairs where both are the same group and drop repeats. Keep the order the questions were recorded in.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/sort/group.ts` | new | the function |
| `packages/extraction/test/group-pages.test.ts` | new | given below |
| `packages/extraction/src/index.ts` | edit | export it |

No other file may change.

## 4. Steps

1. New `packages/extraction/src/sort/group.ts` with exactly these exports. Implement §2 until step 2's tests pass:

```ts
import type { PageItem } from './page-map';

export interface SortPage {
  readonly fileIndex: number; // 0-based, upload order
  readonly filePage: number; // 1-based
  readonly blank: boolean;
  readonly items: readonly PageItem[];
}

export interface SortPiece {
  readonly fileIndex: number;
  readonly filePage: number;
  readonly region: string;
  readonly item: PageItem;
}

export interface SortResult {
  /** One entry per document, pieces in reading order; groups ordered by first upload index. */
  readonly groups: readonly (readonly SortPiece[])[];
  readonly skipped: readonly { readonly fileIndex: number; readonly filePage: number }[];
  /** Pairs of group indexes [low, high] that may be one document: ask the user. */
  readonly questions: readonly (readonly [number, number])[];
}

export function supplierKeyOf(item: PageItem): string;
export function sameSupplier(a: PageItem, b: PageItem): 'yes' | 'no' | 'unknown';
export function groupPages(pages: readonly SortPage[]): SortResult;
```

2. New `packages/extraction/test/group-pages.test.ts` (do not edit it):

```ts
import { describe, expect, it } from 'vitest';
import { groupPages, type SortPage, sameSupplier, supplierKeyOf } from '../src/sort/group';
import type { PageItem } from '../src/sort/page-map';

const X = { supplierName: 'Supplier X spol. s r.o.', supplierIco: '11111111' };
const Y = { supplierName: 'Supplier Y a.s.', supplierIco: '22222222' };

function item(overrides: Partial<PageItem> = {}): PageItem {
  return {
    where: '',
    kind: 'invoice',
    supplierName: '',
    supplierIco: '',
    docNumber: '',
    labelN: null,
    labelOf: null,
    hasTotals: false,
    startsDocument: true,
    ...overrides,
  };
}

function page(fileIndex: number, filePage: number, ...items: PageItem[]): SortPage {
  return { fileIndex, filePage, blank: false, items };
}

function blank(fileIndex: number, filePage: number): SortPage {
  return { fileIndex, filePage, blank: true, items: [] };
}

/** "file:page" or "file:page:region" per piece, per group. */
function shape(pages: SortPage[]): string[][] {
  return groupPages(pages).groups.map((g) =>
    g.map((p) => `${p.fileIndex}:${p.filePage}${p.region === '' ? '' : `:${p.region}`}`),
  );
}

describe('supplier helpers', () => {
  it('keys by ICO, else by the plain name', () => {
    expect(supplierKeyOf(item(X))).toBe('11111111');
    expect(supplierKeyOf(item({ supplierName: 'Pekařství Žák, s.r.o.' }))).toBe('pekarstvizaksro');
    expect(supplierKeyOf(item())).toBe('');
  });

  it('compares ICOs first, then names, else unknown', () => {
    expect(sameSupplier(item(X), item({ ...X, supplierName: '' }))).toBe('yes');
    expect(sameSupplier(item(X), item(Y))).toBe('no');
    expect(sameSupplier(item(X), item({ supplierName: 'Supplier X' }))).toBe('yes');
    expect(sameSupplier(item({ supplierName: 'Supplier X' }), item({ supplierName: 'Other' }))).toBe('no');
    expect(sameSupplier(item(X), item())).toBe('unknown');
  });
});

describe('groupPages', () => {
  it('keeps one page as one document', () => {
    expect(shape([page(0, 1, item({ ...X, hasTotals: true }))])).toEqual([['0:1']]);
  });

  it('joins an invoice sent as two files: details first, totals second (owner test 2026-10-26)', () => {
    const pages = [
      page(0, 1, item({ ...X, docNumber: 'FV-1' })),
      page(1, 1, item({ supplierName: X.supplierName, hasTotals: true })),
    ];
    expect(shape(pages)).toEqual([['0:1', '1:1']]);
    expect(groupPages(pages).questions).toEqual([]);
  });

  it('splits one 12-page scan holding 6 two-page invoices', () => {
    const pages: SortPage[] = [];
    for (let k = 0; k < 6; k += 1) {
      const supplier = { supplierName: `Supplier ${k}`, supplierIco: `3333333${k}` };
      pages.push(page(0, 2 * k + 1, item({ ...supplier, docNumber: `N${k}`, labelN: 1, labelOf: 2 })));
      pages.push(
        page(0, 2 * k + 2, item({ ...supplier, docNumber: `N${k}`, labelN: 2, labelOf: 2, hasTotals: true })),
      );
    }
    expect(shape(pages)).toEqual([
      ['0:1', '0:2'],
      ['0:3', '0:4'],
      ['0:5', '0:6'],
      ['0:7', '0:8'],
      ['0:9', '0:10'],
      ['0:11', '0:12'],
    ]);
  });

  it('puts pages uploaded in the wrong order back in order', () => {
    const pages = [
      page(0, 1, item({ ...X, docNumber: 'N', labelN: 2, labelOf: 2, hasTotals: true, startsDocument: false })),
      page(1, 1, item({ ...X, docNumber: 'N', labelN: 1, labelOf: 2 })),
    ];
    expect(shape(pages)).toEqual([['1:1', '0:1']]);
  });

  it('joins by page labels when there is no number', () => {
    const pages = [
      page(0, 1, item({ ...X, labelN: 1, labelOf: 2 })),
      page(1, 1, item({ ...X, labelN: 2, labelOf: 2, hasTotals: true })),
    ];
    expect(shape(pages)).toEqual([['0:1', '1:1']]);
  });

  it('leaves blank pages out', () => {
    const pages = [page(0, 1, item({ ...X, hasTotals: true })), blank(0, 2), page(0, 3, item({ ...Y, hasTotals: true }))];
    const result = groupPages(pages);
    expect(shape(pages)).toEqual([['0:1'], ['0:3']]);
    expect(result.skipped).toEqual([{ fileIndex: 0, filePage: 2 }]);
  });

  it('keeps terms and conditions with the invoice before them', () => {
    const pages = [
      page(0, 1, item({ ...X, hasTotals: true })),
      page(0, 2, item({ kind: 'attachment', startsDocument: false })),
    ];
    expect(shape(pages)).toEqual([['0:1', '0:2']]);
  });

  it('joins a continuation page without a header to the page before it', () => {
    const pages = [page(0, 1, item({ ...X, docNumber: 'N' })), page(0, 2, item({ startsDocument: false, hasTotals: true }))];
    expect(shape(pages)).toEqual([['0:1', '0:2']]);
  });

  it('reads two receipts on one photo as two documents', () => {
    const pages = [
      page(
        0,
        1,
        item({ ...X, kind: 'receipt', where: 'top', hasTotals: true }),
        item({ ...Y, kind: 'receipt', where: 'bottom', hasTotals: true }),
      ),
    ];
    expect(shape(pages)).toEqual([['0:1:top'], ['0:1:bottom']]);
  });

  it('keeps two complete invoices from the same supplier apart, without asking', () => {
    const pages = [
      page(0, 1, item({ ...X, docNumber: 'N1', hasTotals: true })),
      page(1, 1, item({ ...X, docNumber: 'N2', hasTotals: true })),
    ];
    expect(shape(pages)).toEqual([['0:1'], ['1:1']]);
    expect(groupPages(pages).questions).toEqual([]);
  });

  it('never joins pages of different suppliers, even a page without a header', () => {
    const pages = [page(0, 1, item({ ...X })), page(0, 2, item({ ...Y, startsDocument: false, hasTotals: true }))];
    expect(shape(pages)).toEqual([['0:1'], ['0:2']]);
  });

  it('never joins a page that is not a document', () => {
    const pages = [
      page(0, 1, item({ ...X, hasTotals: true })),
      page(1, 1, item({ kind: 'not_document', startsDocument: false })),
      page(2, 1, item({ ...Y, hasTotals: true })),
    ];
    expect(shape(pages)).toEqual([['0:1'], ['1:1'], ['2:1']]);
  });

  it('asks when two pages of one supplier might be one invoice', () => {
    const pages = [page(0, 1, item({ ...X })), page(1, 1, item({ ...X }))];
    const result = groupPages(pages);
    expect(shape(pages)).toEqual([['0:1'], ['1:1']]);
    expect(result.questions).toEqual([[0, 1]]);
  });

  it('asks instead of guessing when a page 2 fits two page 1s', () => {
    const pages = [
      page(0, 1, item({ ...X, labelN: 1, labelOf: 2 })),
      page(1, 1, item({ ...X, labelN: 1, labelOf: 2 })),
      page(2, 1, item({ ...X, labelN: 2, labelOf: 2, hasTotals: true })),
    ];
    const result = groupPages(pages);
    expect(shape(pages)).toEqual([['0:1'], ['1:1'], ['2:1']]);
    expect(result.questions).toEqual([
      [1, 2],
      [0, 1],
    ]);
  });

  it('joins pages with the same number across files and keeps a third invoice apart', () => {
    const pages = [
      page(0, 1, item({ ...X, docNumber: 'FV 2025/1' })),
      page(1, 1, item({ ...Y, docNumber: 'B7', hasTotals: true })),
      page(2, 1, item({ ...X, docNumber: 'fv2025/1', hasTotals: true, startsDocument: false })),
    ];
    expect(shape(pages)).toEqual([['0:1', '2:1'], ['1:1']]);
  });
});
```

Run `pnpm --filter @shoebox/extraction test -- group-pages 2>&1 | tail -30` (expect 17 passed). If a test fails twice and the rules in §2 seem to give a different answer than the test, STOP and say which test and which rule (§8).

3. `index.ts`: add `export * from './sort/group';` before `export * from './sort/page-map';`. Run the typecheck.

## 5. Do not touch

Other files. Rule 2 (a suggestion: questions go to the user).

## 6. Commands

- `pnpm --filter @shoebox/extraction test -- group-pages 2>&1 | tail -30`
- `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/extraction 2>&1 | tail -30`

## 7. Acceptance

- [ ] The commands in §6 pass. `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0504-report.md` (600 tokens at most) and set `Status: review`.
