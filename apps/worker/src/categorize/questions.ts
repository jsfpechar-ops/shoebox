import type { CategorizeQuestionRow } from '@shoebox/db';
import { type CascadeResult, CZK, Money } from '@shoebox/domain';
import { openKinds, type QuestionKind, type QuestionPayload, parseQuestionPayload } from './answers';
export const QUESTION_PRIORITY: readonly QuestionKind[] = ['business_or_personal', 'asset_over_threshold', 'small_asset_business_use', 'supply_kind', 'car_regime', 'which_category'];
export interface QuestionContext {
  readonly merchant: string | null;                      // partner name
  readonly lines: readonly { readonly lineId: string; readonly position: number; readonly description: string | null; readonly grossCzk: string | null }[];
  readonly extraLineKinds: readonly { readonly lineId: string; readonly kind: 'supply_kind' }[];   // from VAT ambiguity (0319)
  readonly thresholdCzk: string;                         // rules asset.capitalization_threshold as decimal string
  readonly suggested: Partial<Record<QuestionKind, string>>;   // e.g. business_or_personal from vendor default / LLM likelihood
  readonly topCategories: ReadonlyMap<string, readonly { code: string; label: string; confidence: number }[]>;  // lineId → ≤3 for which_category
  readonly maxQuestions: number;
}
export interface PlannedQuestion { readonly kind: QuestionKind; readonly payload: QuestionPayload; }

type Option = QuestionPayload['options'][number];

const KIND_SET: ReadonlySet<string> = new Set<string>(QUESTION_PRIORITY);
const MAX_CATEGORY_OPTIONS = 3;
const PCT_VALUES = ['100', '80', '50', '0'];

function isQuestionKind(value: string): value is QuestionKind {
  return KIND_SET.has(value);
}

function isAnswered(row: CategorizeQuestionRow): boolean {
  return row.answer !== null && row.answer !== undefined;
}

function coveredLineIds(row: CategorizeQuestionRow): string[] {
  const raw = parseQuestionPayload(row.payload)?.params?.line_ids;
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
}

function toMoney(text: string | null): Money | null {
  if (text === null) return null;
  try {
    return Money.parse(text, CZK).abs();
  } catch {
    return null;
  }
}

function optionsFor(kind: QuestionKind, lineIds: readonly string[], ctx: QuestionContext): Option[] {
  switch (kind) {
    case 'business_or_personal':
      return ['business', 'personal', 'mixed'].map((value) => ({ value, label: `categorize.option.${value}` }));
    case 'small_asset_business_use':
      return PCT_VALUES.map((value) => ({ value, label: `categorize.option.pct_${value}` }));
    case 'asset_over_threshold':
      return ['yes', 'no'].map((value) => ({ value, label: `categorize.option.${value}` }));
    case 'supply_kind':
      return ['service', 'goods'].map((value) => ({ value, label: `categorize.option.${value}` }));
    case 'car_regime':
      return ['actual_costs', 'flat_rate_km', 'not_business_car'].map((value) => ({ value, label: `categorize.option.${value}` }));
    case 'which_category': {
      const seen = new Map<string, string>();
      for (const lineId of lineIds) {
        for (const candidate of ctx.topCategories.get(lineId) ?? []) {
          if (seen.size < MAX_CATEGORY_OPTIONS && !seen.has(candidate.code)) seen.set(candidate.code, candidate.label);
        }
      }
      return [...seen].map(([value, text]) => ({ value, label: 'categorize.option.category', text }));
    }
    default:
      return [];
  }
}

function buildPayload(kind: QuestionKind, lineIds: readonly string[], options: Option[], ctx: QuestionContext): QuestionPayload {
  const linesInGroup = lineIds.flatMap((id) => {
    const line = ctx.lines.find((candidate) => candidate.lineId === id);
    return line ? [line] : [];
  });
  const item = linesInGroup.find((line) => line.description)?.description ?? 'this item';
  const amounts = linesInGroup.flatMap((line) => {
    const money = toMoney(line.grossCzk);
    return money ? [money] : [];
  });
  const amount = amounts.length > 0 ? Money.sum(amounts, CZK).toFixed2() : null;
  const params: Record<string, unknown> = {
    line_ids: [...lineIds],
    item,
    merchant: ctx.merchant ?? '',
    amount_czk: amount,
  };
  if (kind === 'asset_over_threshold') params.threshold = ctx.thresholdCzk;
  const suggested = ctx.suggested[kind];
  return {
    question: `categorize.question.${kind}`,
    params,
    options,
    ...(suggested !== undefined && options.some((option) => option.value === suggested) ? { suggested } : {}),
  };
}

/** Groups the cascade's line questions and document questions per kind, skips kinds already open or answered for the same line ids, orders by QUESTION_PRIORITY, caps at maxQuestions. `params` always has `line_ids` (sorted), `item` (first line description or 'this item'), `merchant` ('' when null), `amount_czk` (sum of |grossCzk| of those lines, or null). */
export function buildQuestions(cascade: CascadeResult, existing: readonly CategorizeQuestionRow[], ctx: QuestionContext): { readonly asked: PlannedQuestion[]; readonly deferred: QuestionKind[] } {
  const groups = new Map<QuestionKind, Set<string>>();
  const add = (kind: string, lineId: string) => {
    if (!isQuestionKind(kind)) return;
    const set = groups.get(kind) ?? new Set<string>();
    set.add(lineId);
    groups.set(kind, set);
  };
  for (const decision of cascade.lines) {
    for (const kind of decision.questions) add(kind, decision.lineId);
  }
  for (const kind of cascade.documentQuestions) {
    for (const line of ctx.lines) add(kind, line.lineId);
  }
  for (const extra of ctx.extraLineKinds) add(extra.kind, extra.lineId);

  const open = openKinds(existing);
  const covered = new Map<string, Set<string>>();
  for (const row of existing) {
    if (!isAnswered(row)) continue;
    const set = covered.get(row.kind) ?? new Set<string>();
    for (const id of coveredLineIds(row)) set.add(id);
    covered.set(row.kind, set);
  }

  const asked: PlannedQuestion[] = [];
  const deferred: QuestionKind[] = [];
  for (const kind of QUESTION_PRIORITY) {
    const set = groups.get(kind);
    if (!set || set.size === 0 || open.has(kind)) continue;
    const lineIds = [...set].sort();
    const answered = covered.get(kind) ?? new Set<string>();
    if (lineIds.every((id) => answered.has(id))) continue;
    const options = optionsFor(kind, lineIds, ctx);
    if (options.length === 0) continue;
    if (asked.length >= ctx.maxQuestions) {
      deferred.push(kind);
      continue;
    }
    asked.push({ kind, payload: buildPayload(kind, lineIds, options, ctx) });
  }
  return { asked, deferred };
}
