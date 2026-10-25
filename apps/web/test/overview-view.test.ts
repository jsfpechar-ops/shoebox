import { createCzRules, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { toOverviewDocument, toOverviewProfile } from '../src/overview/rows';
import { buildOverviewView } from '../src/overview/view';

const rules = createCzRules();
const asOf = parseLegalDate('2026-10-25');

const docRow = {
  status: 'ready',
  class: 'issued_invoice',
  direction: 'out',
  business_flag: 'business',
  deleted_at: null,
  duzp: '2026-10-05',
  issue_date: '2026-10-05',
  received_date: null,
  service_period_to: null,
  currency: 'CZK',
  fx_rate: null,
  total_gross: '1640000.00',
  partners: { country: 'CZ', vat_id: null },
  document_lines: [
    {
      line_type: 'item',
      net: '1640000.00',
      gross: '1640000.00',
      vat_treatment: null,
      business_share_pct: '100.00',
      categories: { tax_effect: 'taxable_income' },
    },
  ],
};

const profileRow = {
  vat_status: 'neplatce',
  vat_period: null,
  tax_regime: 'danova_evidence',
  pausal_rate: null,
  pausal_dan_band: null,
  has_accountant: true,
};

describe('rows', () => {
  it('maps a documents row with its lines, partner and category', () => {
    const doc = toOverviewDocument(docRow);
    expect(doc?.class).toBe('issued_invoice');
    expect(doc?.businessFlag).toBe('business');
    expect(doc?.deleted).toBe(false);
    expect(doc?.duzp).toBe('2026-10-05');
    expect(doc?.partnerCountry).toBe('CZ');
    expect(doc?.lines[0]?.taxEffect).toBe('taxable_income');
    expect(doc?.lines[0]?.businessSharePct).toBe('100.00');
  });

  it('a line without a category has no tax effect; a row without a partner is fine', () => {
    const doc = toOverviewDocument({
      ...docRow,
      partners: null,
      document_lines: [{ ...docRow.document_lines[0], categories: null }],
    });
    expect(doc?.partnerCountry).toBeNull();
    expect(doc?.lines[0]?.taxEffect).toBeNull();
  });

  it('returns null for a row that does not parse', () => {
    expect(toOverviewDocument({ ...docRow, status: 'nonsense' })).toBeNull();
    expect(toOverviewDocument(null)).toBeNull();
    expect(toOverviewProfile({ ...profileRow, vat_status: 'x' }, true)).toBeNull();
  });

  it('maps a profile row', () => {
    const profile = toOverviewProfile(profileRow, false);
    expect(profile).toEqual({
      vatStatus: 'neplatce',
      vatPeriod: null,
      taxRegime: 'danova_evidence',
      pausalRate: null,
      pausalDanBand: null,
      hasAccountant: true,
      insuranceSelfPaid: false,
    });
  });
});

describe('buildOverviewView', () => {
  it('is empty without a profile and without documents', () => {
    const view = buildOverviewView({ profile: null, documents: [], asOf, rules });
    expect(view.profile).toBeNull();
    expect(view.totals.countedCount).toBe(0);
    expect(view.meters).toEqual([]);
    expect(view.deadlines).toEqual([]);
    expect(view.nextPayment).toBeNull();
    expect(view.pausal).toBe(false);
  });

  it('shows deadlines from the profile even before the first document, but no meters', () => {
    const profile = toOverviewProfile(profileRow, true);
    if (profile === null) throw new Error('profile');
    const view = buildOverviewView({ profile, documents: [], asOf, rules });
    expect(view.meters).toEqual([]);
    expect(view.deadlines.map((x) => x.kind)).toEqual([
      'social_advance',
      'health_advance',
      'social_advance',
      'health_advance',
    ]);
    expect(view.nextPayment?.kind).toBe('social_advance');
    expect(view.nextPayment?.due).toBe('2026-10-30');
  });

  it('computes totals and meters once a counted document exists', () => {
    const profile = toOverviewProfile(profileRow, true);
    const doc = toOverviewDocument(docRow);
    if (profile === null || doc === null) throw new Error('fixture');
    const view = buildOverviewView({ profile, documents: [doc], asOf, rules });
    expect(view.totals.month.income.toFixed2()).toBe('1640000.00');
    expect(view.meters.map((m) => `${m.id} ${m.percent} ${m.level}`)).toEqual([
      'vat_calendar_year 82 warn',
      'vat_immediate 64 ok',
    ]);
  });

  it('the control statement is never the next payment', () => {
    const profile = toOverviewProfile(
      { ...profileRow, vat_status: 'platce', vat_period: 'monthly' },
      false,
    );
    if (profile === null) throw new Error('profile');
    const view = buildOverviewView({ profile, documents: [], asOf, rules });
    expect(view.deadlines[0]?.kind).toBe('vat_return');
    expect(view.nextPayment?.kind).toBe('vat_return');
    const pausal = toOverviewProfile({ ...profileRow, tax_regime: 'pausalni_dan' }, false);
    if (pausal === null) throw new Error('profile');
    expect(buildOverviewView({ profile: pausal, documents: [], asOf, rules }).pausal).toBe(true);
  });
});
