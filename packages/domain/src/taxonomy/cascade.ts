import { Decimal } from 'decimal.js';
import type { LegalDate } from '../dates/index';
import type {
  Direction,
  DocumentClass,
  FieldSource,
  LineType,
  TaxEffect,
  VatStatus,
} from '../enums/index';
import type { Currency, Money } from '../money/index';
import {
  type ClassificationRules,
  type HardRule,
  type NaceCategoryMap,
  parseClassificationRules,
} from '../rules/cz/classification';
import type { RULE_SCHEMAS } from '../rules/keys';
import type { RuleResolver } from '../rules/resolver';
import {
  type Category,
  type CategoryCode,
  categoryAllowsDirection,
  type Deductibility,
  deriveDeductibility,
  findCategory,
  isCategoryValidOn,
} from './categories';

export type DecisionSource =
  | 'user_line'
  | 'hard_rule'
  | 'user_vendor_rule'
  | 'vendor_memory'
  | 'global_prior'
  | 'soft_rule'
  | 'llm'
  | 'fallback';
export type CascadeQuestionKind =
  | 'which_category'
  | 'business_or_personal'
  | 'small_asset_business_use'
  | 'asset_over_threshold'
  | 'car_regime';
export type StatementColumn =
  | 'reservation'
  | 'commission'
  | 'payment_fee'
  | 'tourist_fee'
  | 'payout';

export interface CascadeLine {
  readonly lineId: string;
  readonly position: number;
  readonly lineType: LineType;
  readonly description: string | null;
  readonly quantity: string | null;
  readonly net: Money | null;
  readonly vat: Money | null;
  readonly gross: Money | null;
  readonly userCategoryCode: string | null;
  readonly userBusinessSharePct: string | null;
  readonly statementColumn: StatementColumn | null;
}
export interface CascadeDocument {
  readonly class: DocumentClass;
  readonly direction: Direction;
  readonly issueDate: LegalDate;
  readonly currency: Currency;
  readonly fxRateToCzk: string | null /* CZK per 1 unit; null → treated as '1' */;
  readonly personalPurchaseSuspected: boolean;
}
export interface CascadeSupplier {
  readonly name: string | null;
  readonly naceCodes: readonly string[];
  readonly authorityKind: string | null;
}
export interface CascadeVendor {
  readonly pinned: boolean;
  readonly multiCategory: boolean;
  readonly confirmations: number;
  readonly defaultCategoryCode: string | null;
  readonly defaultBusinessFlag: 'business' | 'personal' | 'mixed' | null;
}
export interface CascadeOriginalLine {
  readonly description: string | null;
  readonly gross: Money | null;
  readonly categoryCode: string;
}
export interface CascadeOriginal {
  readonly lines: readonly CascadeOriginalLine[];
}
export interface CascadeSettings {
  readonly activityKeywords: readonly string[];
  readonly carBusinessSharePct: string | null;
  readonly hiddenCategoryCodes: readonly string[];
}
export interface CascadeLlmLine {
  readonly position: number;
  readonly categoryCode: string;
  readonly confidence: number;
  readonly assetCandidate?: boolean;
}
export interface CascadeLlm {
  readonly lines: readonly CascadeLlmLine[];
}
export interface CascadeInput {
  readonly doc: CascadeDocument;
  readonly lines: readonly CascadeLine[];
  readonly supplier: CascadeSupplier | null;
  readonly vendor: CascadeVendor | null;
  readonly original: CascadeOriginal | null;
  readonly settings: CascadeSettings;
  readonly vatStatusAtIssue: VatStatus;
  readonly deductionAllowed: boolean;
  readonly llm?: CascadeLlm;
  readonly rules: RuleResolver<typeof RULE_SCHEMAS>;
}
export interface CategoryDecision {
  readonly lineId: string;
  readonly position: number;
  readonly categoryCode: CategoryCode | null;
  readonly taxEffect: TaxEffect | null;
  readonly decidedBy: DecisionSource;
  readonly source: FieldSource;
  readonly confidence: number;
  readonly ruleId: string | null;
  readonly accepted: boolean;
  readonly lowValue: boolean;
  readonly businessSharePct: string;
  readonly deductibility: Deductibility;
  readonly questions: readonly CascadeQuestionKind[];
}
export interface CascadeResult {
  readonly lines: readonly CategoryDecision[];
  readonly needsLlm: readonly number[];
  readonly documentQuestions: readonly CascadeQuestionKind[];
  readonly businessFlag: 'business' | 'personal' | 'mixed' | 'unknown';
}

