import { describe, expect, it } from 'vitest';
import {
  isLastStep,
  normalizeIcoInput,
  regimeOptions,
  stepsFor,
} from '../src/onboarding/wizard-logic';

describe('regimeOptions', () => {
  it('offers all four answers when no VAT answer is chosen', () => {
    expect(regimeOptions(null)).toHaveLength(4);
  });

  it('hides the flat-rate tax for a VAT payer', () => {
    expect(regimeOptions('platce_monthly')).not.toContain('pausalni_dan');
    expect(regimeOptions('platce_quarterly')).toHaveLength(3);
  });

  it('keeps all four answers for an identified person', () => {
    expect(regimeOptions('identifikovana_osoba')).toHaveLength(4);
  });
});

describe('normalizeIcoInput', () => {
  it('keeps digits only', () => {
    expect(normalizeIcoInput(' 270 824 40 ')).toBe('27082440');
  });

  it('caps the value at 8 digits', () => {
    expect(normalizeIcoInput('1234567890')).toBe('12345678');
  });
});

describe('stepsFor', () => {
  it('shows three steps when no regime is chosen or the regime needs no detail', () => {
    expect(stepsFor('')).toEqual(['ico', 'vat', 'regime']);
    expect(stepsFor('danova_evidence')).toEqual(['ico', 'vat', 'regime']);
    expect(stepsFor('nevim')).toEqual(['ico', 'vat', 'regime']);
  });

  it('adds the detail step for both flat-rate regimes', () => {
    expect(stepsFor('pausalni_vydaje')).toHaveLength(4);
    expect(stepsFor('pausalni_dan')).toHaveLength(4);
  });
});

describe('isLastStep', () => {
  it('ends on the regime step when no detail follows', () => {
    expect(isLastStep('regime', 'nevim')).toBe(true);
    expect(isLastStep('regime', 'pausalni_vydaje')).toBe(false);
  });

  it('ends on the detail step always', () => {
    expect(isLastStep('detail', 'pausalni_dan')).toBe(true);
  });
});
