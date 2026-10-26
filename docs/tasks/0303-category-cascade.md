# 0303: Category decision cascade (pure): stages 0–7, hard rules H1–H5, soft rules as data, asset check, business share

Status: done
Ticket: P1-CAT-01 | Depends on: 0302 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Decide `category_code`, confidence, business share and deductibility per document line without any I/O or LLM call, in exactly the M04 order (user > hard rule > pinned vendor > vendor memory > soft rules > LLM output if supplied > fallback). This is what makes the app sort a layman's papers correctly; the tests below are the spec and may not be edited.

## 2. Context

Hard rules 1 (no number in code; thresholds and rule tables come from `rules.at(date)`), 2 (an LLM code is a suggestion: capped at 0.92 and only used when the deterministic stages give nothing).

M04 §4.1 (pasted). Processed per document; lines with `line_type='text'` are skipped. For each line the first source producing a valid code wins (valid = known code, direction matches, category valid at `issue_date`, not hidden by the user; a hidden category is still allowed from stage 0). Each stage records `decidedBy`.

| # | `decidedBy` | Condition | `source` | Confidence |
|---|---|---|---|---|
| 0 | `user_line` | the line's `userCategoryCode` is set | `user` | 1.00 |
| 1 | `hard_rule` | H1–H5 | `rule` | 0.98 |
| 2 | `user_vendor_rule` | `vendor.pinned` and not `multiCategory` | `vendor_memory` | 0.99 |
| 3 | `vendor_memory` | `vendor.confirmations ≥ classification.vendor_memory_min_confirmations` (2) and not `multiCategory` | `vendor_memory` | `min(0.97, 0.88 + 0.02·confirmations)` |
| 4 | `global_prior` | Later: always skipped | | |
| 5 | `soft_rule` | S1–S4 | `rule` | per rule |
| 6 | `llm` | `input.llm` has a valid code for the position | `llm` | `min(model_confidence, 0.92)` |
| 7 | `fallback` | nothing applied | `rule` | 0.00 → `which_category` question |

Hard and soft rule data: `parseClassificationRules(rules.at(doc.issueDate))` from `packages/domain/src/rules/cz/classification.ts` (brief 0302); read that file's schemas before implementing. Rule semantics:

- H1 `rounding | shipping` → category of the document's dominant item line (largest `|gross|` among `line_type='item'`, tie → lowest position); `discount` → category of the nearest preceding item line (lower position, closest), else dominant. H2 `advance_deduction` → dominant. These "derived" lines are decided after the others; stage 0 still beats them.
- H3 `match_description`: the normalized description contains a pattern as whole words, or `statementColumn` is in `statement_columns` → `category`.
- H4 `authority`: `supplier.authorityKind` is a key of `map` → the mapped category.
- H5 `inherit_original` (only `received_credit_note` with `input.original`): the original line with the highest `descriptionSimilarity ≥ min_similarity` gives its category; none → the original's dominant line (largest `|gross|`).
- S1 `platform` (supplier is a platform: normalized supplier name contains one of `platforms[].match`): description matches `commission_patterns` → `commission_category` (0.92); matches `payment_fee_patterns` → `payment_fee_category` (0.92); otherwise on a `platform_statement`, a line with `statementColumn ∈ {reservation, payout}` or (`statementColumn` null and gross > 0) → `accommodation_category` when `settings.activityKeywords` includes `accommodation_keyword`, else `payout_category` (`statement_income_confidence`).
- S2 `keywords`: keyword rows with `role='category'`; count the distinct keywords of a row found in the description; ≥ 1 → that category at `confidence`; ≥ 2 → `confidence_two_keywords`.
- S3 `nace`: only when the document has ≤ `max_item_lines` item lines; a supplier NACE code equal to a map key, or whose first two digits equal a `NN.*` key → category at `confidence`; `confidence_with_keywords` when S2 proposes the same category.
- S4 `issued_default`: `doc.class === 'issued_invoice'` → `goods_category` if a `role='goods'` keyword matches, else `category`, at `confidence`.
- Among soft candidates the highest confidence wins; a tie goes to the earlier rule (S1, S2, S3, S4).
- Direction check: a category with direction `in` is valid on `doc.direction='in'`, `out` on `out`, `both` always; **on a `platform_statement` the direction check is skipped** (statements carry income and fee lines together).

Acceptance per line: `confidence ≥ classification.auto_accept_confidence` (0.80) → `accepted`. Below: provisional, and a `which_category` question, **unless** the sum of `|gross_czk|` over all low-confidence lines of the document is `< classification.low_value_skip_czk` (100): then those lines get `lowValue: true`, no question.

Asset check (after category, not for stage-0 lines): for item lines whose category is one of `exp_material | exp_small_assets | exp_office_supplies | exp_other_deductible | exp_repairs`: `uc = (net_czk + nonDeductibleVat_czk) / max(quantity, 1)` where `net_czk = (net ?? gross) × fxRateToCzk`, `nonDeductibleVat_czk = vat × fxRateToCzk` unless `vatStatusAtIssue === 'platce' && deductionAllowed` (then 0). `uc > rules.at(issueDate).get('asset.capitalization_threshold')` → category `asset_long_term` + question `asset_over_threshold`; else if durable (`llm.assetCandidate` for the position, or a `role='durable'` keyword matches) → `exp_small_assets`. Every line whose final category is `exp_small_assets` and has no `userBusinessSharePct` gets the question `small_asset_business_use`.

