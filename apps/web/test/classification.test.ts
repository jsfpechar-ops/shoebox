import { describe, expect, it } from 'vitest';
import {
  parseAnswerBody,
  parseClassificationPatch,
  storeAnswer,
} from '../src/documents/classification';

describe('parsers', () => {
  it('answer body', () => {
    expect(parseAnswerBody({ value: 'personal' })).toEqual({ value: 'personal' });
    expect(parseAnswerBody({ value: '' })).toBeNull();
    expect(parseAnswerBody({ value: 'x'.repeat(121) })).toBeNull();
    expect(parseAnswerBody('personal')).toBeNull();
  });
  it('classification patch', () => {
    expect(
      parseClassificationPatch({
        category_code: 'exp_cleaning',
        business_share_pct: '80',
        remember: 'vendor',
      }),
    ).toEqual({ categoryCode: 'exp_cleaning', businessSharePct: '80', remember: 'vendor' });
    expect(parseClassificationPatch({ vat_treatment: 'rcv_domestic_no_vat' })).toEqual({
      vatTreatment: 'rcv_domestic_no_vat',
    });
    expect(parseClassificationPatch({})).toBeNull();
    expect(parseClassificationPatch({ category_code: 'nope' })).toBeNull();
    expect(parseClassificationPatch({ business_share_pct: '101' })).toBeNull();
    expect(parseClassificationPatch({ business_share_pct: '80.5' })).toBeNull();
    expect(parseClassificationPatch({ remember: 'forever' })).toBeNull();
  });
});

type Row = Record<string, unknown>;
/** A tiny PostgREST stand-in: `tables[name]` rows; supports select/eq/is/maybeSingle/update/insert as the store uses them. */
function fakeSupabase(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: 'update' | 'insert'; values: unknown; filters: Row }> =
    [];
  function from(table: string) {
    const filters: Row = {};
    const rows = () =>
      (tables[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return chain;
      },
      is: (k: string, v: unknown) => {
        filters[k] = v;
        return chain;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null }),
      update: (values: Row) => {
        writes.push({ table, op: 'update', values, filters });
        for (const r of rows()) Object.assign(r, values);
        return chain;
      },
      insert: (values: unknown) => {
        writes.push({ table, op: 'insert', values, filters: { ...filters } });
        return {
          select: () => chain,
          then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
        };
      },
    };
    return chain;
  }
  return { client: { from } as never, writes };
}
const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '44444444-4444-4444-8444-444444444444';
const DOC = '22222222-2222-4222-8222-222222222222';
const Q = '55555555-5555-4555-8555-555555555555';

describe('storeAnswer', () => {
  const question = () => ({
    id: Q,
    org_id: ORG,
    document_id: DOC,
    answer: null,
    payload: {
      question: 'categorize.question.business_or_personal',
      options: [
        { value: 'business', label: 'a' },
        { value: 'personal', label: 'b' },
      ],
    },
  });
  it('writes the answer and returns the document revision', async () => {
    const fake = fakeSupabase({
      review_questions: [question()],
      documents: [{ id: DOC, org_id: ORG, revision: 3, status: 'needs_review' }],
    });
    const r = await storeAnswer(fake.client, {
      orgId: ORG,
      userId: USER,
      questionId: Q,
      value: 'personal',
    });
    expect(r).toEqual({ ok: true, documentId: DOC, revision: 3 });
    const update = fake.writes.find((w) => w.table === 'review_questions' && w.op === 'update');
    expect(update?.values).toMatchObject({ answer: { value: 'personal' }, answered_by: USER });
    expect((update?.values as Row).answered_at).toBeTruthy();
    expect(update?.filters).toMatchObject({ id: Q, org_id: ORG });
  });
  it('404 for another org, 409 when already answered, 400 for a value outside the options', async () => {
    expect(
      await storeAnswer(
        fakeSupabase({ review_questions: [{ ...question(), org_id: 'other' }] }).client,
        { orgId: ORG, userId: USER, questionId: Q, value: 'personal' },
      ),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await storeAnswer(
        fakeSupabase({ review_questions: [{ ...question(), answer: { value: 'business' } }] })
          .client,
        { orgId: ORG, userId: USER, questionId: Q, value: 'personal' },
      ),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await storeAnswer(fakeSupabase({ review_questions: [question()] }).client, {
        orgId: ORG,
        userId: USER,
        questionId: Q,
        value: 'maybe',
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });
});
