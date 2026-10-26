# 0115: Matcher core: config, text, dates, amount, candidates, score

Status: todo
Ticket: P2-MATCH-02 | Depends on: 0107 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
<!-- Risk: HIGH (money). Pure functions only; no I/O, no DB. -->

## 1. Objective

The pure heart of bank payment matching: for one bank transaction and the open documents, find the candidate documents and give each pair an explainable score (M07 §4.6.2, §4.6.3). Later briefs (0116 assignment, 0118 worker) build on these functions; nothing here touches the database.

## 2. Context

Money is never a float (`Money` from `@shoebox/domain`, ADR-007). Scores and date factors are plain numbers (they are not money). Tolerances live in `MATCHER_CONFIG` as strings and become `Money` with `Money.parse`.

From `@shoebox/domain`: `Money.parse(text, currency)`, `Money.zero`, `Money.fromDecimal(decimal, currency)`, `m.add`, `m.subtract`, `m.abs()`, `m.negate()`, `m.compare(o)` (−1|0|1), `m.equals`, `m.isZero()`, `m.isPositive()`, `m.toDecimal()` (decimal.js), `m.toFixed2()`, `m.currency`, `round2(m)`, `CZK`, `type LegalDate`, `parseLegalDate`, `addDays(date, days)`, `compareLegalDates`, types `DocumentClass`, `DocumentStatus`, `MatchMethod` (`'vs_amount'|'vs_only'|'amount_date_counterparty'|'card_merchant_fuzzy'|'platform_statement'|'manual'|'document_evidence'`).

From `packages/bank/src/normalize.ts`: `export function parseSymbol(text: string | null | undefined): string | null` (digits only, leading zeros stripped, `''` → null).

`packages/bank/src/index.ts` today:
```ts
export * from './parsers/mt940';
export type * from './types';
```

M07 §4.6 `MATCHER_CONFIG` (copy verbatim into `config.ts`, see step 1). §4.6.3 feature table, caps and date windows are restated in the steps. Worked examples that the tests encode (σ = logistic, `f_date = 1`): VS + exact amount → σ(4.5) = 0.989; account + exact, no VS → σ(3.0) = 0.953; exact + date only → σ(0.5) = 0.622, with uniqueness σ(1.5) = 0.818; VS + exact but outside the window → σ(2.0) = 0.881; VS + partial → σ(2.5) = 0.924.

Synthetic data only: accounts `2400123455/2010` and `1003-1234567899/0800` are the allowlisted test vectors. Never write a real account, name or 10-digit number into a test.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/bank/src/matcher/config.ts` | new | `MATCHER_CONFIG`, `MatcherConfig` |
| `packages/bank/src/matcher/types.ts` | new | views, candidate, score types |
| `packages/bank/src/matcher/text.ts` | new | `foldText`, `normMerchant`, `normName`, `levenshtein`, `tokenSetRatio`, `docKeys`, `messageHasDocKey` |
| `packages/bank/src/matcher/dates.ts` | new | `daysBetween`, `windowKindOf`, `dateFactor` |
| `packages/bank/src/matcher/amount.ts` | new | `compareAmount` |
| `packages/bank/src/matcher/candidates.ts` | new | `isEligible`, `generateCandidates` |
| `packages/bank/src/matcher/score.ts` | new | `sigmoid`, `scoreCandidate`, `scoreBatch` |
| `packages/bank/src/matcher/index.ts` | new | re-exports of the seven files |
| `packages/bank/src/index.ts` | edit | `export * from './matcher/index';` |
| `packages/bank/test/matcher-text.test.ts` | new | verbatim below |
| `packages/bank/test/matcher-candidates.test.ts` | new | verbatim below |
| `packages/bank/test/matcher-score.test.ts` | new | verbatim below |

No other file may change.

## 4. Steps

1. New `packages/bank/src/matcher/config.ts`:
```ts
/** M07 §4.6: matcher configuration (product, not law). `version` is stored on every link and suggestion. */
export const MATCHER_CONFIG = {
  version: 1,
  autoThreshold: 0.9, suggestThreshold: 0.6, minMargin: 0.1,
  roundingToleranceCzk: '1.00', bankFxTolerancePct: '2', cardFxTolerancePct: '3',
  weights: { bias: -4.0, amountExact: 3.0, amountRounding: 2.5, amountFxMax: 1.5, amountPartial: 1.0,
             vsExact: 4.0, vsConflict: -3.0, msgDocNumber: 3.0, accountMatch: 2.5, accountOtherPartner: -3.0,
             nameMax: 3.0, dateMax: 1.5, dateOutside: -1.0, alias: 1.0, unique: 1.0 },
  windows: { transfer: { before: 3, after: 45, plateauAfterDue: 5, defaultDueDays: 30 },
             card: { before: 3, after: 7, plateau: 1 }, payout: { before: 5, after: 5 },
             filing: { before: 0, after: 30 } },
  subsetSum: { maxDocs: 20, maxSubsetSize: 6 },
  cardEvidenceWaitDays: 10, radarGraceDays: 7 /* = 'radar.grace_days' read by M09 */, sweepLookbackDays: 400,
} as const;
export type MatcherConfig = typeof MATCHER_CONFIG;
```
New `packages/bank/src/matcher/types.ts` with exactly these exports (add doc comments freely):
```ts
import type { DocumentClass, DocumentStatus, LegalDate, MatchMethod, Money } from '@shoebox/domain';

