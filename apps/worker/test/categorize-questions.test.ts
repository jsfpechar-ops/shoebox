import type { CategorizeQuestionRow } from '@shoebox/db';
import type { CascadeResult, CategoryDecision } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { applyAnswers, openKinds, parseQuestionPayload } from '../src/categorize/answers';
import { buildQuestions, type QuestionContext } from '../src/categorize/questions';

const L1 = '33333333-3333-4333-8333-333333333331';
const L2 = '33333333-3333-4333-8333-333333333332';
const positions = new Map([
  [L1, 1],
  [L2, 2],
]);

function q(over: Partial<CategorizeQuestionRow>): CategorizeQuestionRow {
  return {
    id: 'q1',
    kind: 'which_category',
    payload: {
      question: 'categorize.question.which_category',
      params: { line_ids: [L1] },
      options: [{ value: 'exp_cleaning', label: 'categorize.option.category', text: 'Cleaning' }],
    },
    answer: null,
    answeredAt: null,
    ...over,
  };
}
function decision(over: Partial<CategoryDecision>): CategoryDecision {
  return {
    lineId: L1,
    position: 1,
    categoryCode: 'exp_other_deductible',
    taxEffect: 'deductible_expense',
    decidedBy: 'llm',
    source: 'llm',
    confidence: 0.9,
    ruleId: null,
    accepted: true,
    lowValue: false,
    businessSharePct: '100',
    deductibility: 'deductible',
    questions: [],
    ...over,
  };
}
function cascade(
  lines: CategoryDecision[],
  documentQuestions: CascadeResult['documentQuestions'] = [],
): CascadeResult {
  return { lines, needsLlm: [], documentQuestions, businessFlag: 'business' };
}
function ctx(over: Partial<QuestionContext> = {}): QuestionContext {
  return {
    merchant: 'Decathlon',
    lines: [
      { lineId: L1, position: 1, description: 'Quechua backpack', grossCzk: '249.00' },
      { lineId: L2, position: 2, description: 'Socks', grossCzk: '99.00' },
    ],
    extraLineKinds: [],
    thresholdCzk: '80000',
    suggested: { business_or_personal: 'personal' },
    topCategories: new Map([
      [
        L1,
        [
          { code: 'exp_other_deductible', label: 'Other deductible', confidence: 0.5 },
          { code: 'private_expense', label: 'Personal expense', confidence: 0.4 },
        ],
      ],
    ]),
    maxQuestions: 2,
    ...over,
  };
}

describe('parseQuestionPayload', () => {
  it('accepts the deck contract and rejects anything else', () => {
    expect(parseQuestionPayload(q({}).payload)).not.toBeNull();
    expect(parseQuestionPayload({ question: 'k', options: [] })).toBeNull();
    expect(
      parseQuestionPayload({
        question: 'k',
        options: [
          { value: 'a', label: 'l' },
          { value: 'b', label: 'l' },
          { value: 'c', label: 'l' },
          { value: 'd', label: 'l' },
          { value: 'e', label: 'l' },
        ],
      }),
    ).toBeNull();
    expect(parseQuestionPayload(null)).toBeNull();
  });
});

