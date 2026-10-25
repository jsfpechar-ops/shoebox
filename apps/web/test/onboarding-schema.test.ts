import { describe, expect, it } from 'vitest';
import {
  type OnboardingInput,
  onboardingSchema,
  parseOnboardingForm,
  toCreateFirmInput,
} from '../src/onboarding/schema';

const base: Record<string, unknown> = {
  ico: '27082440',
  name: 'Alza.cz a.s.',
  dic: 'CZ27082440',
  street: 'Jankovcova',
  houseNumber: '1522',
  orientationNumber: '53',
  city: 'Praha',
  zip: '170 00',
  fuCode: '013',
  validFrom: '2026-01-01',
  slugBase: 'alza-cz-a-s',
  vat: 'neplatce',
  regime: 'pausalni_vydaje',
  pausalRate: '60',
  pausalDanBand: '',
};

function issueMessages(input: Record<string, unknown>): string[] {
  const r = onboardingSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe('onboarding schema (M11 §5.5, 0061 create_firm input)', () => {
  it('accepts a paušální výdaje 60 % non-payer and maps it to create_firm input', () => {
    const r = onboardingSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(toCreateFirmInput(r.data)).toEqual({
      name: 'Alza.cz a.s.',
      ico: '27082440',
      dic: 'CZ27082440',
      vat_status: 'neplatce',
      vat_period: null,
      tax_regime: 'pausalni_vydaje',
      pausal_rate: 60,
      pausal_dan_band: null,
      valid_from: '2026-01-01',
      address: {
        street: 'Jankovcova',
        house_number: '1522',
        orientation_number: '53',
        city: 'Praha',
        zip: '17000',
        country: 'CZ',
      },
      fu_code: '013',
      slug_base: 'alza-cz-a-s',
    });
  });

  it('maps VAT answers to vat_status and vat_period', () => {
    const map = (vat: string, regime = 'danova_evidence') => {
      const r = onboardingSchema.safeParse({ ...base, vat, regime, pausalRate: '' });
      if (!r.success) throw new Error(r.error.message);
      const out = toCreateFirmInput(r.data);
      return [out.vat_status, out.vat_period];
    };
    expect(map('platce_quarterly')).toEqual(['platce', 'quarterly']);
    expect(map('platce_monthly')).toEqual(['platce', 'monthly']);
    expect(map('identifikovana_osoba')).toEqual(['identifikovana_osoba', 'monthly']);
  });

  it('maps "nevim" to danova_evidence', () => {
    const r = onboardingSchema.safeParse({ ...base, regime: 'nevim', pausalRate: '' });
    expect(r.success && toCreateFirmInput(r.data).tax_regime).toBe('danova_evidence');
  });

  it('pausalni_vydaje without a rate fails with pausal_rate_required', () => {
    expect(issueMessages({ ...base, pausalRate: '' })).toContain('pausal_rate_required');
  });

  it('pausalni_dan for a VAT payer fails with pausal_dan_payer', () => {
    expect(
      issueMessages({
        ...base,
        regime: 'pausalni_dan',
        vat: 'platce_monthly',
        pausalRate: '',
        pausalDanBand: '2',
      }),
    ).toContain('pausal_dan_payer');
  });

  it('pausalni_dan without a band fails with band_required', () => {
    expect(
      issueMessages({ ...base, regime: 'pausalni_dan', pausalRate: '', pausalDanBand: '' }),
    ).toContain('band_required');
  });

  it('rejects an IČO with a wrong check digit', () => {
    expect(issueMessages({ ...base, ico: '12345678' }).length).toBeGreaterThan(0);
  });

  it('normalises DIČ: upper-case, no spaces', () => {
    const r = onboardingSchema.safeParse({ ...base, dic: ' cz 27082440' });
    expect(r.success && r.data.dic).toBe('CZ27082440');
  });

  it('normalises zip to 5 digits', () => {
    const r = onboardingSchema.safeParse({ ...base, zip: '170 00' });
    expect(r.success && r.data.zip).toBe('17000');
  });

  it('replaces an invalid slugBase with firma without failing', () => {
    const r = onboardingSchema.safeParse({ ...base, slugBase: 'Špatný slug!' });
    expect(r.success && r.data.slugBase).toBe('firma');
  });

  it('forces the rate to null when the regime is not pausalni_vydaje', () => {
    const r = onboardingSchema.safeParse({ ...base, regime: 'danova_evidence', pausalRate: '60' });
    expect(r.success && r.data.pausalRate).toBe(null);
  });

  it('parses FormData with string numbers', () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(base)) fd.set(k, String(v));
    const r = parseOnboardingForm(fd);
    expect(r.success).toBe(true);
    if (r.success) {
      const typed: OnboardingInput = r.data;
      expect(typed.pausalRate).toBe(60);
    }
  });
});