export const ASSET_CHECK_CATEGORIES: readonly CategoryCode[] = [
  'exp_material',
  'exp_small_assets',
  'exp_office_supplies',
  'exp_other_deductible',
  'exp_repairs',
];
export const CAR_CATEGORIES: readonly CategoryCode[] = [
  'exp_fuel',
  'exp_car_operating',
  'exp_car_lease',
];

// M04 §4.1 confidences fixed by the table; soft and vendor-memory confidences come from the rules.
const CONFIDENCE_USER = 1;
const CONFIDENCE_HARD_RULE = 0.98;
const CONFIDENCE_USER_VENDOR = 0.99;
const CONFIDENCE_LLM_CAP = 0.92;
// Vendor memory: min(0.97, 0.88 + 0.02 · confirmations), rounded to 2 decimals.
const MEMORY_BASE = 0.88;
const MEMORY_STEP = 0.02;
const MEMORY_CAP = 0.97;

const DERIVED_LINE_TYPES: readonly LineType[] = [
  'rounding',
  'shipping',
  'discount',
  'advance_deduction',
];

// ---------------------------------------------------------------------------------------------
// Text helpers

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function normalizeText(text: string): string {
  return fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A trailing `*` matches the rest of the word; the keyword must match whole words. */
export function matchesKeyword(normalizedText: string, keyword: string): boolean {
  const pattern = fold(keyword)
    .replace(/[^\p{L}\p{N}*]+/gu, ' ')
    .trim()
    .split('*')
    .map(escapeRegExp)
    .join('[a-z0-9]*');
  if (pattern === '') {
    return false;
  }
  return new RegExp(`(^|\\s)${pattern}(?=\\s|$)`).test(normalizedText);
}

export function descriptionSimilarity(a: string | null, b: string | null): number {
  const first = normalizeText(a ?? '');
  const second = normalizeText(b ?? '');
  if (first === '' && second === '') {
    return 0;
  }
  if (first === second) {
    return 1;
  }
  const wordsA = new Set(first === '' ? [] : first.split(' '));
  const wordsB = new Set(second === '' ? [] : second.split(' '));
  let common = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      common += 1;
    }
  }
  return (2 * common) / (wordsA.size + wordsB.size);
}

// ---------------------------------------------------------------------------------------------
// Internal model

interface Ctx {
  readonly input: CascadeInput;
  readonly cls: ClassificationRules;
  readonly fx: Decimal;
  readonly threshold: Decimal;
  readonly hidden: ReadonlySet<string>;
  readonly llm: ReadonlyMap<number, CascadeLlmLine>;
  readonly platform: boolean;
  readonly items: readonly CascadeLine[];
  readonly dominant: CascadeLine | null;
  /** Final category code of each item line, filled as the item lines are decided. */
  readonly finalCode: Map<number, string | null>;
}

interface Hit {
  readonly category: Category;
  readonly decidedBy: DecisionSource;
  readonly confidence: number;
  readonly ruleId: string | null;
}

interface SoftCandidate {
  readonly category: Category;
  readonly confidence: number;
  readonly ruleId: string;
}

interface Draft {
  readonly line: CascadeLine;
  readonly category: Category | null;
  readonly decidedBy: DecisionSource;
  readonly ruleId: string | null;
  readonly confidence: number;
  readonly share: string;
  readonly businessOrPersonal: boolean;
  readonly carRegime: boolean;
  readonly assetOver: boolean;
  readonly smallAsset: boolean;
}

const sourceOf = (decidedBy: DecisionSource): FieldSource => {
  switch (decidedBy) {
    case 'user_line':
      return 'user';
    case 'hard_rule':
    case 'soft_rule':
    case 'fallback':
      return 'rule';
    case 'user_vendor_rule':
    case 'vendor_memory':
    case 'global_prior':
      return 'vendor_memory';
    case 'llm':
      return 'llm';
  }
};

