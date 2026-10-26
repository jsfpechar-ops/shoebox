import { describe, expect, it } from 'vitest';
import {
  buildPeriodCards,
  computePreview,
  loadPeriodCardInputs,
  loadPreviewInputs,
  type PreviewInputs,
} from '../src/vat/periods';

type Result = { data: unknown; error: unknown };

/** A chainable stand-in for a Supabase query builder; every call returns itself and awaiting yields the table result. */
function fakeSupabase(tables: Record<string, Result>) {
  const calls: string[] = [];
  const from = (table: string) => {
    const result = tables[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'order', 'limit', 'range']) {
      chain[m] = (...args: unknown[]) => {
        calls.push(`${table}.${m}(${args.map(String).join(',')})`);
        return chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve(result);
    // biome-ignore lint/suspicious/noThenProperty: a thenable is how the Supabase builder is awaited
    chain.then = (resolve: (r: Result) => unknown) => resolve(result);
    return chain;
  };
  return { client: { from } as never, calls };
}

describe('loadPeriodCardInputs', () => {
  it('maps rows, scopes every query to the org, and returns null for a non-payer', async () => {
    const { client, calls } = fakeSupabase({
      taxpayer_profiles: { data: { vat_status: 'platce', vat_period: 'quarter' }, error: null },
      filings: {
        data: [
          {
            id: 'f1',
            type: 'DPHDP3',
            kind: 'radne',
            origin: 'generated',
            period_start: '2026-07-01',
            period_end: '2026-09-30',
            state: 'generated',
            bundle_id: 'b1',
            xsd_valid: true,
            totals: { row64: 100 },
            simple_check: null,
            filed_on: null,
            amends_filing_id: null,
            discovered_on: null,
          },
        ],
        error: null,
      },
      obligations: {
        data: [
          {
            kind: 'vat_return',
            period_start: '2026-04-01',
            period_end: '2026-06-30',
            due_date: '2026-07-25',
            state: 'overdue',
            amount_estimate: null,
          },
        ],
        error: null,
      },
      vat_ledger_entries: { data: [{ period_start: '2026-04-01' }], error: null },
    });
    const inputs = await loadPeriodCardInputs(client, 'org1', 2026, '2026-10-30');
    expect(inputs?.filings[0]).toMatchObject({ id: 'f1', simpleCheck: {}, totals: { row64: 100 } });
    expect(inputs?.periodsWithEntries).toEqual(['2026-04-01']);
    expect(calls.filter((c) => c.includes('.eq(org_id,org1)')).length).toBe(4);
    // The overdue card carries the obligation's own period end (a quarter), not a month end.
    const overdue = inputs === null ? [] : buildPeriodCards(inputs);
    expect(overdue.find((c) => c.kind === 'overdue_missing')).toMatchObject({
      periodStart: '2026-04-01',
      periodEnd: '2026-06-30',
    });

    const none = fakeSupabase({
      taxpayer_profiles: { data: { vat_status: 'neplatce', vat_period: null }, error: null },
    });
    expect(await loadPeriodCardInputs(none.client, 'org1', 2026, '2026-10-30')).toBeNull();
  });

  it('throws a coded error when a read fails', async () => {
    const { client } = fakeSupabase({
      taxpayer_profiles: { data: { vat_status: 'platce', vat_period: 'month' }, error: null },
      filings: { data: null, error: { message: 'x' } },
    });
    await expect(loadPeriodCardInputs(client, 'o', 2026, '2026-10-30')).rejects.toThrow(
      'filing_load_failed',
    );
  });
});

describe('loadPreviewInputs', () => {
  it('returns null without entries; maps entries and document meta otherwise', async () => {
    const empty = fakeSupabase({
      taxpayer_profiles: { data: { vat_status: 'platce', vat_period: 'month' }, error: null },
      vat_ledger_entries: { data: [], error: null },
    });
    expect(await loadPreviewInputs(empty.client, 'o', '2026-10-01')).toBeNull();

    const entry = {
      period_start: '2026-10-01',
      period_end: '2026-10-31',
      vat_point_date: '2026-10-15',
      vat_point_rule: 'issue_date',
      document_id: 'd1',
      line_id: null,
      vat_treatment: 'rcv_domestic_vat',
      vat_rate_type: 'standard',
      vat_rate_pct: '21.00',
      base_czk: '1000.00',
      vat_czk: '210.00',
      deduction_pct: '100.00',
      currency: 'CZK',
      base_foreign: null,
      fx_rate: null,
      fx_amount: null,
      fx_rate_date: null,
      dphdp3_rows: ['40'],
      kh_section: 'B2',
      kh_document_total_czk: '1210.00',
      shv_code: null,
      counterparty_vat_id: 'CZ12345678',
      evidence_number: 'E1',
    };
    const full = fakeSupabase({
      taxpayer_profiles: { data: { vat_status: 'platce', vat_period: 'month' }, error: null },
      vat_ledger_entries: { data: [entry], error: null },
      documents: {
        data: [
          {
            id: 'd1',
            document_number: 'F-1',
            duzp: '2026-10-15',
            vat_point_date: null,
            partner: { name: 'Acme', country: 'CZ' },
          },
        ],
        error: null,
      },
    });
    const inputs = await loadPreviewInputs(full.client, 'o', '2026-10-01');
    expect(inputs?.entries[0]).toMatchObject({ baseCzk: '1000.00', documentId: 'd1' });
    expect(inputs?.docs[0]?.document_number).toBe('F-1');
    if (inputs === null) throw new Error('inputs');
    const dp3 = computePreview('DPHDP3', inputs);
    expect(dp3.form).toBe('DPHDP3');
    expect(dp3.result?.row64).toMatch(/^-?\d+\.\d{2}$/);
    expect(dp3.rows.find((r) => r.row === '40')?.entries[0]?.partnerName).toBe('Acme');
    const kh = computePreview('DPHKH1', inputs satisfies PreviewInputs);
    expect(kh.khSections).not.toBeNull();
  });
});
