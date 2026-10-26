import type { CategorizeQuestionRow } from '@shoebox/db';
export type QuestionKind =
  | 'business_or_personal'
  | 'which_category'
  | 'small_asset_business_use'
  | 'asset_over_threshold'
  | 'car_regime'
  | 'supply_kind'
  | 'relearn_vendor';
export interface UserLineField {
  readonly position: number;
  readonly key: 'category_code' | 'business_share_pct' | 'supply_kind';
  readonly value: string;
}
export interface QuestionPayload {
  readonly question: string;
  readonly params?: Record<string, unknown>;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly text?: string;
  }[];
  readonly suggested?: string;
}

const MAX_OPTIONS = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses a stored payload; null when it does not match the deck contract (never throws). */
export function parseQuestionPayload(payload: unknown): QuestionPayload | null {
  try {
    if (!isRecord(payload)) return null;
    const { question, params, options, suggested } = payload;
    if (typeof question !== 'string') return null;
    if (!Array.isArray(options) || options.length < 1 || options.length > MAX_OPTIONS) return null;
    const parsed: { value: string; label: string; text?: string }[] = [];
    for (const option of options) {
      if (!isRecord(option)) return null;
      if (typeof option.value !== 'string' || typeof option.label !== 'string') return null;
      if (option.text !== undefined && typeof option.text !== 'string') return null;
      parsed.push(
        option.text === undefined
          ? { value: option.value, label: option.label }
          : { value: option.value, label: option.label, text: option.text },
      );
    }
    if (params !== undefined && !isRecord(params)) return null;
    if (suggested !== undefined && typeof suggested !== 'string') return null;
    return {
      question,
      ...(params === undefined ? {} : { params }),
      options: parsed,
      ...(suggested === undefined ? {} : { suggested }),
    };
  } catch {
    return null;
  }
}

function lineIdsOf(payload: QuestionPayload): string[] | null {
  const raw = payload.params?.line_ids;
  if (!Array.isArray(raw)) return null;
  return raw.filter((id): id is string => typeof id === 'string');
}

function isAnswered(row: CategorizeQuestionRow): boolean {
  return row.answer !== null && row.answer !== undefined;
}

function answerValue(row: CategorizeQuestionRow): string | null {
  if (!isAnswered(row) || !isRecord(row.answer) || typeof row.answer.value !== 'string')
    return null;
  return row.answer.value;
}

function fieldsFor(kind: string, value: string, positions: readonly number[]): UserLineField[] {
  const out: UserLineField[] = [];
  const put = (key: UserLineField['key'], v: string) => {
    for (const position of positions) out.push({ position, key, value: v });
  };
  switch (kind) {
    case 'business_or_personal':
      if (value === 'business') put('business_share_pct', '100');
      else if (value === 'personal') {
        put('category_code', 'private_expense');
        put('business_share_pct', '0');
      } else if (value === 'mixed') put('business_share_pct', '50');
      break;
    case 'which_category':
      put('category_code', value);
      break;
    case 'small_asset_business_use':
      put('business_share_pct', value);
      break;
    case 'asset_over_threshold':
      if (value === 'yes') put('category_code', 'asset_long_term');
      else if (value === 'no') put('category_code', 'exp_small_assets');
      break;
    case 'supply_kind':
      put('supply_kind', value);
      break;
    default:
      // car_regime and relearn_vendor are not applied here (briefs 0322 and later).
      break;
  }
  return out;
}

/** The user line fields implied by the answered questions (answer.value ∈ options; unknown kinds/values ignored). `lineIdToPosition` maps `params.line_ids` to positions; a `business_or_personal` question without line_ids applies to every position. Later answers win (by answeredAt). */
export function applyAnswers(
  questions: readonly CategorizeQuestionRow[],
  lineIdToPosition: ReadonlyMap<string, number>,
): UserLineField[] {
  const answered = questions
    .filter((row) => row.answeredAt !== null && answerValue(row) !== null)
    .sort((a, b) => (a.answeredAt?.getTime() ?? 0) - (b.answeredAt?.getTime() ?? 0));
  const result = new Map<string, UserLineField>();
  for (const row of answered) {
    const payload = parseQuestionPayload(row.payload);
    const value = answerValue(row);
    if (!payload || value === null) continue;
    if (!payload.options.some((option) => option.value === value)) continue;
    const lineIds = lineIdsOf(payload);
    let positions: number[];
    if (lineIds === null) {
      if (row.kind !== 'business_or_personal') continue;
      positions = [...new Set(lineIdToPosition.values())];
    } else {
      positions = lineIds.flatMap((id) => {
        const position = lineIdToPosition.get(id);
        return position === undefined ? [] : [position];
      });
    }
    for (const field of fieldsFor(row.kind, value, positions)) {
      result.set(`${field.position}|${field.key}`, field);
    }
  }
  return [...result.values()];
}

/** Kinds with an open (unanswered) question. */
export function openKinds(questions: readonly CategorizeQuestionRow[]): ReadonlySet<string> {
  return new Set(questions.filter((row) => !isAnswered(row)).map((row) => row.kind));
}