const toCzk = (money: Money | null, fx: Decimal): Decimal =>
  money === null ? new Decimal(0) : money.toDecimal().times(fx);

const memoryConfidence = (confirmations: number): number =>
  Math.round(Math.min(MEMORY_CAP, MEMORY_BASE + MEMORY_STEP * confirmations) * 100) / 100;

const dominantOf = <T extends { readonly gross: Money | null }>(items: readonly T[]): T | null => {
  let best: T | null = null;
  let bestAbs: Money | null = null;
  for (const item of items) {
    if (item.gross === null) {
      continue;
    }
    const abs = item.gross.abs();
    if (bestAbs === null || abs.compare(bestAbs) > 0) {
      best = item;
      bestAbs = abs;
    }
  }
  return best;
};

/** Stages 0-7 for one line, without the asset check. Returns null when nothing applies (stage 7). */
function validCategory(code: string | null, ctx: Ctx, allowHidden: boolean): Category | null {
  if (code === null) {
    return null;
  }
  const category = findCategory(code);
  if (category === undefined || !isCategoryValidOn(category, ctx.input.doc.issueDate)) {
    return null;
  }
  if (!allowHidden && ctx.hidden.has(category.code)) {
    return null;
  }
  if (
    ctx.input.doc.class !== 'platform_statement' &&
    !categoryAllowsDirection(category, ctx.input.doc.direction)
  ) {
    return null;
  }
  return category;
}

function derivedCode(ctx: Ctx, line: CascadeLine, preceding: boolean): string | null {
  if (preceding) {
    let near: CascadeLine | null = null;
    for (const item of ctx.items) {
      if (item.position < line.position) {
        near = item;
      }
    }
    if (near !== null) {
      return ctx.finalCode.get(near.position) ?? null;
    }
  }
  return ctx.dominant === null ? null : (ctx.finalCode.get(ctx.dominant.position) ?? null);
}