Business share per line: `userBusinessSharePct` > vendor `defaultBusinessFlag` with `confirmations ≥ 2` (`business` → `'100'`, `personal` → `'0'`, `mixed` → document question `business_or_personal`, share stays `'100'`) > `settings.carBusinessSharePct` for `exp_fuel | exp_car_operating | exp_car_lease` > `'100'`. A line whose category is `private_expense` → `'0'`. A car category with no car setting and no user share → question `car_regime` (04 §3.1). `doc.personalPurchaseSuspected` (M03's personal-purchase check) and no user share on any line → document question `business_or_personal`. `businessFlag` = `unknown` while `business_or_personal` is asked; else `business` if every line is `'100'`, `personal` if every line is `'0'`, else `mixed`. `deductibility = deriveDeductibility(category, share)` (`not_applicable` when no category).

Text helpers (define in the same file, exported): `normalizeText(s)` = NFD, strip combining marks (`/\p{M}/gu`), lower-case, every run of non-alphanumerics → one space, trim. `matchesKeyword(normalizedText, keyword)`: normalize the keyword; a trailing `*` means "rest of the word"; match as whole words, i.e. the regex `(^|\s)<escaped keyword>(?=\s|$)` where `*` becomes `[a-z0-9]*`. `descriptionSimilarity(a, b)`: both normalized; equal → 1; else Dice coefficient over the sets of words `2·|A∩B| / (|A|+|B|)` (0 when both empty).

Existing API: `Money` (`packages/domain/src/money`), `Decimal` from `decimal.js` (quantity, fx rate: `new Decimal(text)`), `CATEGORIES`, `getCategory`, `isCategoryCode`, `categoryAllowsDirection`, `isCategoryValidOn`, `deriveDeductibility` (brief 0301), `createCzRules()` / `RuleResolver<typeof RULE_SCHEMAS>` (`packages/domain/src/rules`). Lint: no `Number()`, `parseFloat`, `new Date()`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/test/cascade.test.ts` | create | the test file below, verbatim |
| `packages/domain/src/taxonomy/cascade.ts` | create | `runCategoryCascade` and helpers |
| `packages/domain/src/index.ts` | edit | export |

No other file may change.

## 4. Steps

1. Create `packages/domain/test/cascade.test.ts` with exactly:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import {
  type CascadeDocument,
  type CascadeInput,
  type CascadeLine,
  descriptionSimilarity,
  matchesKeyword,
  normalizeText,
  runCategoryCascade,
} from '../src/taxonomy/cascade';
import { CATEGORY_CODES, getCategory } from '../src/taxonomy/categories';

const rules = createCzRules();
const czk = (s: string) => Money.parse(s, 'CZK');

function line(over: Partial<CascadeLine> = {}): CascadeLine {
  return {
    lineId: `l${over.position ?? 1}`,
    position: 1,
    lineType: 'item',
    description: 'Úklid apartmánu za září',
    quantity: '1.0000',
    net: czk('11600.00'),
    vat: czk('0.00'),
    gross: czk('11600.00'),
    userCategoryCode: null,
    userBusinessSharePct: null,
    statementColumn: null,
    ...over,
  };
}

function doc(over: Partial<CascadeDocument> = {}): CascadeDocument {
  return {
    class: 'received_invoice',
    direction: 'in',
    issueDate: '2026-09-05' as never,
    currency: 'CZK',
    fxRateToCzk: '1',
    personalPurchaseSuspected: false,
    ...over,
  };
}

function input(over: Partial<CascadeInput> = {}): CascadeInput {
  return {
    doc: doc(),
    lines: [line()],
    supplier: { name: 'Čistírna s.r.o.', naceCodes: [], authorityKind: null },
    vendor: null,
    original: null,
    settings: { activityKeywords: ['accommodation'], carBusinessSharePct: null, hiddenCategoryCodes: [] },
    vatStatusAtIssue: 'identifikovana_osoba',
    deductionAllowed: false,
    rules,
    ...over,
  };
}

const first = (i: CascadeInput) => {
  const r = runCategoryCascade(i);
  const l = r.lines[0];
  if (l === undefined) throw new Error('no line');
  return { r, l };
};

describe('text helpers', () => {
  it('normalizeText strips diacritics, case and punctuation', () => {
    expect(normalizeText('  Úklid – apartmánu, ZA září!! ')).toBe('uklid apartmanu za zari');
  });
  it('matchesKeyword is whole-word with an optional trailing wildcard', () => {
    expect(matchesKeyword(normalizeText('Payment services charge'), 'payment service*')).toBe(true);
    expect(matchesKeyword(normalizeText('Platební služby'), 'platební služb*')).toBe(true);
    expect(matchesKeyword(normalizeText('DNS hosting'), 'dns')).toBe(true);
    expect(matchesKeyword(normalizeText('Admin fee'), 'dns')).toBe(false);
    expect(matchesKeyword(normalizeText('Doménaxy'), 'doména')).toBe(false);
  });
  it('descriptionSimilarity: equal → 1, Dice over words otherwise', () => {
    expect(descriptionSimilarity('Mytí oken', 'mytí  OKEN')).toBe(1);
    expect(descriptionSimilarity('Úklid apartmánu za září', 'Úklid apartmánu za říjen')).toBe(0.75);
    expect(descriptionSimilarity('', '')).toBe(0);
  });
});

describe('stage order (AC-1)', () => {
  it('stage 0: a user category wins with confidence 1', () => {
    const { l } = first(input({ lines: [line({ userCategoryCode: 'exp_office_supplies' })] }));
    expect(l).toMatchObject({
      categoryCode: 'exp_office_supplies', decidedBy: 'user_line', source: 'user', confidence: 1,
      accepted: true, taxEffect: 'deductible_expense', deductibility: 'deductible',
    });
  });

  it('stage 0 beats a hard rule', () => {
    const { l } = first(
      input({ lines: [line({ description: 'Poplatek z pobytu Praha', userCategoryCode: 'exp_other_deductible' })] }),
    );
    expect(l.categoryCode).toBe('exp_other_deductible');
    expect(l.decidedBy).toBe('user_line');
  });

  it('stage 1 (H3) beats a pinned vendor rule', () => {
    const { l } = first(
      input({
        lines: [line({ description: 'Poplatek z pobytu Praha' })],
        vendor: { pinned: true, multiCategory: false, confirmations: 9, defaultCategoryCode: 'exp_property_management', defaultBusinessFlag: null },
      }),
    );
    expect(l).toMatchObject({
      categoryCode: 'pt_tourist_fee', decidedBy: 'hard_rule', source: 'rule', confidence: 0.98,
      ruleId: 'H3_TOURIST_FEE', taxEffect: 'pass_through', deductibility: 'not_applicable',
    });
  });

  it('stage 2: pinned vendor beats memory and soft rules', () => {
    const { l } = first(
      input({ vendor: { pinned: true, multiCategory: false, confirmations: 0, defaultCategoryCode: 'exp_property_management', defaultBusinessFlag: null } }),
    );
    expect(l).toMatchObject({ categoryCode: 'exp_property_management', decidedBy: 'user_vendor_rule', source: 'vendor_memory', confidence: 0.99 });
  });

  it('stage 3: vendor memory needs 2 confirmations; confidence 0.88 + 0.02·n capped at 0.97', () => {
    const mem = (confirmations: number) =>
      first(input({ vendor: { pinned: false, multiCategory: false, confirmations, defaultCategoryCode: 'exp_property_management', defaultBusinessFlag: null } })).l;
    expect(mem(3)).toMatchObject({ categoryCode: 'exp_property_management', decidedBy: 'vendor_memory', confidence: 0.94 });
    expect(mem(5).confidence).toBe(0.97);
    expect(mem(2).confidence).toBe(0.92);
    expect(mem(1)).toMatchObject({ categoryCode: 'exp_cleaning', decidedBy: 'soft_rule' });
  });

  it('a multi-category vendor is skipped at stages 2 and 3', () => {
    const { l } = first(
      input({ vendor: { pinned: true, multiCategory: true, confirmations: 9, defaultCategoryCode: 'exp_property_management', defaultBusinessFlag: null } }),
    );
    expect(l.decidedBy).toBe('soft_rule');
    expect(l.categoryCode).toBe('exp_cleaning');
  });

  it('stage 5 (S2) → exp_cleaning at 0.80, accepted', () => {
    const { l, r } = first(input());
    expect(l).toMatchObject({ categoryCode: 'exp_cleaning', decidedBy: 'soft_rule', source: 'rule', confidence: 0.8, ruleId: 'S2', accepted: true, questions: [] });
    expect(r.needsLlm).toEqual([]);
  });

  it('stage 6: LLM output is used only after the deterministic stages and capped at 0.92', () => {
    const { l, r } = first(
      input({
        lines: [line({ description: 'Něco neurčitého' })],
        llm: { lines: [{ position: 1, categoryCode: 'exp_services_general', confidence: 0.99 }] },
      }),
    );
    expect(l).toMatchObject({ categoryCode: 'exp_services_general', decidedBy: 'llm', source: 'llm', confidence: 0.92, accepted: true });
    expect(r.needsLlm).toEqual([]);
    const soft = first(input({ llm: { lines: [{ position: 1, categoryCode: 'exp_services_general', confidence: 0.99 }] } })).l;
    expect(soft.categoryCode).toBe('exp_cleaning');
  });

  it('stage 6: an invalid LLM code or a wrong-direction code falls through', () => {
    const bad = first(input({ lines: [line({ description: 'Něco' })], llm: { lines: [{ position: 1, categoryCode: 'exp_nope', confidence: 0.9 }] } })).l;
    expect(bad.decidedBy).toBe('fallback');
    const dir = first(input({ lines: [line({ description: 'Něco' })], llm: { lines: [{ position: 1, categoryCode: 'income_services', confidence: 0.9 }] } })).l;
    expect(dir.decidedBy).toBe('fallback');
  });

  it('stage 7: fallback has no category, confidence 0, a which_category question, and lists the position for the LLM', () => {
    const { l, r } = first(input({ lines: [line({ description: 'Něco neurčitého' })] }));
    expect(l).toMatchObject({
      categoryCode: null, taxEffect: null, decidedBy: 'fallback', source: 'rule', confidence: 0,
      accepted: false, lowValue: false, questions: ['which_category'], deductibility: 'not_applicable', businessSharePct: '100',
    });
    expect(r.needsLlm).toEqual([1]);
  });

  it('property: a user category is never overwritten', () => {
    const inCodes = CATEGORY_CODES.filter((c) => getCategory(c).direction !== 'out');
    fc.assert(
      fc.property(
        fc.constantFrom(...inCodes),
        fc.constantFrom('Poplatek z pobytu', 'Úklid', 'MacBook Air', 'Něco', 'Nafta'),
        fc.option(fc.constantFrom(...inCodes), { nil: null }),
        fc.boolean(),
        fc.integer({ min: 0, max: 9 }),
        (user, description, vendorCode, pinned, confirmations) => {
          const { l } = first(
            input({
              lines: [line({ description, userCategoryCode: user })],
              vendor: { pinned, multiCategory: false, confirmations, defaultCategoryCode: vendorCode, defaultBusinessFlag: null },
              llm: { lines: [{ position: 1, categoryCode: 'exp_services_general', confidence: 0.95 }] },
            }),
          );
          return l.categoryCode === user && l.decidedBy === 'user_line' && l.confidence === 1;
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('hard rules', () => {
  const alza = () =>
    input({
      doc: doc({ issueDate: '2026-09-18' as never }),
      lines: [
        line({ position: 1, description: 'Kabel USB-C 2 m', net: czk('118.90'), vat: null, gross: czk('118.90') }),
        line({ position: 2, lineType: 'discount', description: 'Sleva', net: czk('-1.95'), vat: null, gross: czk('-1.95') }),
        line({ position: 3, lineType: 'rounding', description: 'Zaokrouhlení', net: czk('0.05'), vat: null, gross: czk('0.05') }),
        line({ position: 4, lineType: 'text', description: 'Děkujeme za nákup', net: null, vat: null, gross: null }),
      ],
      supplier: { name: 'Alza.cz a.s.', naceCodes: [], authorityKind: null },
      llm: { lines: [{ position: 1, categoryCode: 'exp_office_supplies', confidence: 0.9 }] },
    });

  it('H1: discount and rounding lines inherit the item category; text lines are skipped (AC-9k)', () => {
    const r = runCategoryCascade(alza());
    expect(r.lines.map((l) => [l.position, l.categoryCode, l.decidedBy, l.ruleId, l.confidence])).toEqual([
      [1, 'exp_office_supplies', 'llm', null, 0.9],
      [2, 'exp_office_supplies', 'hard_rule', 'H1_DISCOUNT', 0.98],
      [3, 'exp_office_supplies', 'hard_rule', 'H1', 0.98],
    ]);
    expect(r.businessFlag).toBe('business');
  });

  it('H1: shipping follows the dominant item (largest |gross|, tie → lowest position); H2 advance deduction too', () => {
    const r = runCategoryCascade(
      input({
        lines: [
          line({ position: 1, description: 'Úklid', gross: czk('100.00'), net: czk('100.00') }),
          line({ position: 2, description: 'Doména example.cz', gross: czk('300.00'), net: czk('300.00') }),
          line({ position: 3, lineType: 'shipping', description: 'Doprava', gross: czk('50.00'), net: czk('50.00') }),
          line({ position: 4, lineType: 'advance_deduction', description: 'Odečet zálohy', gross: czk('-200.00'), net: czk('-200.00') }),
        ],
      }),
    );
    expect(r.lines.map((l) => l.categoryCode)).toEqual([
      'exp_cleaning', 'exp_hosting_domains', 'exp_hosting_domains', 'exp_hosting_domains',
    ]);
    expect(r.lines[3]?.ruleId).toBe('H2');
    const tie = runCategoryCascade(
      input({
        lines: [
          line({ position: 1, description: 'Úklid', gross: czk('100.00') }),
          line({ position: 2, description: 'Doména', gross: czk('100.00') }),
          line({ position: 3, lineType: 'rounding', description: 'Zaokrouhlení', gross: czk('0.50'), net: czk('0.50') }),
        ],
      }),
    );
    expect(tie.lines[2]?.categoryCode).toBe('exp_cleaning');
  });

  it('H1: a discount with no preceding item line uses the dominant item', () => {
    const r = runCategoryCascade(
      input({
        lines: [
          line({ position: 1, lineType: 'discount', description: 'Sleva', gross: czk('-10.00'), net: czk('-10.00') }),
          line({ position: 2, description: 'Úklid', gross: czk('100.00') }),
        ],
      }),
    );
    expect(r.lines[0]?.categoryCode).toBe('exp_cleaning');
  });

  it('H3: tourist fee by description or statement column; deposit by description', () => {
    const fee = first(input({ lines: [line({ description: 'City tax 2 nights' })] })).l;
    expect(fee.categoryCode).toBe('pt_tourist_fee');
    const col = first(
      input({
        doc: doc({ class: 'platform_statement', direction: 'out' }),
        lines: [line({ description: 'Fee', statementColumn: 'tourist_fee', gross: czk('250.00'), net: czk('250.00') })],
      }),
    ).l;
    expect(col.categoryCode).toBe('pt_tourist_fee');
    const dep = first(input({ lines: [line({ lineType: 'deposit', description: 'Kauce za apartmán' })] })).l;
    expect(dep).toMatchObject({ categoryCode: 'pt_deposit', ruleId: 'H3_DEPOSIT' });
  });

  it('H4: an authority supplier maps by kind; an unknown kind falls through', () => {
    const cssz = first(
      input({ lines: [line({ description: 'Záloha na pojistné' })], supplier: { name: 'ČSSZ', naceCodes: [], authorityKind: 'cssz' } }),
    ).l;
    expect(cssz).toMatchObject({ categoryCode: 'ins_social_own', decidedBy: 'hard_rule', ruleId: 'H4', deductibility: 'not_applicable' });
    const other = first(
      input({ lines: [line({ description: 'Záloha' })], supplier: { name: 'X', naceCodes: [], authorityKind: 'unknown_kind' } }),
    ).l;
    expect(other.decidedBy).toBe('fallback');
  });

  it('H5: a credit note inherits per line by description similarity ≥ 0.8, else the original dominant', () => {
    const base = input({
      doc: doc({ class: 'received_credit_note' }),
      original: {
        lines: [
          { description: 'Úklid apartmánu za září', gross: czk('11600.00'), categoryCode: 'exp_cleaning' },
          { description: 'Mytí oken', gross: czk('500.00'), categoryCode: 'exp_repairs' },
        ],
      },
    });
    const match = first({ ...base, lines: [line({ description: 'Mytí oken', gross: czk('-500.00'), net: czk('-500.00') })] }).l;
    expect(match).toMatchObject({ categoryCode: 'exp_repairs', decidedBy: 'hard_rule', ruleId: 'H5' });
    const none = first({ ...base, lines: [line({ description: 'Storno', gross: czk('-100.00'), net: czk('-100.00') })] }).l;
    expect(none).toMatchObject({ categoryCode: 'exp_cleaning', ruleId: 'H5' });
  });
});

describe('soft rules', () => {
  it('S2: two agreeing keywords raise the confidence to 0.88', () => {
    const { l } = first(input({ lines: [line({ description: 'Cleaning – úklid kanceláře' })] }));
    expect(l).toMatchObject({ categoryCode: 'exp_cleaning', confidence: 0.88, ruleId: 'S2' });
  });

  it('S1: platform commission, payment fee and statement income lines', () => {
    const booking = { name: 'Booking.com B.V.', naceCodes: [], authorityKind: null };
    const com = first(input({ supplier: booking, lines: [line({ description: 'Commission for July 2026' })] })).l;
    expect(com).toMatchObject({ categoryCode: 'exp_platform_commission', confidence: 0.92, ruleId: 'S1' });
    const fee = first(input({ supplier: booking, lines: [line({ description: 'Payment services charge' })] })).l;
    expect(fee).toMatchObject({ categoryCode: 'exp_payment_fees', confidence: 0.92 });
    const stmt = input({
      doc: doc({ class: 'platform_statement', direction: 'out' }),
      supplier: booking,
      lines: [
        line({ position: 1, description: 'Reservation 123', statementColumn: 'reservation', gross: czk('5000.00'), net: czk('5000.00') }),
        line({ position: 2, description: 'Commission', statementColumn: 'commission', gross: czk('-750.00'), net: czk('-750.00') }),
      ],
    });
    const r = runCategoryCascade(stmt);
    expect(r.lines.map((l) => [l.categoryCode, l.confidence])).toEqual([
      ['income_accommodation', 0.9],
      ['exp_platform_commission', 0.92],
    ]);
    const payout = runCategoryCascade({ ...stmt, settings: { ...stmt.settings, activityKeywords: [] } });
    expect(payout.lines[0]?.categoryCode).toBe('income_platform_payout');
  });

  it('S3: NACE applies on documents with ≤ 2 item lines, 0.75 alone, 0.90 with S2, prefix keys', () => {
    const nace = (codes: string[], description: string, extra: CascadeLine[] = []) =>
      first(input({ supplier: { name: 'Firma', naceCodes: codes, authorityKind: null }, lines: [line({ description }), ...extra] })).l;
    expect(nace(['81.21'], 'Služby dle smlouvy')).toMatchObject({ categoryCode: 'exp_cleaning', confidence: 0.75, ruleId: 'S3', accepted: false, questions: ['which_category'] });
    expect(nace(['61.20'], 'Služby dle smlouvy')).toMatchObject({ categoryCode: 'exp_telecom', confidence: 0.75 });
    expect(nace(['81.21'], 'Úklid')).toMatchObject({ categoryCode: 'exp_cleaning', confidence: 0.9, ruleId: 'S3' });
    const three = nace(['81.21'], 'Úklid', [
      line({ position: 2, description: 'B', gross: czk('1.00') }),
      line({ position: 3, description: 'C', gross: czk('1.00') }),
    ]);
    expect(three).toMatchObject({ categoryCode: 'exp_cleaning', confidence: 0.8, ruleId: 'S2' });
  });

  it('S4: issued invoices default to services at 0.70 (not accepted), goods keywords → income_goods', () => {
    const issued = (description: string) =>
      first(input({ doc: doc({ class: 'issued_invoice', direction: 'out' }), lines: [line({ description, gross: czk('15000.00'), net: czk('15000.00') })] })).l;
    expect(issued('Konzultace září')).toMatchObject({ categoryCode: 'income_services', confidence: 0.7, ruleId: 'S4', accepted: false, questions: ['which_category'], deductibility: 'not_applicable' });
    expect(issued('Prodej zboží')).toMatchObject({ categoryCode: 'income_goods', confidence: 0.7 });
  });

  it('a hidden category is skipped for rules, not for the user', () => {
    const settings = { activityKeywords: [], carBusinessSharePct: null, hiddenCategoryCodes: ['exp_cleaning'] };
    expect(first(input({ settings })).l.decidedBy).toBe('fallback');
    expect(first(input({ settings, lines: [line({ userCategoryCode: 'exp_cleaning' })] })).l.categoryCode).toBe('exp_cleaning');
  });
});

describe('asset check (M04 §4.1)', () => {
  const macbook = (over: Partial<CascadeLine> = {}, io = true, deduction = false) =>
    first(
      input({
        doc: doc({ issueDate: '2026-03-10' as never }),
        lines: [line({ description: 'MacBook Air 13 M4', net: czk('22305.79'), vat: czk('4684.21'), gross: czk('26990.00'), ...over })],
        llm: { lines: [{ position: 1, categoryCode: 'exp_office_supplies', confidence: 0.9 }] },
        vatStatusAtIssue: io ? 'identifikovana_osoba' : 'platce',
        deductionAllowed: deduction,
      }),
    ).l;

  it('26 990 Kč incl. VAT for an IO is under 80 000 and durable → exp_small_assets + small_asset_business_use (AC-9i)', () => {
    expect(macbook()).toMatchObject({
      categoryCode: 'exp_small_assets', decidedBy: 'llm', confidence: 0.9,
      questions: ['small_asset_business_use'], businessSharePct: '100', deductibility: 'deductible',
    });
  });

  it('a user share answers the question: 80 % → partially_deductible, no question', () => {
    expect(macbook({ userBusinessSharePct: '80' })).toMatchObject({ categoryCode: 'exp_small_assets', businessSharePct: '80', deductibility: 'partially_deductible', questions: [] });
  });

  it('over 80 000 Kč → asset_long_term + asset_over_threshold; VAT counts for IO, not for a deducting payer', () => {
    const cam = { description: 'Kamera Sony FX3', net: czk('70000.00'), vat: czk('14700.00'), gross: czk('84700.00') };
    expect(macbook(cam)).toMatchObject({ categoryCode: 'asset_long_term', taxEffect: 'asset', deductibility: 'not_applicable', questions: ['asset_over_threshold'] });
    expect(macbook(cam, false, true)).toMatchObject({ categoryCode: 'exp_small_assets', questions: ['small_asset_business_use'] });
    expect(macbook({ ...cam, quantity: '2.0000' })).toMatchObject({ categoryCode: 'exp_small_assets' });
  });

  it('foreign currency converts with fxRateToCzk; non-asset categories are untouched', () => {
    const usd = first(
      input({
        doc: doc({ currency: 'USD', fxRateToCzk: '23.456' }),
        lines: [line({ description: 'Camera body', net: Money.parse('4000.00', 'USD'), vat: Money.parse('0.00', 'USD'), gross: Money.parse('4000.00', 'USD') })],
        llm: { lines: [{ position: 1, categoryCode: 'exp_material', confidence: 0.9 }] },
      }),
    ).l;
    expect(usd.categoryCode).toBe('asset_long_term');
    const svc = first(input({ lines: [line({ description: 'Úklid MacBook kanceláře', gross: czk('90000.00'), net: czk('90000.00') })] })).l;
    expect(svc.categoryCode).toBe('exp_cleaning');
  });
});

describe('business share, questions and the document flag', () => {
  it('vendor personal with ≥ 2 confirmations → 0 %, non_deductible; 1 confirmation → 100 %', () => {
    const v = (confirmations: number) =>
      first(input({ vendor: { pinned: false, multiCategory: false, confirmations, defaultCategoryCode: null, defaultBusinessFlag: 'personal' } }));
    expect(v(2).l).toMatchObject({ businessSharePct: '0', deductibility: 'non_deductible' });
    expect(v(2).r.businessFlag).toBe('personal');
    expect(v(1).l.businessSharePct).toBe('100');
  });

  it('vendor mixed → business_or_personal document question, flag unknown', () => {
    const { r, l } = first(input({ vendor: { pinned: false, multiCategory: false, confirmations: 2, defaultCategoryCode: null, defaultBusinessFlag: 'mixed' } }));
    expect(r.documentQuestions).toEqual(['business_or_personal']);
    expect(r.businessFlag).toBe('unknown');
    expect(l.businessSharePct).toBe('100');
  });

  it('a suspected personal purchase asks once per document; a user share settles it (AC-9h)', () => {
    const decathlon = input({
      doc: doc({ personalPurchaseSuspected: true }),
      lines: [line({ description: 'Běžecké boty', gross: czk('249.00'), net: czk('249.00') })],
      llm: { lines: [{ position: 1, categoryCode: 'exp_other_deductible', confidence: 0.6 }] },
    });
    const r = runCategoryCascade(decathlon);
    expect(r.documentQuestions).toEqual(['business_or_personal']);
    expect(r.businessFlag).toBe('unknown');
    const answered = runCategoryCascade({ ...decathlon, lines: [line({ ...decathlon.lines[0], userCategoryCode: 'private_expense', userBusinessSharePct: '0' })] });
    expect(answered.documentQuestions).toEqual([]);
    expect(answered.businessFlag).toBe('personal');
    expect(answered.lines[0]).toMatchObject({ categoryCode: 'private_expense', businessSharePct: '0', deductibility: 'non_deductible', taxEffect: 'private' });
  });

  it('private_expense forces 0 % even without a share answer', () => {
    const { l } = first(input({ lines: [line({ userCategoryCode: 'private_expense' })] }));
    expect(l.businessSharePct).toBe('0');
  });

  it('car categories take the car setting, else 100 % plus a car_regime question', () => {
    const fuel = (carBusinessSharePct: string | null) =>
      first(input({ lines: [line({ description: 'Nafta 40 l' })], settings: { activityKeywords: [], carBusinessSharePct, hiddenCategoryCodes: [] } })).l;
    expect(fuel('60')).toMatchObject({ categoryCode: 'exp_fuel', businessSharePct: '60', deductibility: 'partially_deductible', questions: [] });
    expect(fuel(null)).toMatchObject({ businessSharePct: '100', questions: ['car_regime'] });
  });

  it('mixed shares → flag mixed', () => {
    const r = runCategoryCascade(
      input({ lines: [line({ position: 1, userBusinessSharePct: '100' }), line({ position: 2, description: 'Nafta', userBusinessSharePct: '50' })] }),
    );
    expect(r.businessFlag).toBe('mixed');
  });

  it('low-confidence lines under 100 Kč in total keep the guess without a question', () => {
    const small = first(input({ lines: [line({ description: 'Něco', gross: czk('60.00'), net: czk('60.00') })] })).l;
    expect(small).toMatchObject({ accepted: false, lowValue: true, questions: [] });
    const big = first(input({ lines: [line({ description: 'Něco', gross: czk('150.00'), net: czk('150.00') })] })).l;
    expect(big).toMatchObject({ accepted: false, lowValue: false, questions: ['which_category'] });
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- cascade 2>&1 | tail -30`. Expected: fails (module missing).

2. Create `packages/domain/src/taxonomy/cascade.ts`. Exported names and signatures exactly (add private helpers freely):

```ts
import { Decimal } from 'decimal.js';
import type { LegalDate } from '../dates/index';
import type { DocumentClass, Direction, FieldSource, LineType, TaxEffect, VatStatus } from '../enums/index';
import type { Currency, Money } from '../money/index';
import { parseClassificationRules, type ClassificationRules } from '../rules/cz/classification';
import type { RULE_SCHEMAS } from '../rules/keys';
import type { RuleResolver } from '../rules/resolver';
import { type Category, type CategoryCode, type Deductibility, deriveDeductibility, categoryAllowsDirection, findCategory, isCategoryValidOn } from './categories';

export type DecisionSource = 'user_line' | 'hard_rule' | 'user_vendor_rule' | 'vendor_memory' | 'global_prior' | 'soft_rule' | 'llm' | 'fallback';
export type CascadeQuestionKind = 'which_category' | 'business_or_personal' | 'small_asset_business_use' | 'asset_over_threshold' | 'car_regime';
export type StatementColumn = 'reservation' | 'commission' | 'payment_fee' | 'tourist_fee' | 'payout';

export interface CascadeLine { readonly lineId: string; readonly position: number; readonly lineType: LineType; readonly description: string | null; readonly quantity: string | null; readonly net: Money | null; readonly vat: Money | null; readonly gross: Money | null; readonly userCategoryCode: string | null; readonly userBusinessSharePct: string | null; readonly statementColumn: StatementColumn | null; }
export interface CascadeDocument { readonly class: DocumentClass; readonly direction: Direction; readonly issueDate: LegalDate; readonly currency: Currency; readonly fxRateToCzk: string | null /* CZK per 1 unit; null → treated as '1' */; readonly personalPurchaseSuspected: boolean; }
export interface CascadeSupplier { readonly name: string | null; readonly naceCodes: readonly string[]; readonly authorityKind: string | null; }
export interface CascadeVendor { readonly pinned: boolean; readonly multiCategory: boolean; readonly confirmations: number; readonly defaultCategoryCode: string | null; readonly defaultBusinessFlag: 'business' | 'personal' | 'mixed' | null; }
export interface CascadeOriginalLine { readonly description: string | null; readonly gross: Money | null; readonly categoryCode: string; }
export interface CascadeOriginal { readonly lines: readonly CascadeOriginalLine[]; }
export interface CascadeSettings { readonly activityKeywords: readonly string[]; readonly carBusinessSharePct: string | null; readonly hiddenCategoryCodes: readonly string[]; }
export interface CascadeLlmLine { readonly position: number; readonly categoryCode: string; readonly confidence: number; readonly assetCandidate?: boolean; }
export interface CascadeLlm { readonly lines: readonly CascadeLlmLine[]; }
export interface CascadeInput { readonly doc: CascadeDocument; readonly lines: readonly CascadeLine[]; readonly supplier: CascadeSupplier | null; readonly vendor: CascadeVendor | null; readonly original: CascadeOriginal | null; readonly settings: CascadeSettings; readonly vatStatusAtIssue: VatStatus; readonly deductionAllowed: boolean; readonly llm?: CascadeLlm; readonly rules: RuleResolver<typeof RULE_SCHEMAS>; }
export interface CategoryDecision { readonly lineId: string; readonly position: number; readonly categoryCode: CategoryCode | null; readonly taxEffect: TaxEffect | null; readonly decidedBy: DecisionSource; readonly source: FieldSource; readonly confidence: number; readonly ruleId: string | null; readonly accepted: boolean; readonly lowValue: boolean; readonly businessSharePct: string; readonly deductibility: Deductibility; readonly questions: readonly CascadeQuestionKind[]; }
export interface CascadeResult { readonly lines: readonly CategoryDecision[]; readonly needsLlm: readonly number[]; readonly documentQuestions: readonly CascadeQuestionKind[]; readonly businessFlag: 'business' | 'personal' | 'mixed' | 'unknown'; }

export const ASSET_CHECK_CATEGORIES: readonly CategoryCode[] = ['exp_material', 'exp_small_assets', 'exp_office_supplies', 'exp_other_deductible', 'exp_repairs'];
export const CAR_CATEGORIES: readonly CategoryCode[] = ['exp_fuel', 'exp_car_operating', 'exp_car_lease'];
export function normalizeText(text: string): string;
export function matchesKeyword(normalizedText: string, keyword: string): boolean;
export function descriptionSimilarity(a: string | null, b: string | null): number;
export function runCategoryCascade(input: CascadeInput): CascadeResult;
```

Implementation notes (follow §2 exactly):

- `source` by `decidedBy`: user_line → `user`; hard_rule, soft_rule, fallback → `rule`; user_vendor_rule, vendor_memory → `vendor_memory`; llm → `llm`.
- Confidences are plain numbers (not money). Round the memory confidence to 2 decimals with `Math.round(x * 100) / 100` so `0.88 + 0.02·3` is exactly `0.94`.
- Money: `|gross|` comparisons via `Money.abs().compare()`; CZK conversion via `money.toDecimal().times(new Decimal(fxRateToCzk ?? '1'))`; `uc` as a Decimal; the threshold `new Decimal(String(rulesAt.get('asset.capitalization_threshold')))`.
- Derived lines (`rounding | shipping | discount | advance_deduction`) are decided after all other lines so H1/H2 can read the dominant item's final category (after the asset check).
- Result lines are in position order, text lines excluded; `needsLlm` ascending positions.
- Keep the file under ~400 lines; no I/O, no `Date`.

Implement until the test passes; do not edit the test file. Then `pnpm exec biome check --write packages/domain/src/taxonomy/cascade.ts 2>&1 | tail -5`.

Command: `pnpm --filter @shoebox/domain test -- cascade 2>&1 | tail -30`. Expected: all tests pass, 0 failed.

3. Edit `packages/domain/src/index.ts`. Anchor:

```ts
export * from './taxonomy/categories';
```

Insert before it:

```ts
export * from './taxonomy/cascade';
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` then `pnpm exec biome check packages/domain 2>&1 | tail -10`. Expected: clean.

## 5. Do not touch

`packages/domain/src/rules/`, `packages/domain/src/taxonomy/categories.ts`, test files, every other package. Hard rules 1, 2, 6.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- cascade 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] `cascade.test.ts` green, unchanged (AC-1 table, property, H1–H5, S1–S4, asset check, shares).
- [ ] No numeric threshold in `cascade.ts` other than the confidences 0.98/0.99/1.00/0.92 named by the M04 table and the memory formula.
- [ ] Commits `0303 step 1..3`; no push.

## 8. Stop and ask

As TEMPLATE §8. Also stop if a test seems to contradict §2 (write which one).

## 9. Report

`docs/tasks/0303-report.md`, `Status: review`, commit `0303 report`.

## Spec notes for the reviewer

- Stage 6 (LLM) is included as a pure consumer of `input.llm` so AC-1's "all 8 stages present/absent" can be tested now; CAT-03 supplies the data later. Stage 4 is always skipped (05 §9.1 Later).
- `business_or_personal` is a document-level question (04 §9.1 chips) and is returned in `documentQuestions`; line-level questions are per line. CAT-04 groups them (≤ 2 per document).
- Platform statements skip the direction check because they carry income and fee lines together; 04 §3.1 gives categories one direction.
- H4 takes `supplier.authorityKind` from the caller (M07's `bank.authority_accounts` is `[verify]` and not seeded); the kind → category map is data.
- `car_regime` (04 §3.1 one-time question) is raised here whenever a car category has no car setting; CAT-04 de-duplicates it per org.

## Risk list (for the reviewer)

`packages/domain/src/taxonomy/cascade.ts` (whole file: category and share decisions drive the tax ledger).

## Owner steps

None.
