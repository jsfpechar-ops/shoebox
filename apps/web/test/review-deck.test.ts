import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  cardAt,
  keyAction,
  optionText,
  parseQuestionPayload,
} from '../src/documents/review-deck';

const payload = {
  question: 'question.business_or_personal',
  options: [
    { value: 'business', label: 'question.option.business' },
    { value: 'personal', label: 'question.option.personal' },
  ],
  suggested: 'personal',
};
const q = (id: string, documentId: string | null, createdAt: string) => ({
  type: 'question' as const,
  id,
  documentId,
  kind: 'business_or_personal',
  payload:
    parseQuestionPayload(payload) ??
    (() => {
      throw new Error('payload');
    })(),
  createdAt,
});
const d = (documentId: string, blocking: number, createdAt: string) => ({
  type: 'document' as const,
  documentId,
  blocking,
  createdAt,
});

describe('parseQuestionPayload', () => {
  it('accepts the contract and fills defaults', () => {
    expect(parseQuestionPayload(payload)).toEqual({ ...payload, params: {} });
    expect(parseQuestionPayload({ ...payload, suggested: undefined })?.suggested).toBeNull();
  });
  it('rejects other shapes', () => {
    expect(parseQuestionPayload(null)).toBeNull();
    expect(parseQuestionPayload({ ...payload, options: [] })).toBeNull();
    expect(
      parseQuestionPayload({ ...payload, options: Array(5).fill(payload.options[0]) }),
    ).toBeNull();
    expect(parseQuestionPayload({ ...payload, suggested: 'other' })).toBeNull();
    expect(parseQuestionPayload({ ...payload, question: 3 })).toBeNull();
  });
});

describe('buildDeck', () => {
  it('questions first, grouped by document, then documents by blocking count', () => {
    const deck = buildDeck(
      [
        q('q1', 'A', '2026-10-01T00:00:00Z'),
        q('q2', 'B', '2026-10-02T00:00:00Z'),
        q('q3', 'A', '2026-10-03T00:00:00Z'),
      ],
      [
        d('C', 1, '2026-09-01T00:00:00Z'),
        d('A', 2, '2026-09-01T00:00:00Z'),
        d('E', 3, '2026-09-05T00:00:00Z'),
      ],
    );
    expect(deck.map((c) => (c.type === 'question' ? c.id : c.documentId))).toEqual([
      'q1',
      'q3',
      'q2',
      'E',
      'C',
    ]);
  });
  it('cardAt walks past skipped cards', () => {
    const deck = buildDeck([], [d('C', 1, '2026-09-01T00:00:00Z')]);
    expect(cardAt(deck, 0)?.type).toBe('document');
    expect(cardAt(deck, 1)).toBeNull();
    expect(cardAt(deck, -1)?.type).toBe('document');
  });
});

describe('keyAction', () => {
  it('maps the shortcuts', () => {
    expect(keyAction('2')).toEqual({ answer: 1 });
    expect(keyAction('S')).toBe('skip');
    expect(keyAction('o')).toBe('open');
    expect(keyAction('Escape')).toBe('exit');
    expect(keyAction('5')).toBeNull();
  });
});

describe('option text', () => {
  it('keeps a category name and shows it instead of the label', () => {
    const parsed = parseQuestionPayload({
      question: 'question.which_category',
      options: [
        { value: 'c1', label: 'categorize.option.category', text: ' Fuel ' },
        { value: 'c2', label: 'categorize.option.category', text: '' },
      ],
    });
    expect(parsed?.options[0]).toEqual({
      value: 'c1',
      label: 'categorize.option.category',
      text: 'Fuel',
    });
    expect(parsed?.options[1]).toEqual({ value: 'c2', label: 'categorize.option.category' });
    expect(optionText({ label: 'categorize.option.category' as never, text: 'Fuel' })).toBe('Fuel');
  });
});
