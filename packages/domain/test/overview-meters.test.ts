import { describe, expect, it } from 'vitest';
import { Money } from '../src/money/index';
import { computeLimitMeters, type MeterProfile, meterLevel } from '../src/overview/meters';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules().at('2026-10-25');
const czk = (s: string) => Money.parse(s, 'CZK');

function profile(over: Partial<MeterProfile> = {}): MeterProfile {
  return {
    vatStatus: 'neplatce',
    taxRegime: 'danova_evidence',
    pausalRate: null,
    pausalDanBand: null,
    ...over,
  };
}

describe('meterLevel', () => {
  it('ok below 80 %, warn from 80 %, alert from 95 %, exceeded above the limit', () => {
    const limit = czk('1000');
    expect(meterLevel(czk('799.99'), limit)).toBe('ok');
    expect(meterLevel(czk('800'), limit)).toBe('warn');
    expect(meterLevel(czk('950'), limit)).toBe('alert');
    expect(meterLevel(czk('1000'), limit)).toBe('alert');
    expect(meterLevel(czk('1000.01'), limit)).toBe('exceeded');
    expect(meterLevel(czk('10'), limit, true)).toBe('warn');
  });
});

describe('computeLimitMeters', () => {
  it('a non-payer on tax records sees the two VAT registration meters over turnover', () => {
    const meters = computeLimitMeters(
      profile(),
      { incomeYtd: czk('999999'), turnoverYtd: czk('1640000') },
      rules,
    );
    expect(meters.map((m) => m.id)).toEqual(['vat_calendar_year', 'vat_immediate']);
    const [year, immediate] = meters;
    expect(year?.current.toFixed2()).toBe('1640000.00');
    expect(year?.limit.toFixed2()).toBe('2000000.00');
    expect(year?.percent).toBe(82);
    expect(year?.level).toBe('warn');
    expect(immediate?.limit.toFixed2()).toBe('2536500.00');
    expect(immediate?.percent).toBe(64);
    expect(immediate?.level).toBe('ok');
  });

  it('a VAT payer sees no VAT meter', () => {
    const meters = computeLimitMeters(
      profile({ vatStatus: 'platce' }),
      { incomeYtd: czk('0'), turnoverYtd: czk('0') },
      rules,
    );
    expect(meters).toEqual([]);
  });

  it('an identified person sees the VAT meters too', () => {
    const meters = computeLimitMeters(
      profile({ vatStatus: 'identifikovana_osoba' }),
      { incomeYtd: czk('0'), turnoverYtd: czk('0') },
      rules,
    );
    expect(meters.map((m) => m.id)).toEqual(['vat_calendar_year', 'vat_immediate']);
  });

  it('paušální daň band 1: the ceiling depends on the declared activity rate', () => {
    const totals = { incomeYtd: czk('950000'), turnoverYtd: czk('950000') };
    const at80 = computeLimitMeters(
      profile({ taxRegime: 'pausalni_dan', pausalDanBand: 1, pausalRate: 80 }),
      totals,
      rules,
    );
    expect(at80.map((m) => m.id)).toEqual([
      'vat_calendar_year',
      'vat_immediate',
      'pausalni_dan_band',
      'pausalni_dan_eligibility',
    ]);
    const band80 = at80.find((m) => m.id === 'pausalni_dan_band');
    expect(band80?.limit.toFixed2()).toBe('2000000.00');
    expect(band80?.level).toBe('ok');
    expect(band80?.hint).toBeNull();

    const at40 = computeLimitMeters(
      profile({ taxRegime: 'pausalni_dan', pausalDanBand: 1, pausalRate: 40 }),
      totals,
      rules,
    );
    const band40 = at40.find((m) => m.id === 'pausalni_dan_band');
    expect(band40?.limit.toFixed2()).toBe('1000000.00');
    expect(band40?.percent).toBe(95);
    expect(band40?.level).toBe('alert');
  });

  it('paušální daň: warn within 100 000 Kč of the ceiling; hint when the rate is unknown', () => {
    const meters = computeLimitMeters(
      profile({ taxRegime: 'pausalni_dan', pausalDanBand: 2, pausalRate: null }),
      { incomeYtd: czk('1400000'), turnoverYtd: czk('0') },
      rules,
    );
    const band = meters.find((m) => m.id === 'pausalni_dan_band');
    expect(band?.limit.toFixed2()).toBe('1500000.00');
    expect(band?.percent).toBe(93);
    expect(band?.level).toBe('warn');
    expect(band?.hint).toBe('set_activity_type');
    const eligibility = meters.find((m) => m.id === 'pausalni_dan_eligibility');
    expect(eligibility?.limit.toFixed2()).toBe('2000000.00');
    expect(eligibility?.level).toBe('ok');
  });

  it('paušální výdaje: income at which the flat-rate expenses stop growing', () => {
    const meters = computeLimitMeters(
      profile({ vatStatus: 'platce', taxRegime: 'pausalni_vydaje', pausalRate: 60 }),
      { incomeYtd: czk('2100000'), turnoverYtd: czk('2100000') },
      rules,
    );
    expect(meters.map((m) => m.id)).toEqual(['pausalni_vydaje_cap']);
    expect(meters[0]?.limit.toFixed2()).toBe('2000000.00');
    expect(meters[0]?.level).toBe('exceeded');
    expect(meters[0]?.percent).toBe(105);
  });

  it('paušální výdaje without a rate shows no cap meter', () => {
    const meters = computeLimitMeters(
      profile({ vatStatus: 'platce', taxRegime: 'pausalni_vydaje', pausalRate: null }),
      { incomeYtd: czk('0'), turnoverYtd: czk('0') },
      rules,
    );
    expect(meters).toEqual([]);
  });
});