export interface TxView {
  readonly id: string;
  readonly moneyAccountId: string;
  readonly bookedOn: LegalDate;
  /** Signed, account currency (+ incoming, − outgoing). */
  readonly amount: Money;
  readonly currency: string;
  /** Signed, original currency, when the bank gives one. */
  readonly amountOriginal?: Money;
  /** |amount| − Σ linked account-currency amounts; undefined = nothing linked yet. */
  readonly remaining?: Money;
  readonly counterpartyName?: string;
  /** Normalised `[prefix-]number` (no leading zeros). */
  readonly counterpartyAccount?: string;
  readonly counterpartyBankCode?: string;
  readonly counterpartyIban?: string;
  /** Normalised (digits, no leading zeros). */
  readonly vs?: string;
  readonly message?: string;
  readonly cardMerchant?: string;
  readonly bankTxCode?: string;
}
export interface DocView {
  readonly id: string;
  readonly cls: DocumentClass;
  readonly status: DocumentStatus;
  readonly direction: 'in' | 'out' | null;
  readonly currency: string;
  /** coalesce(amount_due, total_gross), document currency. */
  readonly amountDue: Money;
  /** amountDue − Σ links (M07 §4.6.2), document currency. */
  readonly openAmount: Money;
  readonly documentNumber?: string;
  readonly variableSymbol?: string;
  readonly issueDate?: LegalDate;
  readonly dueDate?: LegalDate;
  readonly servicePeriodTo?: LegalDate;
  readonly paymentMethod?: string;
  readonly partnerId?: string;
  readonly partnerName?: string;
  /** pay_to_account plus partner_bank_accounts, each `[prefix-]number/bank` or an IBAN. */
  readonly partnerAccounts: readonly string[];
  /** ISO timestamp; tie-breaker only. */
  readonly createdAt: string;
}
export interface AliasView {
  readonly kind: 'account' | 'merchant' | 'name';
  readonly value: string;
  readonly partnerId: string;
  readonly confirmations: number;
}
export interface MatchContext {
  readonly aliases: readonly AliasView[];
  /** `${transactionId}:${documentId}` of suggestions the user rejected. */
  readonly rejected: ReadonlySet<string>;
  /** partner_bank_accounts: `[prefix-]number/bank` or IBAN → partner. */
  readonly knownAccounts: readonly { readonly value: string; readonly partnerId: string }[];
  /** Partners that used a VS on at least one confirmed match. */
  readonly partnersWithVsHistory: ReadonlySet<string>;
  /** Account-currency units per one unit of `currency` on `on` (decimal string); null = unknown. */
  readonly fxRate: (currency: string, on: LegalDate) => string | null;
}
export type RetrievalKey = 'vs' | 'message' | 'amount' | 'account' | 'name';
export interface Candidate { readonly t: TxView; readonly d: DocView; readonly via: readonly RetrievalKey[] }
export type AmountKind = 'exact' | 'rounding' | 'fx' | 'partial' | 'overpayment';
export interface AmountFeature {
  readonly kind: AmountKind;
  /** fx: 1 − |Δ%| / tol%; otherwise 1. */
  readonly ratio: number;
  /** Proposed link amount, document currency. */
  readonly amountDoc: Money;
  /** Proposed link amount, account currency. */
  readonly amountAccount: Money;
}
export type FeatureCode = 'amount_exact' | 'amount_rounding' | 'amount_fx' | 'amount_partial' | 'vs_exact' | 'vs_conflict'
  | 'msg_doc_number' | 'account_match' | 'account_other_partner' | 'name' | 'date' | 'date_outside' | 'alias' | 'unique';
