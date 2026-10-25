import { describe, expect, it } from 'vitest';
import { inboxRowOf, PROCESSING_STATUSES } from '../src/documents/inbox-data';

const base = {
  id: '22222222-2222-4222-8222-222222222222',
  status: 'ready',
  class: 'received_invoice',
  currency: 'CZK',
  total_gross: '1210.00',
  issue_date: '2026-10-01',
  created_at: '2026-10-25T10:00:00Z',
  partner_snapshot: { name: 'Dodavatel s.r.o.' },
  source_files: { original_filename: 'faktura.pdf' },
};

describe('inboxRowOf', () => {
  it('maps a read invoice', () => {
    expect(inboxRowOf(base)).toEqual({
      id: base.id,
      status: 'ready',
      cls: 'received_invoice',
      title: 'Dodavatel s.r.o.',
      total: { value: '1210.00', currency: 'CZK' },
      issueDate: '2026-10-01',
      createdAt: '2026-10-25T10:00:00Z',
      processing: false,
    });
  });

  it('falls back to the file name while it is being read', () => {
    const row = inboxRowOf({
      ...base,
      status: 'received',
      class: 'unknown',
      total_gross: null,
      issue_date: null,
      partner_snapshot: null,
      source_files: [{ original_filename: 'sken 3.pdf' }],
    });
    expect(row).toMatchObject({
      title: 'sken 3.pdf',
      total: null,
      issueDate: null,
      processing: true,
    });
  });

  it('rejects a malformed row', () => {
    expect(inboxRowOf({ id: 1 })).toBeNull();
    expect(inboxRowOf(null)).toBeNull();
  });

  it('knows the processing statuses', () => {
    expect(PROCESSING_STATUSES).toEqual([
      'received',
      'splitting',
      'classifying',
      'extracting',
      'validating',
      'categorizing',
    ]);
  });
});
