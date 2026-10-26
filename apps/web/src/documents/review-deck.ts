import type { MessageKey } from '@shoebox/i18n';

export interface QuestionPayload {
  readonly question: MessageKey;
  readonly params: Record<string, string | number>;
  readonly options: readonly { value: string; label: MessageKey }[];
  readonly suggested: string | null;
}

export type ReviewCard =
  | {
      readonly type: 'question';
      readonly id: string;
      readonly documentId: string | null;
      readonly kind: string;
      readonly payload: QuestionPayload;
      readonly createdAt: string;
    }
  | { readonly type: 'document'; readonly documentId: string; readonly blocking: number; readonly createdAt: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** null unless the payload has a string question, 1–4 options of {value, label} strings, optional params object and suggested string that is one of the values. */
export function parseQuestionPayload(raw: unknown): QuestionPayload | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.question !== 'string') return null;
  if (!Array.isArray(raw.options) || raw.options.length < 1 || raw.options.length > 4) return null;

  const options: { value: string; label: MessageKey }[] = [];
  for (const option of raw.options) {
    if (!isRecord(option) || typeof option.value !== 'string' || typeof option.label !== 'string') return null;
    options.push({ value: option.value, label: option.label as MessageKey });
  }

  let params: Record<string, string | number> = {};
  if (raw.params !== undefined) {
    if (!isRecord(raw.params)) return null;
    const cleaned: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(raw.params)) {
      if (typeof value === 'string' || typeof value === 'number') cleaned[key] = value;
    }
    params = cleaned;
  }

  let suggested: string | null = null;
  if (raw.suggested !== undefined && raw.suggested !== null) {
    if (typeof raw.suggested !== 'string') return null;
    if (!options.some((option) => option.value === raw.suggested)) return null;
    suggested = raw.suggested;
  }

  return { question: raw.question as MessageKey, params, options, suggested };
}

/** Questions first (oldest first, those of one document together in order of their first question), then documents with blocking checks (most blocking first, then oldest). A document that has an open question gets no document card. */
export function buildDeck(
  questions: readonly Extract<ReviewCard, { type: 'question' }>[],
  documents: readonly Extract<ReviewCard, { type: 'document' }>[],
): ReviewCard[] {
  const groupKey = (card: Extract<ReviewCard, { type: 'question' }>) => card.documentId ?? `question:${card.id}`;
  const firstSeen = new Map<string, string>();
  for (const card of [...questions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const key = groupKey(card);
    if (!firstSeen.has(key)) firstSeen.set(key, card.createdAt);
  }
  const sortedQuestions = [...questions].sort((a, b) => {
    const byGroup = (firstSeen.get(groupKey(a)) ?? '').localeCompare(firstSeen.get(groupKey(b)) ?? '');
    if (byGroup !== 0) return byGroup;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const questionDocuments = new Set(
    questions.map((card) => card.documentId).filter((id): id is string => id !== null),
  );
  const documentCards = documents
    .filter((card) => !questionDocuments.has(card.documentId))
    .sort((a, b) => b.blocking - a.blocking || a.createdAt.localeCompare(b.createdAt));

  return [...sortedQuestions, ...documentCards];
}

/** The card to show for `?skip=` (a count of skipped cards): deck[skip] or null when past the end. */
export function cardAt(deck: readonly ReviewCard[], skip: number): ReviewCard | null {
  return deck[Math.max(0, skip)] ?? null;
}

/** The key pressed → the action: '1'..'4' → {answer: index}, 's'/'S' → skip, 'o'/'O' → open, 'Escape' → exit, else null. */
export function keyAction(key: string): { answer: number } | 'skip' | 'open' | 'exit' | null {
  if (key >= '1' && key <= '4' && key.length === 1) return { answer: Number(key) - 1 };
  if (key === 's' || key === 'S') return 'skip';
  if (key === 'o' || key === 'O') return 'open';
  if (key === 'Escape') return 'exit';
  return null;
}
