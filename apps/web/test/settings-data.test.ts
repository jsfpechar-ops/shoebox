import type { LegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { currentProfile, formatAddress, regimeLabel, vatLabel } from '../src/settings/settings-data';

describe('formatAddress', () => {
  it('writes one Czech address line', () => {
    expect(formatAddress({ street: 'Jankovcova', house_number: '1522', orientation_number: '53', city: 'Praha', zip: '17000', country: 'CZ' })).toBe('Jankovcova 1522/53, 170 00 Praha');
    expect(formatAddress({ house_number: '12', city: 'Lhota', zip: '25001' })).toBe('12, 250 01 Lhota');
    expect(formatAddress(null)).toBeNull();
  });
});

describe('currentProfile', () => {
  const rows = [
    { valid_from: '2025-01-01', valid_to: '2026-07-31', id: 'old' },
    { valid_from: '2026-08-01', valid_to: null, id: 'new' },
    { valid_from: '2027-01-01', valid_to: null, id: 'future' },
  ];
  it('picks the profile valid today', () => {
    expect(currentProfile(rows, '2026-10-26' as LegalDate)?.id).toBe('new');
    expect(currentProfile(rows, '2026-03-01' as LegalDate)?.id).toBe('old');
    expect(currentProfile(rows, '2024-01-01' as LegalDate)).toBeNull();
  });
});

describe('labels', () => {
  it('maps profile values to the onboarding words', () => {
    expect(vatLabel('neplatce', null)).toBe('onboarding.vat.neplatce');
    expect(vatLabel('identifikovana_osoba', null)).toBe('onboarding.vat.identifikovana_osoba');
    expect(regimeLabel('pausalni_vydaje')).toBe('onboarding.regime.pausalni_vydaje');
    expect(regimeLabel('bogus')).toBe('onboarding.regime.nevim');
  });
});