export interface Feature { readonly code: FeatureCode; readonly contribution: number }
export interface CandidateScore {
  readonly transactionId: string;
  readonly documentId: string;
  /** σ(logit) rounded to 3 decimals, then capped (M07 §4.6.3). */
  readonly score: number;
  readonly logit: number;
  readonly features: readonly Feature[];
  readonly method: MatchMethod;
  readonly amount: AmountFeature;
  readonly txRemaining: Money;
  readonly docOpen: Money;
  readonly anchorDistanceDays: number;
  readonly dueDate?: LegalDate;
  readonly docCreatedAt: string;
  readonly capped: boolean;
}
```
Run `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -10` → no errors. Commit `0115 step 1`.

2. New `packages/bank/src/matcher/text.ts` (pure, no dependency; `parseSymbol` from `../normalize`):
```ts
export function foldText(s: string): string;            // NFD, strip combining marks (̀-ͯ), uppercase, trim
export function normMerchant(s: string): string;
export function normName(s: string): string;            // same as normMerchant
export function levenshtein(a: string, b: string): number;
export function tokenSetRatio(a: string, b: string): number;   // 0..1
export function docKeys(d: { documentNumber?: string; variableSymbol?: string }): string[];
export function messageHasDocKey(message: string | undefined, d: { documentNumber?: string; variableSymbol?: string }): boolean;
```
`normMerchant`, in this order: (1) `foldText`; (2) strip a leading `/^(PAYPAL|SUMUP|SQ|GOOGLE)\s*\*\s*/`; (3) replace `APPLE.COM/BILL` → `APPLE` and `AMZN MKTP` → `AMAZON`; (4) replace every character not in `A-Z0-9.` by a space, split on whitespace; (5) per token: strip a leading `WWW.`; strip one trailing `.COM`, `.CZ`, `.SK`, `.EU`, `.DE`, `.NET` or `.ORG`; remove remaining dots; drop the token when it is empty, pure digits, exactly 2 characters, `WWW`, a legal form (`SRO`, `AS`, `BV`, `LTD`, `LIMITED`, `INC`, `GMBH`, `SE`, `SPOL`, `VOS`, `KS`, `PLC`, `LLC`, `SA`, `AG`) or a city (`PRAHA`, `BRNO`, `OSTRAVA`, `PLZEN`, `LIBEREC`, `OLOMOUC`, `PARDUBICE`, `ZLIN`, `JIHLAVA`, `KLADNO`, `TEPLICE`, `OPAVA`, `HAVIROV`); (6) join with one space.
`tokenSetRatio`: tokens = split on whitespace, unique; if either side has no token → 0. `I` = sorted intersection, `A` = sorted rest of a, `B` = sorted rest of b; `t0 = I.join(' ')`, `t1 = [t0, ...A].filter(Boolean).join(' ')`, `t2 = [t0, ...B].filter(Boolean).join(' ')`; `ratio(x, y) = 1 − levenshtein(x, y) / max(x.length, y.length)` (1 when both empty); result `max(ratio(t0,t1), ratio(t0,t2), ratio(t1,t2))`.
`docKeys`: the set of `parseSymbol(variableSymbol)`, `parseSymbol(digits of documentNumber)` when those digits are 1–10 long, and `parseSymbol(last 10 of the digits)`; drop nulls, unique, sorted.
`messageHasDocKey`: false without message; tokens = `foldText(message).split(/[^A-Z0-9]+/)`; a pure-digit token is compared after `parseSymbol`; true when a token is in `docKeys(d)`, or when `foldText(documentNumber)` (non-empty) occurs in `foldText(message)` bounded by start/end or a non-`[A-Z0-9]` character.
New `packages/bank/test/matcher-text.test.ts`, verbatim:
```ts
import { parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { dateFactor, daysBetween, windowKindOf } from '../src/matcher/dates';
import { docKeys, foldText, levenshtein, messageHasDocKey, normMerchant, tokenSetRatio } from '../src/matcher/text';

const D = parseLegalDate;

describe('foldText / normMerchant', () => {
  it('folds diacritics and case', () => {
    expect(foldText('  Česká spořitelna ')).toBe('CESKA SPORITELNA');
  });
  it.each([
    ['PAYPAL *SPOTIFY 40293577 LU', 'SPOTIFY'],
    ['SumUp  *Kavarna U Lipy', 'KAVARNA U LIPY'],
    ['Alza.cz a.s., Praha', 'ALZA'],
    ['IKEA Zlicin CZ', 'IKEA ZLICIN'],
    ['www.rohlik.cz', 'ROHLIK'],
    ['AMZN Mktp DE', 'AMAZON'],
    ['APPLE.COM/BILL', 'APPLE'],
    ['Alfa Servis s.r.o.', 'ALFA SERVIS'],
    ['Česká spořitelna, a.s.', 'CESKA SPORITELNA'],
    ['', ''],
  ])('normMerchant(%j) = %j', (input, expected) => {
    expect(normMerchant(input)).toBe(expected);
  });
});

describe('levenshtein / tokenSetRatio', () => {
  it('counts edits', () => {
    expect(levenshtein('KITTEN', 'SITTING')).toBe(3);
    expect(levenshtein('', 'ALFA')).toBe(4);
    expect(levenshtein('ALFA', 'ALFA')).toBe(0);
  });
  it('is 1 for equal token sets and subsets', () => {
    expect(tokenSetRatio('ALFA SERVIS', 'ALFA SERVIS')).toBe(1);
    expect(tokenSetRatio('ALFA SERVIS', 'SERVIS ALFA')).toBe(1);
    expect(tokenSetRatio('ALFA', 'ALFA SERVIS')).toBe(1);
  });
  it('is partial for near names and 0 for empty input', () => {
    expect(tokenSetRatio('ALFA', 'BETA')).toBeCloseTo(0.25, 6);
    expect(tokenSetRatio('ALFA SERVIS', 'ALFA SERVICE')).toBeCloseTo(0.8333, 3);
    expect(tokenSetRatio('', 'ALFA')).toBe(0);
    expect(tokenSetRatio('', '')).toBe(0);
  });
});

describe('docKeys / messageHasDocKey', () => {
  it('builds keys from VS and document number', () => {
    expect(docKeys({ documentNumber: 'FV2026001', variableSymbol: '2026001' })).toEqual(['2026001']);
    expect(docKeys({ documentNumber: '2026-0000123456' })).toEqual(['123456']);
    expect(docKeys({ variableSymbol: '0000123' })).toEqual(['123']);
    expect(docKeys({ documentNumber: 'F-7' })).toEqual(['7']);
    expect(docKeys({})).toEqual([]);
  });
  it('finds keys as whole tokens in the message', () => {
    const d = { documentNumber: 'FV2026001', variableSymbol: '2026001' };
    expect(messageHasDocKey('Faktura FV2026001 dekujeme', d)).toBe(true);
    expect(messageHasDocKey('uhrada 2026001', d)).toBe(true);
    expect(messageHasDocKey('platba 0002026001', d)).toBe(true);
    expect(messageHasDocKey('uhrada 12026001', d)).toBe(false);
    expect(messageHasDocKey(undefined, d)).toBe(false);
    expect(messageHasDocKey('faktura 2026-0000123456 ', { documentNumber: '2026-0000123456' })).toBe(true);
  });
});

describe('dates', () => {
  const doc = { issueDate: D('2026-03-01'), dueDate: D('2026-03-15') };
  it('daysBetween', () => {
    expect(daysBetween(D('2026-03-01'), D('2026-03-10'))).toBe(9);
    expect(daysBetween(D('2026-03-10'), D('2026-03-01'))).toBe(-9);
  });
  it('windowKindOf', () => {
    expect(windowKindOf({}, { cls: 'received_invoice' })).toBe('transfer');
    expect(windowKindOf({ cardMerchant: 'IKEA' }, { cls: 'received_invoice' })).toBe('card');
    expect(windowKindOf({}, { cls: 'received_receipt', paymentMethod: 'card' })).toBe('card');
    expect(windowKindOf({}, { cls: 'platform_statement' })).toBe('payout');
    expect(windowKindOf({}, { cls: 'government_filing' })).toBe('filing');
  });
  it.each([
    ['2026-03-10', 1, false, 0],
    ['2026-03-20', 1, false, 0],
    ['2026-02-27', 1 / 3, false, 2],
    ['2026-02-26', 0, false, 3],
    ['2026-04-09', 0.5, false, 20],
    ['2026-04-29', 0, false, 40],
    ['2026-04-30', 0, true, 41],
    ['2026-02-25', 0, true, 4],
  ])('transfer %s → f %d outside %s dist %d', (x, f, outside, dist) => {
    const r = dateFactor('transfer', D(x), doc);
    expect(r.f).toBeCloseTo(f, 6);
    expect(r.outside).toBe(outside);
    expect(r.anchorDistanceDays).toBe(dist);
  });
  it('transfer without due date uses issue + 30', () => {
    const d = { issueDate: D('2026-03-01') };
    expect(dateFactor('transfer', D('2026-04-05'), d).f).toBe(1);
    expect(dateFactor('transfer', D('2026-04-06'), d).f).toBeCloseTo(0.975, 6);
  });
  it('missing issue date is neutral', () => {
    expect(dateFactor('transfer', D('2026-03-10'), {})).toEqual({ f: 0, outside: false, anchorDistanceDays: 0 });
  });
  it.each([
    ['2026-03-02', 1, false, 1],
    ['2026-02-27', 0.5, false, 2],
    ['2026-03-05', 0.5, false, 4],
    ['2026-03-09', 0, true, 8],
  ])('card %s → f %d outside %s', (x, f, outside, dist) => {
    const r = dateFactor('card', D(x), doc);
    expect(r.f).toBeCloseTo(f, 6);
    expect(r.outside).toBe(outside);
    expect(r.anchorDistanceDays).toBe(dist);
  });
  it('payout anchors on due date, else service period end', () => {
    expect(dateFactor('payout', D('2026-03-17'), doc).f).toBeCloseTo(0.6, 6);
    expect(dateFactor('payout', D('2026-03-21'), doc).outside).toBe(true);
    expect(dateFactor('payout', D('2026-03-31'), { servicePeriodTo: D('2026-03-31') }).f).toBe(1);
  });
  it('filing plateau from period end to due + 30', () => {
    const f = { servicePeriodTo: D('2026-03-31'), dueDate: D('2026-04-25') };
    expect(dateFactor('filing', D('2026-04-10'), f)).toMatchObject({ f: 1, outside: false });
    expect(dateFactor('filing', D('2026-05-25'), f)).toMatchObject({ f: 1, outside: false });
    expect(dateFactor('filing', D('2026-05-26'), f)).toMatchObject({ f: 0, outside: true, anchorDistanceDays: 1 });
    expect(dateFactor('filing', D('2026-03-30'), f)).toMatchObject({ f: 0, outside: true, anchorDistanceDays: 1 });
  });
});
```
Implement `text.ts` and step 3's `dates.ts`, then run `pnpm --filter @shoebox/bank test -- matcher-text 2>&1 | tail -30` → pass. Commit `0115 step 2`.

3. New `packages/bank/src/matcher/dates.ts`:
```ts
export type WindowKind = 'transfer' | 'card' | 'payout' | 'filing';
export function daysBetween(from: LegalDate, to: LegalDate): number;     // to − from in whole days (Date.UTC)
export function windowKindOf(t: { cardMerchant?: string }, d: { cls: DocumentClass; paymentMethod?: string }): WindowKind;
export interface DateFactor { readonly f: number; readonly outside: boolean; readonly anchorDistanceDays: number }
export function dateFactor(kind: WindowKind, bookedOn: LegalDate,
  d: { issueDate?: LegalDate; dueDate?: LegalDate; servicePeriodTo?: LegalDate }, cfg?: MatcherConfig): DateFactor;
```
`windowKindOf`: `cardMerchant` set or `paymentMethod === 'card'` → `card`; `platform_statement`/`settlement_statement` → `payout`; `government_filing` → `filing`; else `transfer`. `dateFactor` with `x = bookedOn`, `w = cfg.windows[kind]` (M07 §4.6.3); a missing anchor returns `{ f: 0, outside: false, anchorDistanceDays: 0 }`:
- transfer: `issue = issueDate`, `due = dueDate ?? addDays(issue, defaultDueDays)`, plateau `[issue, due + plateauAfterDue]` → f 1, distance 0; `x` in `[issue − before, issue)` → `f = 1 − (issue − x) / before`, distance `issue − x`; `x` in `(due + plateauAfterDue, due + after]` → `f = 1 − (x − due − plateauAfterDue) / (after − plateauAfterDue)`, distance `x − due − plateauAfterDue`; further away → `f 0, outside true`, distance to the nearer plateau edge.
- card: anchor `issue`; `|x − issue| ≤ plateau` → 1; `x` in `[issue − before, issue − plateau)` → `f = (x − issue + before) / (before − plateau)`; `x` in `(issue + plateau, issue + after]` → `f = (issue + after − x) / (after − plateau)`; else outside. distance = `|x − issue|`.
- payout: anchor `dueDate ?? servicePeriodTo ?? issueDate`; `|x − anchor| ≤ after` → `f = 1 − |x − anchor| / after`; else outside. distance = `|x − anchor|`.
- filing: `periodEnd = servicePeriodTo ?? issueDate`, `due = dueDate ?? addDays(periodEnd, windows.transfer.defaultDueDays)`; `x` in `[periodEnd, due + after]` → 1, distance 0; else outside, distance to the nearer edge.
(Commit together with step 2.)

4. New `packages/bank/src/matcher/amount.ts`:
```ts
export function compareAmount(t: TxView, d: DocView, ctx: Pick<MatchContext, 'fxRate'>, vsExact: boolean, cfg?: MatcherConfig): AmountFeature | null;
```
`cmpAcc = t.remaining ?? t.amount.abs()`; `open = d.openAmount`; either not positive → null. `tol = Money.parse(cfg.roundingToleranceCzk, 'CZK')`.
- A, `d.currency === t.currency`: `delta = cmpAcc − open`. zero → `exact` (amountDoc `open`, amountAccount `cmpAcc`); `d.currency === 'CZK'` and `|delta| ≤ tol` → `rounding` (same amounts); `vsExact` and `cmpAcc < open` → `partial` (both `cmpAcc`); `vsExact` and `cmpAcc > open` → `overpayment` (both `open`); else null.
- B, `t.amountOriginal` present with `t.amountOriginal.currency === d.currency`: `cmpDoc = |amountOriginal|`; equal to `open` → `exact` (amountDoc `open`, amountAccount `cmpAcc`); `vsExact` and `cmpDoc < open` → `partial` (amountDoc `cmpDoc`, amountAccount `cmpAcc`); else null.
- C, otherwise: `rate = ctx.fxRate(d.currency, t.bookedOn)`; null → null. `openAcc = round2(Money.fromDecimal(open.toDecimal().mul(rate), t.currency))`; `tolPct = Number(t.cardMerchant ? cfg.cardFxTolerancePct : cfg.bankFxTolerancePct)`; `pct = |cmpAcc − openAcc| / openAcc × 100` (Decimal → number). `pct ≤ tolPct` → `fx`, `ratio = 1 − pct / tolPct`, amountDoc `open`, amountAccount `cmpAcc`; `vsExact` and `cmpAcc < openAcc` → `partial`, amountDoc `round2(Money.fromDecimal(cmpAcc.toDecimal().div(rate), d.currency))`, amountAccount `cmpAcc`; `vsExact` and `cmpAcc > openAcc` → `overpayment`, amountDoc `open`, amountAccount `openAcc`; else null.
`ratio` is 1 for every kind but `fx`.
New `packages/bank/src/matcher/candidates.ts`:
```ts
export function isEligible(t: Pick<TxView, 'amount'>, d: DocView): boolean;
export function generateCandidates(t: TxView, docs: readonly DocView[], ctx: MatchContext, cfg?: MatcherConfig): Candidate[];
```
`isEligible`: `status` ∈ `ready`, `finalized`, `needs_review`; `openAmount` positive; `t.amount` negative → (`direction === 'in'` and `cls` ∈ `received_invoice`, `received_receipt`, `received_advance_tax_doc`, `received_proforma`) or `cls === 'issued_credit_note'` or (`cls === 'government_filing'` and `amountDue` positive); `t.amount` positive → `cls` ∈ `issued_invoice`, `platform_statement`, `settlement_statement`, `received_credit_note`; zero amount → false.
`generateCandidates`: for each eligible `d`, collect `via` in the order `vs`, `message`, `amount`, `account`, `name`: (a) `t.vs` in `docKeys(d)`; (b) `messageHasDocKey(t.message, d)`; (c) `compareAmount(t, d, ctx, false, cfg) !== null` and `dateFactor(windowKindOf(t, d), t.bookedOn, d, cfg).outside === false`; (d) `txAccount = counterpartyAccount && counterpartyBankCode ? \`${counterpartyAccount}/${counterpartyBankCode}\` : undefined`, `txIban = counterpartyIban?.toUpperCase()`; match when either is in `d.partnerAccounts`, or `ctx.knownAccounts` has that value with `partnerId === d.partnerId`, or an alias `kind 'account'` with that value and `partnerId === d.partnerId`; (e) `src = normMerchant(t.cardMerchant ?? t.counterpartyName ?? '')`; non-empty and (`d.partnerName` and `tokenSetRatio(src, normName(d.partnerName)) ≥ 0.5`, or an alias `kind` merchant/name with `partnerId === d.partnerId` and `tokenSetRatio(src, alias.value) ≥ 0.5`). Keep docs with ≥ 1 key; sort by `via.length` desc, stable; `slice(0, 50)`.
New `packages/bank/test/matcher-candidates.test.ts`, verbatim:
```ts
import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { compareAmount } from '../src/matcher/amount';
import { generateCandidates, isEligible } from '../src/matcher/candidates';
import type { DocView, MatchContext, TxView } from '../src/matcher/types';

const D = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const eur = (s: string) => Money.parse(s, 'EUR');

function tx(over: Partial<TxView> = {}): TxView {
  return { id: 't1', moneyAccountId: 'acc', currency: CZK, bookedOn: D('2026-03-10'), amount: czk('-1210.00'), ...over };
}
function doc(over: Partial<DocView> = {}): DocView {
  return {
    id: 'd1', cls: 'received_invoice', status: 'ready', direction: 'in', currency: CZK,
    amountDue: czk('1210.00'), openAmount: czk('1210.00'), issueDate: D('2026-03-01'), dueDate: D('2026-03-15'),
    partnerAccounts: [], createdAt: '2026-03-01T10:00:00Z', ...over,
  };
}
const ctx: MatchContext = {
  aliases: [], rejected: new Set(), knownAccounts: [], partnersWithVsHistory: new Set(), fxRate: () => null,
};
const f2 = (m: Money) => m.toFixed2();

describe('compareAmount', () => {
  it('exact and rounding in CZK', () => {
    const a = compareAmount(tx(), doc(), ctx, false);
    expect(a).toMatchObject({ kind: 'exact', ratio: 1 });
    expect(f2(a!.amountDoc)).toBe('1210.00');
    expect(f2(a!.amountAccount)).toBe('1210.00');
    const r = compareAmount(tx({ amount: czk('-1210.50') }), doc(), ctx, false);
    expect(r?.kind).toBe('rounding');
    expect(f2(r!.amountDoc)).toBe('1210.00');
    expect(f2(r!.amountAccount)).toBe('1210.50');
    expect(compareAmount(tx({ amount: czk('-1211.50') }), doc(), ctx, false)).toBeNull();
  });
  it('partial and overpayment need an exact VS', () => {
    expect(compareAmount(tx({ amount: czk('-600.00') }), doc(), ctx, false)).toBeNull();
    const p = compareAmount(tx({ amount: czk('-600.00') }), doc(), ctx, true);
    expect(p?.kind).toBe('partial');
    expect(f2(p!.amountDoc)).toBe('600.00');
    const o = compareAmount(tx({ amount: czk('-1211.50') }), doc(), ctx, true);
    expect(o?.kind).toBe('overpayment');
    expect(f2(o!.amountDoc)).toBe('1210.00');
    expect(f2(o!.amountAccount)).toBe('1210.00');
  });
  it('uses the remaining amount of the transaction', () => {
    const a = compareAmount(tx({ remaining: czk('610.00') }), doc({ openAmount: czk('610.00') }), ctx, false);
    expect(a?.kind).toBe('exact');
    expect(compareAmount(tx({ remaining: czk('0.00') }), doc(), ctx, false)).toBeNull();
  });
  it('matches the original currency exactly', () => {
    const t = tx({ amount: czk('-2500.00'), amountOriginal: eur('-100.00') });
    const a = compareAmount(t, doc({ currency: 'EUR', amountDue: eur('100.00'), openAmount: eur('100.00') }), ctx, false);
    expect(a?.kind).toBe('exact');
    expect(f2(a!.amountDoc)).toBe('100.00');
    expect(f2(a!.amountAccount)).toBe('2500.00');
  });
  it('FX path with ČNB rate and tolerance', () => {
    const d = doc({ currency: 'EUR', amountDue: eur('100.00'), openAmount: eur('100.00') });
    const fx: MatchContext = { ...ctx, fxRate: () => '25' };
    const a = compareAmount(tx({ amount: czk('-2525.00') }), d, fx, false);
    expect(a?.kind).toBe('fx');
    expect(a!.ratio).toBeCloseTo(0.5, 6);
    expect(f2(a!.amountDoc)).toBe('100.00');
    expect(f2(a!.amountAccount)).toBe('2525.00');
    const card = compareAmount(tx({ amount: czk('-2525.00'), cardMerchant: 'X' }), d, fx, false);
    expect(card!.ratio).toBeCloseTo(0.6667, 3);
    expect(compareAmount(tx({ amount: czk('-2600.00') }), d, fx, false)).toBeNull();
    const o = compareAmount(tx({ amount: czk('-2600.00') }), d, fx, true);
    expect(o?.kind).toBe('overpayment');
    expect(f2(o!.amountAccount)).toBe('2500.00');
    const p = compareAmount(tx({ amount: czk('-1250.00') }), d, fx, true);
    expect(p?.kind).toBe('partial');
    expect(f2(p!.amountDoc)).toBe('50.00');
    expect(compareAmount(tx({ amount: czk('-2525.00') }), d, ctx, false)).toBeNull();
  });
});

describe('isEligible', () => {
  const out = tx();
  const inc = tx({ amount: czk('1210.00') });
  it.each([
    ['received_invoice', 'in', 'ready', '1210.00', out, true],
    ['received_invoice', 'in', 'duplicate', '1210.00', out, false],
    ['received_invoice', 'in', 'ready', '0.00', out, false],
    ['issued_invoice', 'out', 'ready', '1210.00', out, false],
    ['issued_invoice', 'out', 'ready', '1210.00', inc, true],
    ['issued_credit_note', 'out', 'ready', '1210.00', out, true],
    ['received_credit_note', 'in', 'ready', '1210.00', inc, true],
    ['government_filing', null, 'finalized', '1210.00', out, true],
    ['contract', 'in', 'ready', '1210.00', out, false],
    ['received_receipt', 'in', 'needs_review', '1210.00', out, true],
  ] as const)('%s %s %s open %s', (cls, direction, status, open, t, expected) => {
    const d = doc({ cls, direction, status, openAmount: czk(open), amountDue: czk(open) });
    expect(isEligible(t, d)).toBe(expected);
  });
});

describe('generateCandidates', () => {
  const t = tx({
    vs: '2026001', message: 'Faktura FV777', counterpartyAccount: '2400123455', counterpartyBankCode: '2010',
    counterpartyName: 'Alfa Servis',
  });
  const docs = [
    doc({ id: 'byVs', variableSymbol: '2026001', openAmount: czk('999.00'), partnerName: 'Beta' }),
    doc({ id: 'byMsg', documentNumber: 'FV777', openAmount: czk('999.00') }),
    doc({ id: 'byAmount', partnerName: 'Delta' }),
    doc({ id: 'byAccount', openAmount: czk('999.00'), partnerAccounts: ['2400123455/2010'], partnerName: 'Gamma' }),
    doc({ id: 'byName', openAmount: czk('999.00'), partnerName: 'Alfa Servis s.r.o.' }),
    doc({ id: 'none', openAmount: czk('999.00'), partnerName: 'Omega', variableSymbol: '555' }),
    doc({ id: 'both', variableSymbol: '2026001', partnerName: 'Zeta' }),
  ];
  it('retrieves by each key and reports the keys', () => {
    const c = generateCandidates(t, docs, ctx);
    const via = Object.fromEntries(c.map((x) => [x.d.id, x.via]));
    expect(via).toEqual({
      both: ['vs', 'amount'], byVs: ['vs'], byMsg: ['message'], byAmount: ['amount'], byAccount: ['account'], byName: ['name'],
    });
    expect(c[0]!.d.id).toBe('both');
  });
  it('amount retrieval respects the date window', () => {
    const old = doc({ id: 'old', issueDate: D('2025-01-01'), dueDate: D('2025-01-15'), partnerName: 'Delta' });
    expect(generateCandidates(t, [old], ctx)).toEqual([]);
  });
  it('account retrieval via partner_bank_accounts and aliases', () => {
    const d = doc({ id: 'p1', openAmount: czk('999.00'), partnerId: 'p1', partnerName: 'Gamma' });
    const known: MatchContext = { ...ctx, knownAccounts: [{ value: '2400123455/2010', partnerId: 'p1' }] };
    expect(generateCandidates(t, [d], known).map((x) => x.via)).toEqual([['account']]);
    const alias: MatchContext = { ...ctx, aliases: [{ kind: 'account', value: '2400123455/2010', partnerId: 'p1', confirmations: 1 }] };
    expect(generateCandidates(t, [d], alias).map((x) => x.via)).toEqual([['account']]);
    const other: MatchContext = { ...ctx, knownAccounts: [{ value: '2400123455/2010', partnerId: 'p2' }] };
    expect(generateCandidates(t, [d], other)).toEqual([]);
  });
  it('caps at 50 candidates', () => {
    const many = Array.from({ length: 60 }, (_, i) => doc({ id: `m${i}`, partnerName: 'Delta' }));
    expect(generateCandidates(tx(), many, ctx)).toHaveLength(50);
  });
});
```
Run `pnpm --filter @shoebox/bank test -- matcher-candidates 2>&1 | tail -30` → pass. Commit `0115 step 4`.

5. New `packages/bank/src/matcher/score.ts`:
```ts
export function sigmoid(x: number): number;
export function scoreCandidate(c: Candidate, ctx: MatchContext, cfg?: MatcherConfig): CandidateScore | null;
export function scoreBatch(cands: readonly Candidate[], ctx: MatchContext, cfg?: MatcherConfig): CandidateScore[];
```
`scoreCandidate` (`w = cfg.weights`):
1. `keys = docKeys(d)`; `vsExact = t.vs !== undefined && keys.includes(t.vs)`.
2. `amount = compareAmount(t, d, ctx, vsExact, cfg)`; null → return null.
3. `kind = windowKindOf(t, d)`; `date = dateFactor(kind, t.bookedOn, d, cfg)`; `date.outside && !vsExact` → null.
4. Features, pushed in this order, each only when its contribution is non-zero: amount (`exact` → `amount_exact` = `amountExact`; `rounding` → `amount_rounding`; `fx` → `amount_fx` = `amountFxMax × ratio`; `partial`/`overpayment` → `amount_partial` = `amountPartial`); `vs_exact` when `vsExact`, else `vs_conflict` when `t.vs`, `d.variableSymbol` and `d.partnerId` are set and `ctx.partnersWithVsHistory.has(d.partnerId)`; `msg_doc_number` when `!vsExact && messageHasDocKey(t.message, d)`; `account_match` by the rule of candidates (d), else `account_other_partner` when `txAccount` or `txIban` is in `ctx.knownAccounts` or an `account` alias for a partner other than `d.partnerId` (undefined `d.partnerId` counts as other); `name` = `nameMax × max(0, (nameSim − 0.5) / 0.5)` where `nameSim` is the max of `tokenSetRatio(src, normName(d.partnerName))` and `tokenSetRatio(src, alias.value)` over merchant/name aliases of `d.partnerId` (`src` as in candidates (e); empty → 0); `date` = `dateMax × date.f`, or `date_outside` = `dateOutside` when outside; `alias` when some alias of `d.partnerId` with `confirmations ≥ 2` matches `txAccount` (kind account) or `src` (kind merchant/name, equal strings).
5. `logit = bias + Σ`; `score = Math.round(sigmoid(logit) × 1000) / 1000`; `capped = d.status === 'needs_review'`; if capped `score = Math.min(score, 0.89)`.
6. `method`: `vsExact` and kind `exact`/`rounding` → `vs_amount`; `vsExact` → `vs_only`; `name` feature present and `t.cardMerchant` → `card_merchant_fuzzy`; window `payout` → `platform_statement`; else `amount_date_counterparty`.
7. `txRemaining = t.remaining ?? t.amount.abs()`, `docOpen = d.openAmount`, `anchorDistanceDays = date.anchorDistanceDays`, `dueDate = d.dueDate`, `docCreatedAt = d.createdAt`.
`scoreBatch`: score every candidate (drop nulls); count scored pairs per transaction and distinct transactions per document; a pair whose transaction has exactly one scored document and whose document has exactly one scored transaction gets `unique` (= `w.unique`) appended and `logit`/`score` recomputed with the same cap. Output in input order.
New `packages/bank/test/matcher-score.test.ts`, verbatim:
```ts
import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { scoreBatch, scoreCandidate, sigmoid } from '../src/matcher/score';
import type { Candidate, DocView, MatchContext, TxView } from '../src/matcher/types';

const D = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const eur = (s: string) => Money.parse(s, 'EUR');

function tx(over: Partial<TxView> = {}): TxView {
  return { id: 't1', moneyAccountId: 'acc', currency: CZK, bookedOn: D('2026-03-10'), amount: czk('-1210.00'), ...over };
}
function doc(over: Partial<DocView> = {}): DocView {
  return {
    id: 'd1', cls: 'received_invoice', status: 'ready', direction: 'in', currency: CZK,
    amountDue: czk('1210.00'), openAmount: czk('1210.00'), documentNumber: 'FV2026001', variableSymbol: '2026001',
    issueDate: D('2026-03-01'), dueDate: D('2026-03-15'), partnerId: 'p1', partnerName: 'Alfa Servis s.r.o.',
    partnerAccounts: ['2400123455/2010'], createdAt: '2026-03-01T10:00:00Z', ...over,
  };
}
const base: MatchContext = {
  aliases: [], rejected: new Set(), knownAccounts: [{ value: '2400123455/2010', partnerId: 'p1' }],
  partnersWithVsHistory: new Set(), fxRate: () => null,
};
const cand = (t: TxView, d: DocView): Candidate => ({ t, d, via: [] });
const codes = (s: { features: readonly { code: string }[] } | null) => s?.features.map((f) => f.code);

describe('sigmoid', () => {
  it('is the logistic function', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(4.5)).toBeCloseTo(0.989, 3);
  });
});

describe('scoreCandidate: worked examples of M07 §4.6.3', () => {
  it('VS + exact amount → 0.989, vs_amount', () => {
    const s = scoreCandidate(cand(tx({ vs: '2026001' }), doc()), base);
    expect(s?.score).toBe(0.989);
    expect(s?.method).toBe('vs_amount');
    expect(codes(s)).toEqual(['amount_exact', 'vs_exact', 'date']);
    expect(s?.logit).toBeCloseTo(4.5, 6);
    expect(s?.amount.amountDoc.toFixed2()).toBe('1210.00');
    expect(s?.txRemaining.toFixed2()).toBe('1210.00');
    expect(s?.anchorDistanceDays).toBe(0);
  });
  it('account + exact amount, no VS → 0.953', () => {
    const t = tx({ counterpartyAccount: '2400123455', counterpartyBankCode: '2010' });
    const s = scoreCandidate(cand(t, doc({ variableSymbol: undefined })), base);
    expect(s?.score).toBe(0.953);
    expect(s?.method).toBe('amount_date_counterparty');
    expect(codes(s)).toEqual(['amount_exact', 'account_match', 'date']);
  });
  it('card: exact amount + merchant name', () => {
    const d = doc({ variableSymbol: undefined, documentNumber: undefined });
    const full = scoreCandidate(cand(tx({ bookedOn: D('2026-03-02'), cardMerchant: 'ALFA SERVIS' }), d), base);
    expect(full?.score).toBe(0.971);
    expect(full?.method).toBe('card_merchant_fuzzy');
    const near = scoreCandidate(cand(tx({ bookedOn: D('2026-03-02'), cardMerchant: 'ALFA SERVICE' }), d), base);
    expect(near?.score).toBe(0.924);
    expect(codes(near)).toEqual(['amount_exact', 'name', 'date']);
  });
  it('exact amount + date only → 0.622', () => {
    const s = scoreCandidate(cand(tx(), doc({ variableSymbol: undefined, documentNumber: undefined })), base);
    expect(s?.score).toBe(0.622);
    expect(s?.method).toBe('amount_date_counterparty');
  });
  it('VS + exact amount outside the window → 0.881; no VS outside → dropped', () => {
    const late = tx({ bookedOn: D('2026-06-20'), vs: '2026001' });
    const s = scoreCandidate(cand(late, doc()), base);
    expect(s?.score).toBe(0.881);
    expect(codes(s)).toEqual(['amount_exact', 'vs_exact', 'date_outside']);
    expect(scoreCandidate(cand(tx({ bookedOn: D('2026-06-20') }), doc()), base)).toBeNull();
  });
  it('needs_review caps at 0.89', () => {
    const s = scoreCandidate(cand(tx({ vs: '2026001' }), doc({ status: 'needs_review' })), base);
    expect(s?.score).toBe(0.89);
    expect(s?.capped).toBe(true);
  });
  it('partial with VS → 0.924, vs_only', () => {
    const s = scoreCandidate(cand(tx({ vs: '2026001', amount: czk('-600.00') }), doc()), base);
    expect(s?.score).toBe(0.924);
    expect(s?.method).toBe('vs_only');
    expect(s?.amount.kind).toBe('partial');
    expect(s?.amount.amountDoc.toFixed2()).toBe('600.00');
  });
  it('wrong amount without VS is dropped', () => {
    expect(scoreCandidate(cand(tx({ amount: czk('-999.00') }), doc()), base)).toBeNull();
  });
  it('VS conflict when the partner uses VS', () => {
    const ctx: MatchContext = { ...base, partnersWithVsHistory: new Set(['p1']) };
    const s = scoreCandidate(cand(tx({ vs: '999' }), doc()), ctx);
    expect(s?.score).toBe(0.076);
    expect(codes(s)).toEqual(['amount_exact', 'vs_conflict', 'date']);
    expect(codes(scoreCandidate(cand(tx({ vs: '999' }), doc()), base))).toEqual(['amount_exact', 'date']);
  });
  it('account known for another partner → −3', () => {
    const ctx: MatchContext = { ...base, knownAccounts: [{ value: '1003-1234567899/0800', partnerId: 'p2' }] };
    const t = tx({ counterpartyAccount: '1003-1234567899', counterpartyBankCode: '0800' });
    const s = scoreCandidate(cand(t, doc({ variableSymbol: undefined, documentNumber: undefined })), ctx);
    expect(s?.score).toBe(0.076);
    expect(codes(s)).toEqual(['amount_exact', 'account_other_partner', 'date']);
  });
  it('confirmed alias adds 1', () => {
    const ctx: MatchContext = {
      ...base, aliases: [{ kind: 'account', value: '2400123455/2010', partnerId: 'p1', confirmations: 2 }],
    };
    const t = tx({ counterpartyAccount: '2400123455', counterpartyBankCode: '2010' });
    const s = scoreCandidate(cand(t, doc({ variableSymbol: undefined, documentNumber: undefined })), ctx);
    expect(s?.score).toBe(0.982);
    expect(codes(s)).toEqual(['amount_exact', 'account_match', 'date', 'alias']);
    const once: MatchContext = { ...ctx, aliases: [{ ...ctx.aliases[0]!, confirmations: 1 }] };
    expect(scoreCandidate(cand(t, doc({ variableSymbol: undefined, documentNumber: undefined })), once)?.score).toBe(0.953);
  });
  it('document number in the message → +3 (not with VS)', () => {
    const s = scoreCandidate(cand(tx({ message: 'Platba FV2026001' }), doc({ variableSymbol: undefined })), base);
    expect(s?.score).toBe(0.971);
    expect(codes(s)).toEqual(['amount_exact', 'msg_doc_number', 'date']);
    const withVs = scoreCandidate(cand(tx({ message: 'Platba FV2026001', vs: '2026001' }), doc()), base);
    expect(codes(withVs)).toEqual(['amount_exact', 'vs_exact', 'date']);
  });
  it('FX: EUR document paid in CZK', () => {
    const ctx: MatchContext = { ...base, fxRate: () => '25' };
    const d = doc({ currency: 'EUR', amountDue: eur('100.00'), openAmount: eur('100.00'), variableSymbol: undefined, documentNumber: undefined });
    const s = scoreCandidate(cand(tx({ amount: czk('-2525.00') }), d), ctx);
    expect(s?.score).toBe(0.148);
    expect(s?.features.find((f) => f.code === 'amount_fx')?.contribution).toBeCloseTo(0.75, 6);
    const v = scoreCandidate(cand(tx({ amount: czk('-2525.00'), vs: '2026001' }), { ...d, variableSymbol: '2026001' }), ctx);
    expect(v?.score).toBe(0.905);
    expect(v?.method).toBe('vs_only');
  });
});

describe('scoreBatch', () => {
  const plain = { variableSymbol: undefined, documentNumber: undefined } as const;
  it('adds uniqueness when one transaction and one document match on amount', () => {
    const [s] = scoreBatch([cand(tx(), doc(plain))], base);
    expect(s?.score).toBe(0.818);
    expect(codes(s)).toEqual(['amount_exact', 'date', 'unique']);
  });
  it('no uniqueness with two documents of the same amount', () => {
    const t = tx();
    const out = scoreBatch([cand(t, doc({ ...plain, id: 'a' })), cand(t, doc({ ...plain, id: 'b' }))], base);
    expect(out.map((s) => s.score)).toEqual([0.622, 0.622]);
  });
  it('no uniqueness with two transactions for one document', () => {
    const d = doc(plain);
    const out = scoreBatch([cand(tx({ id: 't1' }), d), cand(tx({ id: 't2' }), d)], base);
    expect(out.map((s) => s.score)).toEqual([0.622, 0.622]);
  });
  it('drops candidates that score null', () => {
    expect(scoreBatch([cand(tx({ amount: czk('-999.00') }), doc())], base)).toEqual([]);
  });
});
```
Run `pnpm --filter @shoebox/bank test -- matcher-score 2>&1 | tail -30` → pass. Commit `0115 step 5`.

6. New `packages/bank/src/matcher/index.ts`:
```ts
export * from './amount';
export * from './candidates';
export * from './config';
export * from './dates';
export * from './score';
export * from './text';
export type * from './types';
```
In `packages/bank/src/index.ts` add `export * from './matcher/index';` directly below `export * from './parsers/mt940';`. Run `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -10` → no errors. Commit `0115 step 6`.

## 5. Do not touch

`packages/bank/src/normalize.ts`, `packages/bank/src/parsers/`, `packages/domain/`, `packages/db/`, `apps/`. Hard rules 1 (no float money; tolerances only through `MATCHER_CONFIG`), 4 (synthetic data only), 7 (no new dependency: write the Levenshtein function yourself, do not add `fastest-levenshtein`).

## 6. Commands

- `pnpm --filter @shoebox/bank test -- matcher-text 2>&1 | tail -30` → all tests pass.
- `pnpm --filter @shoebox/bank test -- matcher-candidates 2>&1 | tail -30` → all tests pass.
- `pnpm --filter @shoebox/bank test -- matcher-score 2>&1 | tail -30` → all tests pass.
- `pnpm --filter @shoebox/bank typecheck 2>&1 | tail -30` → no errors.

## 7. Acceptance

- [ ] The three test files pass unchanged.
- [ ] `grep -rn "Number(\|parseFloat\|toNumber()" packages/bank/src/matcher/` shows only the tolerance-percent and FX-percent lines of `amount.ts` (score arithmetic, never money).
- [ ] `MATCHER_CONFIG` equals M07 §4.6 verbatim; `version` is 1.
- [ ] No new dependency in `packages/bank/package.json`.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong (say which value you believe is wrong and why);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear.

## 9. Report

Write `docs/tasks/0115-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left (none expected).

## Risk list (for the reviewer)

`amount.ts` (money comparisons, FX rounding), `score.ts` (weights, caps, method), `candidates.ts` (eligibility by class and sign).

## Owner steps

None.
