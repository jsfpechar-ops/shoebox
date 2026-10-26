# 0116: Matcher: assignment, subset sum, paid_at, rule categorisation

Status: todo
Ticket: P2-MATCH-03, P2-MATCH-04 (pure part) | Depends on: 0115 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
<!-- Risk: HIGH (money). Pure functions only; no I/O, no DB. -->

## 1. Objective

Turn scored candidates into links and suggestions deterministically (M07 §4.6.4), find multi-document payments by subset sum (§4.7.2), compute a document's `paid_at` from its links (§4.7.10), and recognise transactions that need no document: tax and insurance payments, bank fees, interest, ATM and transfers between own accounts (§4.7.4–§4.7.6). All pure; the worker (0118) persists the results.

## 2. Context

Money is never a float. Haléře for the subset sum are `bigint` derived from `Money.toFixed2()` strings, never from `Number`. Scores are plain numbers.

From 0115 (`packages/bank/src/matcher/`): `MATCHER_CONFIG`, `MatcherConfig` (`config.ts`); types `TxView`, `DocView`, `CandidateScore`, `Feature`, `AmountFeature` (`types.ts`); `foldText`, `tokenSetRatio` (`text.ts`); `daysBetween` (`dates.ts`); `sigmoid` (`score.ts`). `packages/bank/src/matcher/index.ts` ends with `export type * from './types';`.

From `@shoebox/domain`: `Money` (`parse`, `zero`, `sum(items, currency)`, `add`, `subtract`, `abs`, `negate`, `compare`, `equals`, `isZero`, `isPositive`, `isNegative`, `multiply(factor)`, `toFixed2`, `currency`), `round2`, `CZK`, `LegalDate`, `parseLegalDate`, `addDays`, types `LinkType` (`'payment'|'refund'|'fee'|'fx_difference'|'platform_payout'|'offset'`), `MatchMethod`.

M07 §4.6.4 assignment: drop pairs below `suggestThreshold` and rejected pairs; margin rule per transaction and per document (`best − second < minMargin` → no auto link for that side); order by score desc, then smaller anchor distance, older due date, older `created_at`, lexical document id, lexical transaction id; greedy: `score ≥ autoThreshold`, margin-eligible on both sides, both sides with capacity → link `amount = min(open, remaining)`; else suggestion, at most 3 per transaction. Invariant I4: the same input gives the same output.

§4.7.2: subset sum in haléře over open amounts, target `|t|`, tolerance `roundingToleranceCzk`, size ≤ `maxSubsetSize`; one subset → σ(bias + amountExact + account/name/alias + dateMax × mean f_date) capped 0.89, uncapped (+ `msgDocNumber`) when the message holds every document number; several subsets → the one with the oldest maximum due date, cap 0.75.

§4.7.10 `paid_at`: links ordered by booked date then `created_at`; running sum of payment + offset + platform_payout + fx_difference − refund (document currency); `paid_at` = booked date of the first link after which the sum reaches `amount_due − tol` (`tol` = `roundingToleranceCzk` for CZK, 1 % of `amount_due` otherwise); a later drop below → null; `amount_due ≤ 0` → `issue_date` when `is_paid_per_document`, else null.

§4.7.4–§4.7.6 (rule categorisation), restated in step 4. Category codes come from 04 §3.1: `tax_vat_payment`, `tax_income_payment`, `tax_pausal_advance`, `ins_social_own`, `ins_health_own`, `tax_other_fees`, `pt_tourist_fee`, `income_vat_refund`, `exp_bank_fees`, `income_interest`, `transfer_cash_withdrawal`, `transfer_cash_deposit`, `transfer_own_accounts`.

