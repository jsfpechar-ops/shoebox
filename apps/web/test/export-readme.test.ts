import { describe, expect, it } from 'vitest';
import { buildReadme } from '../src/documents/export-readme';

const base = {
  period: '2026-09',
  ready: 3,
  needsReview: 2,
  notRead: 1,
  registerName: 'documents-2026-09.xlsx',
  isdocCount: 0,
  pohodaName: null,
  leftOut: [],
  trashed: 0,
  undated: 0,
};

describe('buildReadme', () => {
  it('states the counts and uses CRLF line ends', () => {
    const text = buildReadme(base);
    expect(text).toContain('6 documents: 3 ready, 2 need review, 1 not read yet.');
    expect(text).toContain('NEEDS-REVIEW_');
    expect(text).toContain('Nothing was left out.');
    expect(text.split('\r\n').length).toBeGreaterThan(5);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
  it('lists every left-out item with its reason', () => {
    const text = buildReadme({
      ...base,
      isdocCount: 2,
      pohodaName: 'pohoda_1_2026-09_v1.xml',
      leftOut: [
        { label: 'A', reason: 'missing' },
        { label: 'B', reason: 'too_big' },
      ],
      trashed: 2,
      undated: 1,
    });
    expect(text).toContain('isdoc/');
    expect(text).toContain('pohoda_1_2026-09_v1.xml');
    expect(text).toContain('- A: the file is missing in storage.');
    expect(text).toContain('- B: the ZIP would be too big');
    expect(text).toContain('2 documents are in the trash');
    expect(text).toContain('1 document has no date');
  });
});
