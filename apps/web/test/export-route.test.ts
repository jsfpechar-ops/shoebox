import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth/org-context', () => ({
  requireActiveRole: async () => ({ ok: true, orgId: 'org-1', userId: 'u', role: 'owner' }),
}));
vi.mock('../src/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
const loadExportDocs = vi.fn();
vi.mock('../src/documents/export-data', () => ({
  loadExportDocs: (...args: unknown[]) => loadExportDocs(...args),
  loadDocumentOverview: async () => ({ dates: ['2025-06-12', '2025-06-30'], undated: 0 }),
  countTrashedInPeriod: async () => 0,
}));
vi.mock('../src/documents/export-formats', () => ({
  loadFormatData: async () => null,
  isdocInputOf: () => null,
  pohodaDocumentOf: () => null,
  pohodaProfileOf: () => ({}),
}));

import { GET } from '../app/api/export/route';

beforeEach(() => loadExportDocs.mockReset());

describe('GET /api/export', () => {
  it('answers 409 empty with a hint instead of an empty ZIP', async () => {
    loadExportDocs.mockResolvedValue([]);
    const res = await GET(new Request('http://x/api/export?period=2026-09'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; hint: { first: string; last: string } };
    expect(body.error).toBe('empty');
    expect(body.hint).toMatchObject({ first: '2025-06', last: '2025-06', period: '2026-09' });
  });
});