Synthetic data only. Test accounts: `2400123455/2010`, `1003-1234567899/0800` (allowlisted); `705-1234567890/0710` and `2866-1234567890/0710` (checksum-invalid on purpose, so the PII guard ignores them; the matcher never validates checksums).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/bank/src/matcher/assign.ts` | new | `orderScores`, `assign` |
| `packages/bank/src/matcher/subset-sum.ts` | new | `toHalere`, `findSubsetSum`, `chooseSubset`, `multiDocumentScore` |
| `packages/bank/src/matcher/paid-at.ts` | new | `paidThreshold`, `computePaidAt` |
| `packages/bank/src/matcher/classify.ts` | new | `authorityRulesOf`, `classifyByRules`, `findOwnTransferPair` |
| `packages/bank/src/matcher/index.ts` | edit | four more re-exports |
| `packages/bank/test/matcher-assign.test.ts` | new | verbatim below |
| `packages/bank/test/subset-sum.test.ts` | new | verbatim below |
| `packages/bank/test/paid-at.test.ts` | new | verbatim below |
| `packages/bank/test/classify.test.ts` | new | verbatim below |

No other file may change. (0115 also names `packages/bank/src/matcher/index.ts`: 0115 goes first.)

## 4. Steps

1. New `packages/bank/src/matcher/assign.ts`:
```ts
export interface LinkDraft {
  readonly transactionId: string; readonly documentId: string; readonly linkType: 'payment';
  readonly amountDoc: Money; readonly amountAccount: Money; readonly matchMethod: MatchMethod;
  readonly confidence: number; readonly features: readonly Feature[];
}
export interface SuggestionDraft {
  readonly transactionId: string; readonly kind: 'document'; readonly documentIds: readonly string[];
  readonly amounts: readonly Money[]; readonly score: number; readonly features: readonly Feature[];
}
/** M07 §4.6.4 step 3 order; pure, stable. */
export function orderScores(scores: readonly CandidateScore[]): CandidateScore[];
export function assign(scores: readonly CandidateScore[], cfg?: MatcherConfig, rejected?: ReadonlySet<string>): { links: LinkDraft[]; suggestions: SuggestionDraft[] };
```
`orderScores`: `score` desc; `anchorDistanceDays` asc; `dueDate` asc with undefined last; `docCreatedAt` asc; `documentId` asc; `transactionId` asc (plain `<` string compares).
`assign`: (1) keep `score ≥ cfg.suggestThreshold` and not `rejected.has(\`${transactionId}:${documentId}\`)`; (2) a transaction is margin-eligible when it has one kept pair or `best − second ≥ cfg.minMargin`; the same per document; (3) `orderScores`; (4) capacities: `txRemaining` of the first pair of each transaction, `docOpen` of the first pair of each document; walk the order: skip when either capacity is not positive; if `score ≥ autoThreshold` and both sides margin-eligible → link with `amountAccount = min(txRemaining, amount.amountAccount)`, `amountDoc = min(docOpen, amount.amountDoc)` and, when `amountDoc.currency === amountAccount.currency`, also `≤ amountAccount` (`min` by `compare`), `confidence = score`, then subtract from both capacities; otherwise a suggestion (`documentIds: [documentId]`, `amounts: [amount.amountDoc]`) while the transaction has fewer than 3.
New `packages/bank/test/matcher-assign.test.ts`, verbatim:
```ts
import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { assign, orderScores } from '../src/matcher/assign';
import type { CandidateScore } from '../src/matcher/types';

const D = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);

function cs(over: Partial<CandidateScore> & { transactionId: string; documentId: string; score: number }): CandidateScore {
  return {
    logit: 0, features: [], method: 'vs_amount',
    amount: { kind: 'exact', ratio: 1, amountDoc: czk('1210.00'), amountAccount: czk('1210.00') },
    txRemaining: czk('1210.00'), docOpen: czk('1210.00'), anchorDistanceDays: 0, dueDate: D('2026-03-15'),
    docCreatedAt: '2026-03-01T10:00:00Z', capped: false, ...over,
  };
}
const ids = (xs: readonly { documentId: string }[]) => xs.map((x) => x.documentId);

describe('orderScores', () => {
  it('orders by score, anchor distance, due date, created_at, ids', () => {
    const a = cs({ transactionId: 't1', documentId: 'a', score: 0.9, anchorDistanceDays: 3 });
    const b = cs({ transactionId: 't1', documentId: 'b', score: 0.9, anchorDistanceDays: 1, dueDate: D('2026-03-20') });
    const c = cs({ transactionId: 't1', documentId: 'c', score: 0.9, anchorDistanceDays: 1, dueDate: D('2026-03-10') });
    const d = cs({ transactionId: 't1', documentId: 'd', score: 0.95 });
    const e = cs({ transactionId: 't1', documentId: 'e', score: 0.9, anchorDistanceDays: 1, dueDate: undefined });
    const f = cs({ transactionId: 't1', documentId: 'f', score: 0.9, anchorDistanceDays: 1, dueDate: D('2026-03-10'), docCreatedAt: '2026-02-01T00:00:00Z' });
    expect(ids(orderScores([a, b, c, d, e, f]))).toEqual(['d', 'f', 'c', 'b', 'e', 'a']);
  });
});

describe('assign', () => {
  it('links one clear pair', () => {
    const r = assign([cs({ transactionId: 't1', documentId: 'd1', score: 0.989 })]);
    expect(r.links).toHaveLength(1);
    expect(r.suggestions).toHaveLength(0);
    expect(r.links[0]).toMatchObject({ transactionId: 't1', documentId: 'd1', linkType: 'payment', confidence: 0.989, matchMethod: 'vs_amount' });
    expect(r.links[0]!.amountDoc.toFixed2()).toBe('1210.00');
    expect(r.links[0]!.amountAccount.toFixed2()).toBe('1210.00');
  });
  it('margin rule per transaction: 0.95 vs 0.90 → two suggestions', () => {
    const r = assign([cs({ transactionId: 't1', documentId: 'd1', score: 0.95 }), cs({ transactionId: 't1', documentId: 'd2', score: 0.9 })]);
    expect(r.links).toHaveLength(0);
    expect(ids(r.suggestions)).toEqual(['d1', 'd2']);
    expect(r.suggestions[0]).toMatchObject({ transactionId: 't1', kind: 'document', documentIds: ['d1'], score: 0.95 });
    expect(r.suggestions[0]!.amounts[0]!.toFixed2()).toBe('1210.00');
  });
  it('margin ok: links the best, the rest has no capacity left', () => {
    const r = assign([cs({ transactionId: 't1', documentId: 'd1', score: 0.95 }), cs({ transactionId: 't1', documentId: 'd2', score: 0.8 })]);
    expect(ids(r.links)).toEqual(['d1']);
    expect(r.suggestions).toHaveLength(0);
  });
  it('margin rule per document: two transactions close in score', () => {
    const r = assign([cs({ transactionId: 't1', documentId: 'd1', score: 0.95 }), cs({ transactionId: 't2', documentId: 'd1', score: 0.93 })]);
    expect(r.links).toHaveLength(0);
    expect(r.suggestions.map((s) => s.transactionId)).toEqual(['t1', 't2']);
  });
  it('tie-breaker: older due date first', () => {
    const r = assign([
      cs({ transactionId: 't1', documentId: 'da', score: 0.95, dueDate: D('2026-03-15') }),
      cs({ transactionId: 't2', documentId: 'db', score: 0.95, dueDate: D('2026-03-10') }),
    ]);
    expect(ids(r.links)).toEqual(['db', 'da']);
  });
  it('drops low scores and rejected pairs', () => {
    expect(assign([cs({ transactionId: 't1', documentId: 'd1', score: 0.55 })])).toEqual({ links: [], suggestions: [] });
    const r = assign([cs({ transactionId: 't1', documentId: 'd1', score: 0.989 })], undefined, new Set(['t1:d1']));
    expect(r).toEqual({ links: [], suggestions: [] });
  });
  it('keeps at most 3 suggestions per transaction', () => {
    const r = assign([0.85, 0.8, 0.75, 0.7].map((score, i) => cs({ transactionId: 't1', documentId: `d${i + 1}`, score })));
    expect(r.links).toHaveLength(0);
    expect(ids(r.suggestions)).toEqual(['d1', 'd2', 'd3']);
  });
  it('is idempotent', () => {
    const input = [
      cs({ transactionId: 't1', documentId: 'd1', score: 0.95 }), cs({ transactionId: 't1', documentId: 'd2', score: 0.7 }),
      cs({ transactionId: 't2', documentId: 'd3', score: 0.65 }),
    ];
    expect(assign(input)).toEqual(assign(input));
  });
  it('respects capacities and amounts', () => {
    const small = { kind: 'exact', ratio: 1, amountDoc: czk('500.00'), amountAccount: czk('500.00') } as const;
    const r = assign([
      cs({ transactionId: 't1', documentId: 'd1', score: 0.95, txRemaining: czk('1710.00') }),
      cs({ transactionId: 't1', documentId: 'd2', score: 0.8, txRemaining: czk('1710.00'), docOpen: czk('500.00'), amount: small }),
    ]);
    expect(ids(r.links)).toEqual(['d1']);
    expect(ids(r.suggestions)).toEqual(['d2']);
    expect(r.suggestions[0]!.amounts[0]!.toFixed2()).toBe('500.00');
    const capped = assign([cs({ transactionId: 't1', documentId: 'd1', score: 0.95, txRemaining: czk('1000.00') })]);
    expect(capped.links[0]!.amountAccount.toFixed2()).toBe('1000.00');
    expect(capped.links[0]!.amountDoc.toFixed2()).toBe('1000.00');
    const none = assign([cs({ transactionId: 't1', documentId: 'd1', score: 0.95, txRemaining: czk('0.00') })]);
    expect(none).toEqual({ links: [], suggestions: [] });
  });
});
```
Run `pnpm --filter @shoebox/bank test -- matcher-assign 2>&1 | tail -30` → pass. Commit `0116 step 1`.

2. New `packages/bank/src/matcher/subset-sum.ts`:
```ts
export function toHalere(m: Money): bigint;        // from round2(m).toFixed2(): sign, strip '.', BigInt
export function findSubsetSum(targetHalere: bigint, items: readonly { id: string; halere: bigint }[], tolHalere: bigint, maxSize: number): string[][];
export function chooseSubset(subsets: readonly string[][], dueById: Readonly<Record<string, LegalDate | undefined>>): { ids: string[]; unique: boolean } | null;
export function multiDocumentScore(f: { account: boolean; alias: boolean; nameSim: number; meanDateFactor: number; unique: boolean; messageHasAll: boolean }, cfg?: MatcherConfig): number;
```
`findSubsetSum`: enumerate combinations by size 1 … `min(maxSize, items.length)`, each size in lexicographic index order (recursive index walk); keep those with `|sum − target| ≤ tol`; ids in input order. `maxSize ≤ 0` or no items → `[]`. `chooseSubset`: empty → null; one → `unique: true`; several → the subset whose maximum due date (missing due = `'9999-12-31'`) is oldest, first on ties, `unique: false`. `multiDocumentScore`: `logit = bias + amountExact + (account ? accountMatch : 0) + (alias ? alias : 0) + nameMax × max(0, (nameSim − 0.5) / 0.5) + dateMax × meanDateFactor + (messageHasAll ? msgDocNumber : 0)`; `score = round3(sigmoid(logit))`; `messageHasAll` → uncapped; else `unique` → `min(score, 0.89)`; else `min(score, 0.75)`.
New `packages/bank/test/subset-sum.test.ts`, verbatim:
```ts
import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { chooseSubset, findSubsetSum, multiDocumentScore, toHalere } from '../src/matcher/subset-sum';

const D = parseLegalDate;
const items = [
  { id: 'a', halere: 100000n }, { id: 'b', halere: 250000n }, { id: 'c', halere: 50000n }, { id: 'd', halere: 150000n },
];

describe('toHalere', () => {
  it('is exact', () => {
    expect(toHalere(Money.parse('1210.50', CZK))).toBe(121050n);
    expect(toHalere(Money.parse('-0.05', CZK))).toBe(-5n);
    expect(toHalere(Money.parse('0', CZK))).toBe(0n);
    expect(toHalere(Money.parse('12345.6', CZK))).toBe(1234560n);
  });
});

describe('findSubsetSum', () => {
  it('finds every subset within tolerance, smallest first', () => {
    expect(findSubsetSum(300000n, items, 0n, 6)).toEqual([['b', 'c'], ['a', 'c', 'd']]);
    expect(findSubsetSum(300000n, items, 0n, 2)).toEqual([['b', 'c']]);
    expect(findSubsetSum(300050n, items, 100n, 6)).toEqual([['b', 'c'], ['a', 'c', 'd']]);
    expect(findSubsetSum(50000n, items, 0n, 6)).toEqual([['c']]);
    expect(findSubsetSum(999n, items, 0n, 6)).toEqual([]);
    expect(findSubsetSum(50000n, items, 0n, 0)).toEqual([]);
    expect(findSubsetSum(50000n, [], 0n, 6)).toEqual([]);
  });
  it('handles 20 × 6 (C(20,6) = 38760 subsets)', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, halere: 100000n }));
    expect(findSubsetSum(600000n, twenty, 0n, 6)).toHaveLength(38760);
  });
});

describe('chooseSubset', () => {
  const due = { a: D('2026-03-01'), b: D('2026-03-20'), c: D('2026-03-05'), d: D('2026-03-10') };
  it('one subset is unique', () => {
    expect(chooseSubset([['b', 'c']], due)).toEqual({ ids: ['b', 'c'], unique: true });
  });
  it('several: oldest maximum due date wins', () => {
    expect(chooseSubset([['b', 'c'], ['a', 'c', 'd']], due)).toEqual({ ids: ['a', 'c', 'd'], unique: false });
    expect(chooseSubset([['a', 'c', 'd'], ['b', 'c']], due)).toEqual({ ids: ['a', 'c', 'd'], unique: false });
    expect(chooseSubset([['b'], ['a', 'x']], due)).toEqual({ ids: ['b'], unique: false });
    expect(chooseSubset([], due)).toBeNull();
  });
});

describe('multiDocumentScore', () => {
  it('caps at 0.89 unless the message names every document', () => {
    const f = { account: true, alias: false, nameSim: 0, meanDateFactor: 1, unique: true, messageHasAll: false };
    expect(multiDocumentScore(f)).toBe(0.89);
    expect(multiDocumentScore({ ...f, messageHasAll: true })).toBe(0.998);
    expect(multiDocumentScore({ ...f, unique: false })).toBe(0.75);
    expect(multiDocumentScore({ ...f, account: false, nameSim: 1 })).toBe(0.89);
    expect(multiDocumentScore({ ...f, account: false, meanDateFactor: 0.5 })).toBe(0.438);
  });
});
```
Check of the last value: logit = −4 + 3 + 0.75 = −0.25 → σ = 0.438. Run `pnpm --filter @shoebox/bank test -- subset-sum 2>&1 | tail -30` → pass. Commit `0116 step 2`.

3. New `packages/bank/src/matcher/paid-at.ts`:
```ts
export interface DocAmountView { readonly amountDue: Money; readonly currency: string; readonly issueDate?: LegalDate; readonly isPaidPerDocument?: boolean }
export interface LinkView { readonly linkType: LinkType; readonly amount: Money; readonly bookedOn: LegalDate; readonly createdAt: string }
/** amount_due − tol; tol = roundingToleranceCzk for CZK, else 1 % of amount_due (unrounded). */
export function paidThreshold(doc: DocAmountView, cfg?: MatcherConfig): Money;
export function computePaidAt(doc: DocAmountView, links: readonly LinkView[], cfg?: MatcherConfig): LegalDate | null;
```
`computePaidAt`: `amountDue` not positive → `isPaidPerDocument ? (issueDate ?? null) : null`. Sort links by `bookedOn`, then `createdAt` (string compare), stable. `S = Money.zero(currency)`; for each link: `payment`, `offset`, `platform_payout`, `fx_difference` add; `refund` subtracts; `fee` ignored. After each link: `S ≥ threshold` and `paidAt === null` → `paidAt = bookedOn`; `S < threshold` → `paidAt = null`. Return `paidAt`.
New `packages/bank/test/paid-at.test.ts`, verbatim:
```ts
import { addDays, CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { computePaidAt, type LinkView, paidThreshold } from '../src/matcher/paid-at';

const D = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const doc = { amountDue: czk('1210.00'), currency: CZK, issueDate: D('2026-03-01') };
let seq = 0;
const link = (amount: string, bookedOn: string, linkType: LinkView['linkType'] = 'payment', currency = CZK): LinkView => ({
  linkType, amount: Money.parse(amount, currency), bookedOn: D(bookedOn), createdAt: `2026-03-01T00:00:${String(seq++).padStart(2, '0')}Z`,
});

describe('paidThreshold', () => {
  it('CZK tolerance 1.00, foreign 1 %', () => {
    expect(paidThreshold(doc).toFixed2()).toBe('1209.00');
    expect(paidThreshold({ amountDue: Money.parse('100.00', 'EUR'), currency: 'EUR' }).toFixed2()).toBe('99.00');
    expect(paidThreshold({ amountDue: Money.parse('250.50', 'EUR'), currency: 'EUR' }).toFixed2()).toBe('248.00');
  });
});

describe('computePaidAt', () => {
  it('full payment → its booked date', () => {
    expect(computePaidAt(doc, [link('1210.00', '2026-03-10')])).toBe('2026-03-10');
  });
  it('two partial payments → the date that closes the sum', () => {
    expect(computePaidAt(doc, [link('610.00', '2026-03-20'), link('600.00', '2026-03-10')])).toBe('2026-03-20');
  });
  it('rounding tolerance', () => {
    expect(computePaidAt(doc, [link('1209.00', '2026-03-10')])).toBe('2026-03-10');
    expect(computePaidAt(doc, [link('1208.99', '2026-03-10')])).toBeNull();
  });
  it('refund drops below, later payment re-closes', () => {
    const paid = link('1210.00', '2026-03-10');
    expect(computePaidAt(doc, [paid, link('1210.00', '2026-04-01', 'refund')])).toBeNull();
    expect(computePaidAt(doc, [paid, link('100.00', '2026-04-01', 'refund'), link('100.00', '2026-04-15')])).toBe('2026-04-15');
    expect(computePaidAt(doc, [paid, link('0.50', '2026-04-01', 'refund')])).toBe('2026-03-10');
  });
  it('fees do not count; offsets and payouts do', () => {
    expect(computePaidAt(doc, [link('1210.00', '2026-03-10', 'fee')])).toBeNull();
    expect(computePaidAt(doc, [link('1000.00', '2026-03-10', 'offset'), link('210.00', '2026-03-12', 'platform_payout')])).toBe('2026-03-12');
    expect(computePaidAt(doc, [link('1209.50', '2026-03-10'), link('0.50', '2026-03-10', 'fx_difference')])).toBe('2026-03-10');
  });
  it('foreign currency uses 1 %', () => {
    const eur = { amountDue: Money.parse('100.00', 'EUR'), currency: 'EUR' };
    expect(computePaidAt(eur, [link('99.20', '2026-03-10', 'payment', 'EUR')])).toBe('2026-03-10');
    expect(computePaidAt(eur, [link('98.90', '2026-03-10', 'payment', 'EUR')])).toBeNull();
  });
  it('amount_due ≤ 0', () => {
    const zero = { ...doc, amountDue: czk('0.00') };
    expect(computePaidAt(zero, [])).toBeNull();
    expect(computePaidAt({ ...zero, isPaidPerDocument: true }, [])).toBe('2026-03-01');
    expect(computePaidAt({ amountDue: czk('-5.00'), currency: CZK, isPaidPerDocument: true }, [])).toBeNull();
  });
  it('same day: created_at breaks the tie', () => {
    const a = { ...link('1210.00', '2026-03-10'), createdAt: '2026-03-10T10:00:00Z' };
    const r = { ...link('1210.00', '2026-03-10', 'refund'), createdAt: '2026-03-10T09:00:00Z' };
    expect(computePaidAt(doc, [a, r])).toBeNull();
    expect(computePaidAt(doc, [a, { ...r, createdAt: '2026-03-10T11:00:00Z' }])).toBeNull();
    expect(computePaidAt(doc, [{ ...r, createdAt: '2026-03-10T11:00:00Z' }, a, { ...a, createdAt: '2026-03-10T12:00:00Z' }])).toBe('2026-03-10');
  });
});

describe('computePaidAt properties (seeded, 1000 runs)', () => {
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const halere = (h: number) => czk(`${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`);
  const next = rng(20261018);
  const int = (max: number) => Math.floor(next() * max);
  const types: LinkView['linkType'][] = ['payment', 'payment', 'payment', 'refund', 'fee', 'offset'];
  const SIGN: Record<LinkView['linkType'], number> = { payment: 1, offset: 1, platform_payout: 1, fx_difference: 1, refund: -1, fee: 0 };

  it('A10/A11: null iff the final sum is below the threshold; date is the first prefix that reaches it', () => {
    for (let run = 0; run < 1000; run++) {
      const due = halere(1 + int(100000));
      const d = { amountDue: due, currency: CZK };
      const n = 1 + int(6);
      const links: LinkView[] = [];
      for (let i = 0; i < n; i++) {
        links.push({
          linkType: types[int(types.length)]!, amount: halere(int(60000)),
          bookedOn: addDays(D('2026-01-01'), int(365)), createdAt: `2026-01-01T00:00:00.${String(int(1000)).padStart(3, '0')}Z`,
        });
      }
      const threshold = paidThreshold(d);
      const sorted = [...links].sort((a, b) => (a.bookedOn < b.bookedOn ? -1 : a.bookedOn > b.bookedOn ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      let sum = Money.zero(CZK);
      let expected: string | null = null;
      for (const l of sorted) {
        const s = SIGN[l.linkType];
        if (s === 1) sum = sum.add(l.amount);
        if (s === -1) sum = sum.subtract(l.amount);
        if (sum.compare(threshold) >= 0) expected = expected ?? l.bookedOn;
        else expected = null;
      }
      const result = computePaidAt(d, links);
      expect(result).toBe(expected);
      expect(result === null).toBe(sum.compare(threshold) < 0);
      if (result !== null) expect(links.some((l) => l.bookedOn === result)).toBe(true);
      const withZero = [...links, { linkType: 'payment' as const, amount: czk('0.00'), bookedOn: D('2026-12-31'), createdAt: '2026-12-31T00:00:00Z' }];
      expect(computePaidAt(d, withZero)).toBe(result);
    }
  });
});
```
Run `pnpm --filter @shoebox/bank test -- paid-at 2>&1 | tail -30` → pass. Commit `0116 step 3`.

4. New `packages/bank/src/matcher/classify.ts`:
```ts
export interface AuthorityRules {
  readonly fu: { readonly bankCode: string; readonly prefixMap: Readonly<Record<string, string>>; readonly vatRefundCategory: string };
  /** `[prefix-]number/bank` → category (ČSSZ, insurers, municipalities). */
  readonly accounts: readonly { readonly account: string; readonly category: string }[];
  /** Folded upper-case whole-word patterns → suggested category; longest first. */
  readonly nameHints: readonly { readonly pattern: string; readonly category: string }[];
}
/** Reads the `bank.authority_accounts` rule value (shape seeded in 0117); throws Error('bank.authority_accounts: fu missing') otherwise. */
export function authorityRulesOf(value: Readonly<Record<string, unknown>>): AuthorityRules;
export interface OwnAccount { readonly id: string; readonly account?: string; readonly bankCode?: string; readonly iban?: string }
export type RuleReason = 'own_transfer' | 'fu_prefix' | 'vat_refund' | 'authority_account' | 'name_hint' | 'fee' | 'interest' | 'interest_tax' | 'atm' | 'cash_deposit';
export interface RuleOutcome { readonly categoryCode: string; readonly mode: 'auto' | 'suggest'; readonly reason: RuleReason; readonly pairedAccountId?: string }
export function classifyByRules(t: TxView, rules: AuthorityRules, own: readonly OwnAccount[]): RuleOutcome | null;
/** The incoming/outgoing counterpart on `pairedAccountId`: opposite amount, |Δ booked_on| ≤ 3 days; nearest date, then lexical id. */
export function findOwnTransferPair(t: TxView, pairedAccountId: string, candidates: readonly TxView[]): TxView | null;
```
Rule value shape (`authorityRulesOf` reads it; every part optional except `fu`): `{ fu: { bank_code, prefix_map: { [prefix]: category }, vat_refund_category }, cssz: { category, accounts: string[] }, insurers: { category, accounts }, municipalities: { category, accounts }, name_hints: { [pattern]: category } }`. `accounts` = the union of the three lists with their group's category; `nameHints` sorted by pattern length desc.
`classifyByRules` with `txAccount` = `counterpartyAccount/counterpartyBankCode` when both set, `msg = foldText(message ?? '')`, `out = amount.isNegative()`, `inc = amount.isPositive()`, `noCounterparty = !counterpartyAccount && !counterpartyIban`, in this order, first hit wins:
1. own transfer: an own account `o` with `o.id !== t.moneyAccountId` and (`o.account && o.bankCode && \`${o.account}/${o.bankCode}\` === txAccount` or `o.iban && t.counterpartyIban && o.iban.toUpperCase() === t.counterpartyIban.toUpperCase()`) → `{ 'transfer_own_accounts', 'suggest', 'own_transfer', pairedAccountId: o.id }`.
2. FÚ: `counterpartyBankCode === fu.bankCode` and the prefix of `counterpartyAccount` (text before `-`; none → no prefix) is a key of `prefixMap` → `out` → `{ prefixMap[prefix], 'auto', 'fu_prefix' }`; `inc` → `{ fu.vatRefundCategory, 'suggest', 'vat_refund' }`.
3. `out` and `txAccount` in `rules.accounts` → `{ category, 'auto', 'authority_account' }`.
4. name hint: `name = foldText(counterpartyName ?? '').replace(/\s+/g, ' ')`; the first pattern with `\` ${name} \`.includes(\` ${pattern} \`)` → `{ category, 'suggest', 'name_hint' }`.
5. `noCounterparty` and `out` and `/DAN Z UROKU/.test(msg)` → `tax_other_fees`, auto, `interest_tax`.
6. `noCounterparty` and `out` and `/^(POPLATEK|CENA ZA|VEDENI UCTU|MESICNI POPLATEK|FEE)\b/.test(msg)` → `exp_bank_fees`, auto, `fee`.
7. `noCounterparty` and `inc` and `/\bUROK|\bINTEREST\b/.test(msg)` → `income_interest`, auto, `interest`.
8. `out` and `/VYBER Z BANKOMATU|VYBER HOTOVOSTI|\bATM\b/.test(msg)` → `transfer_cash_withdrawal`, auto, `atm`; `inc` and `/VKLAD HOTOVOSTI|VKLAD NA UCET|\bATM\b/.test(msg)` → `transfer_cash_deposit`, auto, `cash_deposit`.
9. else null.
New `packages/bank/test/classify.test.ts`, verbatim:
```ts
import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { authorityRulesOf, classifyByRules, findOwnTransferPair, type OwnAccount } from '../src/matcher/classify';
import type { TxView } from '../src/matcher/types';

const D = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
function tx(over: Partial<TxView> = {}): TxView {
  return { id: 't1', moneyAccountId: 'acc', currency: CZK, bookedOn: D('2026-03-10'), amount: czk('-5000.00'), ...over };
}
const rules = authorityRulesOf({
  fu: { bank_code: '0710', prefix_map: { '705': 'tax_vat_payment', '2866': 'tax_pausal_advance' }, vat_refund_category: 'income_vat_refund' },
  cssz: { category: 'ins_social_own', accounts: ['1003-1234567899/0800'] },
  insurers: { category: 'ins_health_own', accounts: [] },
  name_hints: { 'FINANCNI URAD': 'tax_other_fees', OSSZ: 'ins_social_own', 'ZDRAVOTNI POJISTOVNA': 'ins_health_own', VZP: 'ins_health_own' },
});
const own: OwnAccount[] = [
  { id: 'acc', account: '2400123455', bankCode: '2010', iban: 'CZ8720100000002400123455' },
  { id: 'acc2', account: '1003-1234567899', bankCode: '0800' },
];
const fu = (prefix: string, over: Partial<TxView> = {}) =>
  tx({ counterpartyAccount: `${prefix}-1234567890`, counterpartyBankCode: '0710', ...over });

describe('authorityRulesOf', () => {
  it('reads the rule value', () => {
    expect(rules.fu).toEqual({ bankCode: '0710', prefixMap: { '705': 'tax_vat_payment', '2866': 'tax_pausal_advance' }, vatRefundCategory: 'income_vat_refund' });
    expect(rules.accounts).toEqual([{ account: '1003-1234567899/0800', category: 'ins_social_own' }]);
    expect(rules.nameHints[0]).toEqual({ pattern: 'ZDRAVOTNI POJISTOVNA', category: 'ins_health_own' });
    expect(() => authorityRulesOf({})).toThrow('bank.authority_accounts: fu missing');
  });
});

describe('classifyByRules', () => {
  it('FÚ prefixes', () => {
    expect(classifyByRules(fu('705'), rules, [])).toEqual({ categoryCode: 'tax_vat_payment', mode: 'auto', reason: 'fu_prefix' });
    expect(classifyByRules(fu('2866'), rules, [])).toEqual({ categoryCode: 'tax_pausal_advance', mode: 'auto', reason: 'fu_prefix' });
    expect(classifyByRules(fu('999'), rules, [])).toBeNull();
    expect(classifyByRules(fu('705', { amount: czk('1200.00') }), rules, [])).toEqual({ categoryCode: 'income_vat_refund', mode: 'suggest', reason: 'vat_refund' });
    expect(classifyByRules(fu('705', { counterpartyBankCode: '0800' }), rules, [])).toBeNull();
  });
  it('authority account list and name hints', () => {
    const cssz = tx({ counterpartyAccount: '1003-1234567899', counterpartyBankCode: '0800' });
    expect(classifyByRules(cssz, rules, [])).toEqual({ categoryCode: 'ins_social_own', mode: 'auto', reason: 'authority_account' });
    expect(classifyByRules(tx({ counterpartyName: 'OSSZ Praha 3' }), rules, [])).toEqual({ categoryCode: 'ins_social_own', mode: 'suggest', reason: 'name_hint' });
    expect(classifyByRules(tx({ counterpartyName: 'Finanční úřad pro hl. m. Prahu' }), rules, [])).toEqual({ categoryCode: 'tax_other_fees', mode: 'suggest', reason: 'name_hint' });
    expect(classifyByRules(tx({ counterpartyName: 'Všeobecná zdravotní pojišťovna ČR' }), rules, [])).toEqual({ categoryCode: 'ins_health_own', mode: 'suggest', reason: 'name_hint' });
    expect(classifyByRules(tx({ counterpartyName: 'VZPX s.r.o.' }), rules, [])).toBeNull();
  });
  it('fees, interest, ATM', () => {
    expect(classifyByRules(tx({ amount: czk('-59.00'), message: 'Poplatek za vedení účtu' }), rules, [])).toEqual({ categoryCode: 'exp_bank_fees', mode: 'auto', reason: 'fee' });
    expect(classifyByRules(tx({ amount: czk('-59.00'), message: 'Poplatek', counterpartyAccount: '2400123455', counterpartyBankCode: '2010' }), rules, [])).toBeNull();
    expect(classifyByRules(tx({ amount: czk('0.37'), message: 'Úrok' }), rules, [])).toEqual({ categoryCode: 'income_interest', mode: 'auto', reason: 'interest' });
    expect(classifyByRules(tx({ amount: czk('-0.06'), message: 'Daň z úroku' }), rules, [])).toEqual({ categoryCode: 'tax_other_fees', mode: 'auto', reason: 'interest_tax' });
    expect(classifyByRules(tx({ amount: czk('-2000.00'), message: 'Výběr z bankomatu' }), rules, [])).toEqual({ categoryCode: 'transfer_cash_withdrawal', mode: 'auto', reason: 'atm' });
    expect(classifyByRules(tx({ amount: czk('2000.00'), message: 'Vklad hotovosti' }), rules, [])).toEqual({ categoryCode: 'transfer_cash_deposit', mode: 'auto', reason: 'cash_deposit' });
    expect(classifyByRules(tx({ amount: czk('-2000.00'), message: 'Platba kartou' }), rules, [])).toBeNull();
  });
  it('own transfers by account or IBAN, never to the same account', () => {
    const t = tx({ counterpartyAccount: '1003-1234567899', counterpartyBankCode: '0800' });
    expect(classifyByRules(t, rules, own)).toEqual({ categoryCode: 'transfer_own_accounts', mode: 'suggest', reason: 'own_transfer', pairedAccountId: 'acc2' });
    const byIban = tx({ moneyAccountId: 'acc2', amount: czk('5000.00'), counterpartyIban: 'cz8720100000002400123455' });
    expect(classifyByRules(byIban, rules, own)?.pairedAccountId).toBe('acc');
    expect(classifyByRules(tx({ counterpartyAccount: '2400123455', counterpartyBankCode: '2010' }), rules, own)).toBeNull();
  });
});

describe('findOwnTransferPair', () => {
  const t = tx({ counterpartyAccount: '1003-1234567899', counterpartyBankCode: '0800' });
  const pair = (over: Partial<TxView>) => tx({ id: 'p', moneyAccountId: 'acc2', amount: czk('5000.00'), ...over });
  it('pairs the opposite amount within 3 days, nearest first', () => {
    const far = pair({ id: 'far', bookedOn: D('2026-03-13') });
    const near = pair({ id: 'near', bookedOn: D('2026-03-11') });
    expect(findOwnTransferPair(t, 'acc2', [far, near])?.id).toBe('near');
    expect(findOwnTransferPair(t, 'acc2', [pair({ id: 'b', bookedOn: D('2026-03-09') }), pair({ id: 'a', bookedOn: D('2026-03-11') })])?.id).toBe('a');
  });
  it('rejects wrong account, amount, sign or distance', () => {
    expect(findOwnTransferPair(t, 'acc2', [pair({ bookedOn: D('2026-03-14') })])).toBeNull();
    expect(findOwnTransferPair(t, 'acc2', [pair({ amount: czk('4999.00') })])).toBeNull();
    expect(findOwnTransferPair(t, 'acc2', [pair({ amount: czk('-5000.00') })])).toBeNull();
    expect(findOwnTransferPair(t, 'acc2', [pair({ moneyAccountId: 'acc' })])).toBeNull();
    expect(findOwnTransferPair(t, 'acc2', [])).toBeNull();
  });
});
```
Run `pnpm --filter @shoebox/bank test -- classify 2>&1 | tail -30` → pass. Commit `0116 step 4`.

5. In `packages/bank/src/matcher/index.ts` add, above `export * from './config';`:
```ts
export * from './assign';
export * from './classify';
```
and above `export * from './score';`:
```ts
export * from './paid-at';
```
and below `export * from './score';`:
```ts
export * from './subset-sum';
```
Run `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -10` → no errors. Commit `0116 step 5`.

## 5. Do not touch

Every file of 0115 except `matcher/index.ts`; `packages/domain/`, `packages/db/`, `apps/`. Hard rules 1 (haléře from `toFixed2`, never `Number`), 4 (synthetic data), 7 (no dependency: the property test uses its own seeded generator, not fast-check).

## 6. Commands

- `pnpm --filter @shoebox/bank test -- matcher-assign 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/bank test -- subset-sum 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/bank test -- paid-at 2>&1 | tail -30` → pass (1000 seeded runs included).
- `pnpm --filter @shoebox/bank test -- classify 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -30` → no errors.

## 7. Acceptance

- [ ] The four test files pass unchanged.
- [ ] `assign` twice on the same input is deep-equal (test "is idempotent", I4).
- [ ] `grep -n "Number(\|parseFloat" packages/bank/src/matcher/subset-sum.ts packages/bank/src/matcher/paid-at.ts packages/bank/src/matcher/assign.ts` prints nothing.
- [ ] Category codes in `classify.ts` are exactly those listed in §2 (no new code).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong (name the value and your computation);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear.

## 9. Report

Write `docs/tasks/0116-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left (none expected).

## Risk list (for the reviewer)

`assign.ts` (capacities, margin), `paid-at.ts` (threshold, refund handling), `subset-sum.ts` (`toHalere` sign and rounding), `classify.ts` (auto vs suggest).

## Owner steps

None.