function hardRuleCode(rule: HardRule, line: CascadeLine, ctx: Ctx): string | null {
  switch (rule.action) {
    case 'inherit_dominant':
      return rule.line_types.some((type) => type === line.lineType)
        ? derivedCode(ctx, line, false)
        : null;
    case 'inherit_preceding_item':
      return rule.line_types.some((type) => type === line.lineType)
        ? derivedCode(ctx, line, true)
        : null;
    case 'match_description': {
      const text = normalizeText(line.description ?? '');
      const byText = rule.patterns.some((pattern) => matchesKeyword(text, pattern));
      const byColumn =
        line.statementColumn !== null &&
        (rule.statement_columns ?? []).includes(line.statementColumn);
      return byText || byColumn ? rule.category : null;
    }
    case 'authority': {
      const kind = ctx.input.supplier?.authorityKind ?? null;
      return kind !== null && Object.hasOwn(rule.map, kind) ? (rule.map[kind] ?? null) : null;
    }
    case 'inherit_original': {
      const original = ctx.input.original;
      if (ctx.input.doc.class !== 'received_credit_note' || original === null) {
        return null;
      }
      let best: CascadeOriginalLine | null = null;
      let bestScore = -1;
      for (const candidate of original.lines) {
        const score = descriptionSimilarity(line.description, candidate.description);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      if (best !== null && bestScore >= rule.min_similarity) {
        return best.categoryCode;
      }
      return dominantOf(original.lines)?.categoryCode ?? null;
    }
  }
}

function naceCategory(codes: readonly string[], map: NaceCategoryMap): string | null {
  for (const code of codes) {
    if (Object.hasOwn(map, code)) {
      return map[code] ?? null;
    }
  }
  for (const code of codes) {
    const key = Object.keys(map).find(
      (candidate) => candidate.endsWith('.*') && candidate.slice(0, 2) === code.slice(0, 2),
    );
    if (key !== undefined) {
      return map[key] ?? null;
    }
  }
  return null;
}

function softCandidates(line: CascadeLine, ctx: Ctx): SoftCandidate[] {
  const { cls, input } = ctx;
  const out: SoftCandidate[] = [];
  const add = (code: string, confidence: number, ruleId: string): void => {
    const category = validCategory(code, ctx, false);
    if (category !== null) {
      out.push({ category, confidence, ruleId });
    }
  };
  const text = normalizeText(line.description ?? '');
  for (const rule of cls.softRules) {
    switch (rule.kind) {
      case 'platform': {
        if (!ctx.platform) {
          break;
        }
        const col = line.statementColumn;
        const incomeLine =
          col === 'reservation' ||
          col === 'payout' ||
          (col === null && line.gross !== null && line.gross.isPositive());
        if (rule.commission_patterns.some((pattern) => matchesKeyword(text, pattern))) {
          add(rule.commission_category, rule.confidence, rule.id);
        } else if (rule.payment_fee_patterns.some((pattern) => matchesKeyword(text, pattern))) {
          add(rule.payment_fee_category, rule.confidence, rule.id);
        } else if (input.doc.class === 'platform_statement' && incomeLine) {
          const accommodation = input.settings.activityKeywords.includes(
            rule.accommodation_keyword,
          );
          add(
            accommodation ? rule.accommodation_category : rule.payout_category,
            rule.statement_income_confidence,
            rule.id,
          );
        }
        break;
      }
      case 'keywords':
        for (const row of cls.keywordRules) {
          if (row.role !== 'category') {
            continue;
          }
          const found = new Set(row.keywords.filter((keyword) => matchesKeyword(text, keyword)))
            .size;
          if (found >= 1) {
            add(row.category, found >= 2 ? rule.confidence_two_keywords : rule.confidence, rule.id);
          }
        }
        break;
      case 'nace': {
        if (ctx.items.length > rule.max_item_lines) {
          break;
        }
        const code = naceCategory(input.supplier?.naceCodes ?? [], cls.naceCategoryMap);
        if (code === null) {
          break;
        }
        const withKeywords = out.some(
          (candidate) => candidate.ruleId === 'S2' && candidate.category.code === code,
        );
        add(code, withKeywords ? rule.confidence_with_keywords : rule.confidence, rule.id);
        break;
      }
      case 'issued_default': {
        if (input.doc.class !== 'issued_invoice') {
          break;
        }
        const goods = cls.keywordRules.some(
          (row) =>
            row.role === 'goods' && row.keywords.some((keyword) => matchesKeyword(text, keyword)),
        );
        add(goods ? rule.goods_category : rule.category, rule.confidence, rule.id);
        break;
      }
    }
  }
  return out;
}

function pickCategory(line: CascadeLine, ctx: Ctx): Hit | null {
  const { cls, input } = ctx;
  const user = validCategory(line.userCategoryCode, ctx, true);
  if (user !== null) {
    return { category: user, decidedBy: 'user_line', confidence: CONFIDENCE_USER, ruleId: null };
  }
  for (const rule of cls.hardRules) {
    const category = validCategory(hardRuleCode(rule, line, ctx), ctx, false);
    if (category !== null) {
      return {
        category,
        decidedBy: 'hard_rule',
        confidence: CONFIDENCE_HARD_RULE,
        ruleId: rule.id,
      };
    }
  }
  const vendor = input.vendor;
  if (vendor !== null && !vendor.multiCategory) {
    const pinned = vendor.pinned ? validCategory(vendor.defaultCategoryCode, ctx, false) : null;
    if (pinned !== null) {
      return {
        category: pinned,
        decidedBy: 'user_vendor_rule',
        confidence: CONFIDENCE_USER_VENDOR,
        ruleId: null,
      };
    }
    if (vendor.confirmations >= cls.vendorMemoryMinConfirmations) {
      const memory = validCategory(vendor.defaultCategoryCode, ctx, false);
      if (memory !== null) {
        return {
          category: memory,
          decidedBy: 'vendor_memory',
          confidence: memoryConfidence(vendor.confirmations),
          ruleId: null,
        };
      }
    }
  }
  let best: SoftCandidate | null = null;
  for (const candidate of softCandidates(line, ctx)) {
    if (best === null || candidate.confidence > best.confidence) {
      best = candidate;
    }
  }
  if (best !== null) {
    return {
      category: best.category,
      decidedBy: 'soft_rule',
      confidence: best.confidence,
      ruleId: best.ruleId,
    };
  }
  const llm = ctx.llm.get(line.position);
  const llmCategory = llm === undefined ? null : validCategory(llm.categoryCode, ctx, false);
  if (llm !== undefined && llmCategory !== null) {
    return {
      category: llmCategory,
      decidedBy: 'llm',
      confidence: Math.min(llm.confidence, CONFIDENCE_LLM_CAP),
      ruleId: null,
    };
  }
  return null;
}

/** M04 §4.1 asset check for item lines; returns the (possibly new) category and whether the threshold was crossed. */
function assetAdjust(
  line: CascadeLine,
  category: Category,
  ctx: Ctx,
): { category: Category; over: boolean } {
  if (line.lineType !== 'item' || !ASSET_CHECK_CATEGORIES.includes(category.code)) {
    return { category, over: false };
  }
  const net = (line.net ?? line.gross)?.toDecimal() ?? new Decimal(0);
  const vatFree = ctx.input.vatStatusAtIssue === 'platce' && ctx.input.deductionAllowed;
  const vat = vatFree || line.vat === null ? new Decimal(0) : line.vat.toDecimal().times(ctx.fx);
  const quantity = Decimal.max(new Decimal(line.quantity ?? '1'), 1);
  const unitCost = net.times(ctx.fx).plus(vat).dividedBy(quantity);
  if (unitCost.greaterThan(ctx.threshold)) {
    const large = validCategory('asset_long_term', ctx, false);
    return large === null ? { category, over: false } : { category: large, over: true };
  }
  const text = normalizeText(line.description ?? '');
  const durable =
    ctx.llm.get(line.position)?.assetCandidate === true ||
    ctx.cls.keywordRules.some(
      (row) =>
        row.role === 'durable' && row.keywords.some((keyword) => matchesKeyword(text, keyword)),
    );
  if (durable) {
    const small = validCategory('exp_small_assets', ctx, false);
    if (small !== null) {
      return { category: small, over: false };
    }
  }
  return { category, over: false };
}

function shareOf(
  line: CascadeLine,
  category: Category | null,
  ctx: Ctx,
): { share: string; businessOrPersonal: boolean; carRegime: boolean } {
  const plain = (share: string) => ({ share, businessOrPersonal: false, carRegime: false });
  if (line.userBusinessSharePct !== null) {
    return plain(line.userBusinessSharePct);
  }
  if (category?.code === 'private_expense') {
    return plain('0');
  }
  const vendor = ctx.input.vendor;
  if (vendor !== null && vendor.confirmations >= ctx.cls.vendorMemoryMinConfirmations) {
    switch (vendor.defaultBusinessFlag) {
      case 'business':
        return plain('100');
      case 'personal':
        return plain('0');
      case 'mixed':
        return { share: '100', businessOrPersonal: true, carRegime: false };
      case null:
        break;
    }
  }
  if (category !== null && CAR_CATEGORIES.includes(category.code)) {
    const carShare = ctx.input.settings.carBusinessSharePct;
    return carShare !== null
      ? plain(carShare)
      : { share: '100', businessOrPersonal: false, carRegime: true };
  }
  return plain('100');
}

function decide(line: CascadeLine, ctx: Ctx): Draft {
  const hit = pickCategory(line, ctx);
  let category = hit?.category ?? null;
  let assetOver = false;
  if (category !== null && hit?.decidedBy !== 'user_line') {
    const adjusted = assetAdjust(line, category, ctx);
    category = adjusted.category;
    assetOver = adjusted.over;
  }
  if (line.lineType === 'item') {
    ctx.finalCode.set(line.position, category?.code ?? null);
  }
  const shares = shareOf(line, category, ctx);
  return {
    line,
    category,
    decidedBy: hit?.decidedBy ?? 'fallback',
    ruleId: hit?.ruleId ?? null,
    confidence: hit?.confidence ?? 0,
    share: shares.share,
    businessOrPersonal: shares.businessOrPersonal,
    carRegime: shares.carRegime,
    assetOver,
    smallAsset: category?.code === 'exp_small_assets' && line.userBusinessSharePct === null,
  };
}

// ---------------------------------------------------------------------------------------------
// Entry point

export function runCategoryCascade(input: CascadeInput): CascadeResult {
  const at = input.rules.at(input.doc.issueDate);
  const cls = parseClassificationRules(at);
  const lines = input.lines
    .filter((line) => line.lineType !== 'text')
    .sort((a, b) => a.position - b.position);
  const items = lines.filter((line) => line.lineType === 'item');
  const supplierText = normalizeText(input.supplier?.name ?? '');
  const ctx: Ctx = {
    input,
    cls,
    fx: new Decimal(input.doc.fxRateToCzk ?? '1'),
    threshold: new Decimal(String(at.get('asset.capitalization_threshold'))),
    hidden: new Set(input.settings.hiddenCategoryCodes),
    llm: new Map((input.llm?.lines ?? []).map((entry) => [entry.position, entry] as const)),
    platform: cls.platforms.some((platform) =>
      platform.match.some((fragment) => supplierText.includes(normalizeText(fragment))),
    ),
    items,
    dominant: dominantOf(items),
    finalCode: new Map(),
  };

  // Phase A: every line except the derived ones; their categories feed H1/H2.
  const drafts: Draft[] = [];
  for (const line of lines) {
    if (!DERIVED_LINE_TYPES.includes(line.lineType)) {
      drafts.push(decide(line, ctx));
    }
  }
  // Phase B: derived lines (rounding, shipping, discount, advance deduction).
  for (const line of lines) {
    if (DERIVED_LINE_TYPES.includes(line.lineType)) {
      drafts.push(decide(line, ctx));
    }
  }
  drafts.sort((a, b) => a.line.position - b.line.position);

  const accepted = (draft: Draft): boolean => draft.confidence >= cls.autoAcceptConfidence;
  const lowSum = drafts.reduce(
    (sum, draft) => (accepted(draft) ? sum : sum.plus(toCzk(draft.line.gross, ctx.fx).abs())),
    new Decimal(0),
  );
  const lowValue = lowSum.lessThan(cls.lowValueSkipCzk);

  const documentQuestions: CascadeQuestionKind[] = [];
  const personalAsked =
    drafts.some((draft) => draft.businessOrPersonal) ||
    (input.doc.personalPurchaseSuspected &&
      drafts.every((draft) => draft.line.userBusinessSharePct === null));
  if (personalAsked) {
    documentQuestions.push('business_or_personal');
  }

  const shareIs = (share: string, value: number): boolean => new Decimal(share).equals(value);
  const businessFlag: CascadeResult['businessFlag'] = documentQuestions.includes(
    'business_or_personal',
  )
    ? 'unknown'
    : drafts.every((draft) => shareIs(draft.share, 100))
      ? 'business'
      : drafts.every((draft) => shareIs(draft.share, 0))
        ? 'personal'
        : 'mixed';

  const decisions: CategoryDecision[] = drafts.map((draft) => {
    const isAccepted = accepted(draft);
    const low = !isAccepted && lowValue;
    const questions: CascadeQuestionKind[] = [];
    if (!isAccepted && !low) {
      questions.push('which_category');
    }
    if (draft.assetOver) {
      questions.push('asset_over_threshold');
    }
    if (draft.smallAsset) {
      questions.push('small_asset_business_use');
    }
    if (draft.carRegime) {
      questions.push('car_regime');
    }
    return {
      lineId: draft.line.lineId,
      position: draft.line.position,
      categoryCode: draft.category?.code ?? null,
      taxEffect: draft.category?.taxEffect ?? null,
      decidedBy: draft.decidedBy,
      source: sourceOf(draft.decidedBy),
      confidence: draft.confidence,
      ruleId: draft.ruleId,
      accepted: isAccepted,
      lowValue: low,
      businessSharePct: draft.share,
      deductibility:
        draft.category === null
          ? 'not_applicable'
          : deriveDeductibility(draft.category, draft.share),
      questions,
    };
  });

  return {
    lines: decisions,
    needsLlm: drafts
      .filter((draft) => draft.decidedBy === 'fallback')
      .map((draft) => draft.line.position),
    documentQuestions,
    businessFlag,
  };
}
