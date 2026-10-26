import { describe, expect, it } from 'vitest';
import { parseReprocess, resetVendorMemory } from '../src/documents/vendor-memory';

type Row = Record<string, unknown>;
function fakeSupabase(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; values: Row; filters: Row }> = [];
  function from(table: string) {
    const filters: Row = {};
    const inFilters: Array<[string, unknown[]]> = [];
    const rows = () =>
      (tables[table] ?? []).filter(
        (r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v) &&
          inFilters.every(([k, vs]) => vs.includes(r[k])),
      );
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
      in: (k: string, vs: unknown[]) => {
        inFilters.push([k, vs]);
        return chain;
      },
      limit: () => chain,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable like a PostgREST builder
      then: (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null }),
      update: (values: Row) => {
        writes.push({ table, values, filters });
        for (const r of rows()) Object.assign(r, values);
        return chain;
      },
    };
    return chain;
  }
  return { client: { from } as never, writes, tables };
}
const ORG = '11111111-1111-4111-8111-111111111111';
const PROFILE = '66666666-6666-4666-8666-666666666666';
const PARTNER = '77777777-7777-4777-8777-777777777777';

describe('parseReprocess', () => {
  it('only the literal true', () => {
    expect(parseReprocess('true')).toBe(true);
    expect(parseReprocess('1')).toBe(false);
    expect(parseReprocess(null)).toBe(false);
  });
});

describe('resetVendorMemory', () => {
  const profile = () => ({
    id: PROFILE,
    org_id: ORG,
    partner_id: PARTNER,
    default_category_code: 'exp_cleaning',
    default_vat_treatment: 'rcv_domestic_no_vat',
    default_business_flag: 'business',
    confirmations: 3,
    pinned: true,
    multi_category: true,
    last_confirmed_at: '2026-10-01T00:00:00Z',
    extraction_hints: { subject_cs: 'Cleaning', layout: 'v2' },
  });
  const docs = () => [
    {
      id: 'd1',
      org_id: ORG,
      partner_id: PARTNER,
      status: 'needs_review',
      revision: 1,
      deleted_at: null,
    },
    {
      id: 'd2',
      org_id: ORG,
      partner_id: PARTNER,
      status: 'finalized',
      revision: 2,
      deleted_at: null,
    },
    {
      id: 'd3',
      org_id: ORG,
      partner_id: PARTNER,
      status: 'ready',
      revision: 1,
      deleted_at: '2026-01-01T00:00:00Z',
    },
    { id: 'd4', org_id: ORG, partner_id: 'other', status: 'ready', revision: 1, deleted_at: null },
  ];
  it('clears only the category fields, keeps other hints, lists open documents of the partner', async () => {
    const fake = fakeSupabase({ vendor_profiles: [profile()], documents: docs() });
    const r = await resetVendorMemory(fake.client, { orgId: ORG, profileId: PROFILE });
    expect(r).toEqual({ ok: true, partnerId: PARTNER, openDocuments: [{ id: 'd1', revision: 1 }] });
    const w = fake.writes.find((x) => x.table === 'vendor_profiles');
    expect(w?.values).toEqual({
      default_category_code: null,
      default_vat_treatment: null,
      default_business_flag: null,
      confirmations: 0,
      pinned: false,
      multi_category: false,
      last_confirmed_at: null,
      extraction_hints: { layout: 'v2' },
    });
    expect(w?.filters).toMatchObject({ id: PROFILE, org_id: ORG });
  });
  it('404 for another org', async () => {
    const fake = fakeSupabase({
      vendor_profiles: [{ ...profile(), org_id: 'other' }],
      documents: [],
    });
    expect(await resetVendorMemory(fake.client, { orgId: ORG, profileId: PROFILE })).toEqual({
      ok: false,
      status: 404,
      error: 'not_found',
    });
    expect(fake.writes).toEqual([]);
  });
});
