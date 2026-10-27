import { describe, expect, it } from 'vitest';
import type { DetailCheck } from '../src/documents/detail-data';
import { questionOf, splitChecks, statusAfterAnswers } from '../src/documents/issue-questions';

function check(over: Partial<DetailCheck>): DetailCheck {
  return {
    id: 'v1',
    fieldName: null,
    severity: 'blocking',
    key: 'proto.check.buyer.other_firm',
    params: { id: '12345678' },
    ...over,
  };
}

describe('questionOf', () => {
  it('asks whether an invoice for another IČO is yours; "no" trashes it', () => {
    const q = questionOf(check({}));
    expect(q.text).toBe('doc.issue.other_firm');
    expect(q.params).toEqual({ id: '12345678' });
    expect(q.answers.map((a) => a.action)).toEqual(['dismiss', 'trash']);
  });

  it('asks whether you issued it when you are the supplier; "no" opens the IČO fix', () => {
    const q = questionOf(check({ key: 'proto.check.buyer.supplier_is_me' }));
    expect(q.text).toBe('doc.issue.supplier_is_me');
    expect(q.answers).toEqual([
      { label: 'doc.issue.supplier_is_me.yes', action: 'dismiss' },
      { label: 'doc.issue.supplier_is_me.no', action: 'fix', editKey: 'supplier.ico' },
    ]);
  });

  it('asks whether the supplier IČO is printed like this', () => {
    const q = questionOf(check({ key: 'proto.check.ico_checksum.fail', params: { ico: '1' } }));
    expect(q.text).toBe('doc.issue.ico');
    expect(q.answers.map((a) => a.action)).toEqual(['dismiss', 'fix']);
    expect(q.answers[1]?.editKey).toBe('supplier.ico');
  });

  it('uses the message itself for any other issue, with a fix when the field can be fixed', () => {
    const q = questionOf(
      check({ key: 'proto.check.date.fail_invalid', fieldName: 'due_date', params: {} }),
    );
    expect(q.text).toBe('proto.check.date.fail_invalid');
    expect(q.answers).toEqual([
      { label: 'doc.issue.fine', action: 'dismiss' },
      { label: 'doc.issue.fix', action: 'fix', editKey: 'dates.due_date' },
    ]);
  });

  it('offers only "it\'s fine" when no field is named', () => {
    const q = questionOf(check({ key: 'proto.check.vat_rate_math.fail', params: {} }));
    expect(q.answers.map((a) => a.action)).toEqual(['dismiss']);
  });
});

describe('splitChecks and statusAfterAnswers', () => {
  it('turns blocking issues into questions and keeps warnings as notes', () => {
    const { questions, notes } = splitChecks([
      check({}),
      check({ id: 'v2', severity: 'warning', key: 'proto.check.dic_format.warn' }),
    ]);
    expect(questions).toHaveLength(1);
    expect(notes.map((n) => n.id)).toEqual(['v2']);
  });

  it('is ready only with nothing blocking open and a known class', () => {
    expect(statusAfterAnswers(0, 'invoice_received')).toBe('ready');
    expect(statusAfterAnswers(1, 'invoice_received')).toBe('needs_review');
    expect(statusAfterAnswers(0, 'unknown')).toBe('needs_review');
  });
});