describe('applyAnswers', () => {
  it('personal → private_expense and share 0 on the question lines', () => {
    const rows = [
      q({
        kind: 'business_or_personal',
        payload: {
          question: 'x',
          params: { line_ids: [L1, L2] },
          options: [
            { value: 'business', label: 'a' },
            { value: 'personal', label: 'b' },
            { value: 'mixed', label: 'c' },
          ],
        },
        answer: { value: 'personal' },
        answeredAt: new Date('2026-10-01T00:00:00Z'),
      }),
    ];
    expect(applyAnswers(rows, positions)).toEqual(
      expect.arrayContaining([
        { position: 1, key: 'category_code', value: 'private_expense' },
        { position: 1, key: 'business_share_pct', value: '0' },
        { position: 2, key: 'category_code', value: 'private_expense' },
        { position: 2, key: 'business_share_pct', value: '0' },
      ]),
    );
  });
  it('business → share 100 only; which_category → category; small_asset 80 → share; supply_kind → service', () => {
    const rows = [
      q({
        id: 'a',
        kind: 'business_or_personal',
        payload: {
          question: 'x',
          params: { line_ids: [L1] },
          options: [{ value: 'business', label: 'a' }],
        },
        answer: { value: 'business' },
        answeredAt: new Date('2026-10-01T00:00:00Z'),
      }),
      q({
        id: 'b',
        answer: { value: 'exp_cleaning' },
        answeredAt: new Date('2026-10-01T00:00:00Z'),
      }),
      q({
        id: 'c',
        kind: 'small_asset_business_use',
        payload: {
          question: 'x',
          params: { line_ids: [L2] },
          options: [{ value: '80', label: 'p' }],
        },
        answer: { value: '80' },
        answeredAt: new Date('2026-10-01T00:00:00Z'),
      }),
      q({
        id: 'd',
        kind: 'supply_kind',
        payload: {
          question: 'x',
          params: { line_ids: [L2] },
          options: [{ value: 'service', label: 's' }],
        },
        answer: { value: 'service' },
        answeredAt: new Date('2026-10-01T00:00:00Z'),
      }),
    ];
    const fields = applyAnswers(rows, positions);
    expect(fields).toContainEqual({ position: 1, key: 'business_share_pct', value: '100' });
    expect(fields).toContainEqual({ position: 1, key: 'category_code', value: 'exp_cleaning' });
    expect(fields).toContainEqual({ position: 2, key: 'business_share_pct', value: '80' });
    expect(fields).toContainEqual({ position: 2, key: 'supply_kind', value: 'service' });
    expect(
      fields.some(
        (f) => f.position === 1 && f.key === 'category_code' && f.value === 'private_expense',
      ),
    ).toBe(false);
  });
  it('ignores unanswered rows, values outside the options, unknown kinds and car_regime; the later answer wins', () => {
    const rows = [
      q({ id: 'a', answer: null }),
      q({
        id: 'b',
        answer: { value: 'exp_not_offered' },
        answeredAt: new Date('2026-10-01T00:00:00Z'),
      }),
      q({
        id: 'c',
        kind: 'car_regime',
        payload: { question: 'x', options: [{ value: 'actual_costs', label: 'l' }] },
        answer: { value: 'actual_costs' },
        answeredAt: new Date('2026-10-01T00:00:00Z'),
      }),
      q({
        id: 'd',
        answer: { value: 'exp_cleaning' },
        answeredAt: new Date('2026-10-01T00:00:00Z'),
      }),
      q({
        id: 'e',
        payload: {
          question: 'x',
          params: { line_ids: [L1] },
          options: [{ value: 'exp_other_deductible', label: 'l' }],
        },
        answer: { value: 'exp_other_deductible' },
        answeredAt: new Date('2026-10-02T00:00:00Z'),
      }),
    ];
    expect(applyAnswers(rows, positions)).toEqual([
      { position: 1, key: 'category_code', value: 'exp_other_deductible' },
    ]);
    expect([...openKinds(rows)]).toEqual(['which_category']);
  });
});

