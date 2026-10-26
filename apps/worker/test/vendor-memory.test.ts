import { describe, expect, it } from 'vitest';
import {
  applyRelearnAnswer,
  emptyProfile,
  learnVendorProfile,
  type VendorObservation,
  type VendorProfileState,
} from '../src/categorize/vendor-memory';

const now = new Date('2026-10-26T10:00:00Z');
const obs = (over: Partial<VendorObservation> = {}): VendorObservation => ({
  categoryCode: 'exp_cleaning',
  vatTreatment: 'rcv_domestic_no_vat',
  businessFlag: 'business',
  subject: 'Apartment cleaning',
  pin: false,
  multiCategory: false,
  ...over,
});
const learned = (over: Partial<VendorProfileState> = {}): VendorProfileState => ({
  ...emptyProfile(),
  defaultCategoryCode: 'exp_cleaning',
  defaultVatTreatment: 'rcv_domestic_no_vat',
  defaultBusinessFlag: 'business',
  confirmations: 2,
  extractionHints: { subject_cs: 'Apartment cleaning', other: 1 },
  ...over,
});

describe('learnVendorProfile (M04 §4.7)', () => {
  it('first confirmation sets the defaults and the subject hint; the second reaches the threshold (AC-6)', () => {
    const first = learnVendorProfile(emptyProfile(), obs(), 2, now);
    expect(first.profile).toMatchObject({
      defaultCategoryCode: 'exp_cleaning',
      defaultVatTreatment: 'rcv_domestic_no_vat',
      defaultBusinessFlag: 'business',
      confirmations: 1,
      pinned: false,
      lastConfirmedAt: now,
      extractionHints: { subject_cs: 'Apartment cleaning' },
    });
    expect(first).toMatchObject({ changed: true, relearn: null, reachedThreshold: false });
    const second = learnVendorProfile(first.profile, obs(), 2, now);
    expect(second.profile.confirmations).toBe(2);
    expect(second.reachedThreshold).toBe(true);
    const third = learnVendorProfile(second.profile, obs(), 2, now);
    expect(third.profile.confirmations).toBe(3);
    expect(third.reachedThreshold).toBe(false);
  });
  it('agreement refreshes treatment and flag; other hint keys survive', () => {
    const r = learnVendorProfile(
      learned(),
      obs({ businessFlag: 'mixed', vatTreatment: 'rcv_domestic_vat' }),
      2,
      now,
    );
    expect(r.profile).toMatchObject({
      confirmations: 3,
      defaultBusinessFlag: 'mixed',
      defaultVatTreatment: 'rcv_domestic_vat',
      extractionHints: { subject_cs: 'Apartment cleaning', other: 1 },
    });
  });
  it('a contradiction with ≤ 1 confirmation replaces the default; with ≥ 2 it asks relearn_vendor and changes nothing else', () => {
    const weak = learnVendorProfile(
      learned({ confirmations: 1 }),
      obs({ categoryCode: 'exp_services_general' }),
      2,
      now,
    );
    expect(weak.profile).toMatchObject({
      defaultCategoryCode: 'exp_services_general',
      confirmations: 1,
    });
    expect(weak.relearn).toBeNull();
    const strong = learnVendorProfile(
      learned(),
      obs({ categoryCode: 'exp_services_general' }),
      2,
      now,
    );
    expect(strong.profile.defaultCategoryCode).toBe('exp_cleaning');
    expect(strong.profile.confirmations).toBe(2);
    expect(strong.relearn).toEqual({
      oldCode: 'exp_cleaning',
      newCode: 'exp_services_general',
      count: 2,
    });
  });
  it('a pinned profile never changes on a contradiction and asks nothing', () => {
    const r = learnVendorProfile(
      learned({ pinned: true }),
      obs({ categoryCode: 'exp_services_general' }),
      2,
      now,
    );
    expect(r.profile).toMatchObject({ defaultCategoryCode: 'exp_cleaning', pinned: true });
    expect(r.relearn).toBeNull();
    expect(r.changed).toBe(false);
  });
  it('"always" pins and counts as reaching the threshold; multi-category is recorded', () => {
    const r = learnVendorProfile(emptyProfile(), obs({ pin: true, multiCategory: true }), 2, now);
    expect(r.profile).toMatchObject({ pinned: true, multiCategory: true, confirmations: 1 });
    expect(r.reachedThreshold).toBe(true);
  });
  it('a null subject keeps the existing hint', () => {
    const r = learnVendorProfile(learned(), obs({ subject: null }), 2, now);
    expect(r.profile.extractionHints).toMatchObject({ subject_cs: 'Apartment cleaning' });
  });
});

describe('applyRelearnAnswer', () => {
  it('from_now_on replaces the default, resets confirmations to 1 and pins; this_only changes nothing', () => {
    expect(applyRelearnAnswer(learned(), 'exp_services_general', 'from_now_on')).toMatchObject({
      defaultCategoryCode: 'exp_services_general',
      confirmations: 1,
      pinned: true,
      defaultVatTreatment: 'rcv_domestic_no_vat',
    });
    expect(applyRelearnAnswer(learned(), 'exp_services_general', 'this_only')).toEqual(learned());
  });
});