describe('buildQuestions', () => {
  it('Decathlon: a document-level business_or_personal question with three options and the suggestion', () => {
    const { asked } = buildQuestions(
      cascade(
        [decision({ accepted: false, questions: ['which_category'] })],
        ['business_or_personal'],
      ),
      [],
      ctx(),
    );
    expect(asked.map((a) => a.kind)).toEqual(['business_or_personal', 'which_category']);
    const bp = asked[0]?.payload;
    expect(bp).toMatchObject({
      question: 'categorize.question.business_or_personal',
      suggested: 'personal',
      params: {
        merchant: 'Decathlon',
        item: 'Quechua backpack',
        line_ids: [L1, L2],
        amount_czk: '348.00',
      },
    });
    expect(bp?.options.map((o) => [o.value, o.label])).toEqual([
      ['business', 'categorize.option.business'],
      ['personal', 'categorize.option.personal'],
      ['mixed', 'categorize.option.mixed'],
    ]);
    const wc = asked[1]?.payload;
    expect(wc?.options).toEqual([
      {
        value: 'exp_other_deductible',
        label: 'categorize.option.category',
        text: 'Other deductible',
      },
      { value: 'private_expense', label: 'categorize.option.category', text: 'Personal expense' },
    ]);
    expect(wc?.params).toMatchObject({ line_ids: [L1], amount_czk: '249.00' });
  });
  it('MacBook: small_asset_business_use with the four percentage options', () => {
    const { asked } = buildQuestions(
      cascade([
        decision({ categoryCode: 'exp_small_assets', questions: ['small_asset_business_use'] }),
      ]),
      [],
      ctx({
        lines: [{ lineId: L1, position: 1, description: 'MacBook Air', grossCzk: '26990.00' }],
      }),
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]?.payload.options.map((o) => o.value)).toEqual(['100', '80', '50', '0']);
    expect(asked[0]?.payload.options[1]?.label).toBe('categorize.option.pct_80');
    expect(asked[0]?.payload.params).toMatchObject({ item: 'MacBook Air', amount_czk: '26990.00' });
  });
  it('groups one kind across lines, orders by priority, caps at maxQuestions and reports the deferred kinds', () => {
    const lines = [
      decision({ accepted: false, questions: ['which_category'] }),
      decision({ lineId: L2, position: 2, accepted: false, questions: ['which_category'] }),
    ];
    const { asked, deferred } = buildQuestions(
      cascade(lines, ['business_or_personal']),
      [],
      ctx({ extraLineKinds: [{ lineId: L2, kind: 'supply_kind' }] }),
    );
    expect(asked.map((a) => a.kind)).toEqual(['business_or_personal', 'supply_kind']);
    expect(deferred).toEqual(['which_category']);
    expect(asked[1]?.payload.params?.line_ids).toEqual([L2]);
  });
  it('does not repeat a kind that is open, nor one answered for the same lines; asks it again for new lines', () => {
    const open = [
      q({
        id: 'o',
        kind: 'business_or_personal',
        payload: {
          question: 'x',
          params: { line_ids: [L1, L2] },
          options: [{ value: 'business', label: 'l' }],
        },
      }),
    ];
    expect(
      buildQuestions(cascade([decision({})], ['business_or_personal']), open, ctx()).asked,
    ).toEqual([]);
    const answered = [
      q({
        id: 'a',
        answer: { value: 'exp_cleaning' },
        answeredAt: new Date('2026-10-01T00:00:00Z'),
      }),
    ];
    expect(
      buildQuestions(
        cascade([decision({ accepted: false, questions: ['which_category'] })]),
        answered,
        ctx(),
      ).asked,
    ).toEqual([]);
    const other = buildQuestions(
      cascade([
        decision({ lineId: L2, position: 2, accepted: false, questions: ['which_category'] }),
      ]),
      answered,
      ctx({
        topCategories: new Map([
          [L2, [{ code: 'exp_cleaning', label: 'Cleaning', confidence: 0.6 }]],
        ]),
      }),
    ).asked;
    expect(other.map((a) => a.kind)).toEqual(['which_category']);
  });
  it('asset_over_threshold carries the threshold and yes/no', () => {
    const { asked } = buildQuestions(
      cascade([
        decision({
          categoryCode: 'asset_long_term',
          taxEffect: 'asset',
          questions: ['asset_over_threshold'],
        }),
      ]),
      [],
      ctx({ lines: [{ lineId: L1, position: 1, description: 'Camera', grossCzk: '92000.00' }] }),
    );
    expect(asked[0]?.payload).toMatchObject({
      question: 'categorize.question.asset_over_threshold',
      params: { threshold: '80000', amount_czk: '92000.00' },
    });
    expect(asked[0]?.payload.options.map((o) => o.value)).toEqual(['yes', 'no']);
  });
});
